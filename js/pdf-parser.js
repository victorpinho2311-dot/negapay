// ============================================================
//  NegaPay — PDF Parser v2.0
//  Estratégia: processa token a token com máquina de estados
//  Baseado na estrutura real da fatura Bradesco:
//    - Dia e mês chegam separados
//    - Descrição pode ter múltiplos tokens
//    - Valor é o último token numérico da "linha lógica"
// ============================================================

const PDFParser = (() => {

  // ── Carrega PDF.js ───────────────────────────────────────
  function carregarPDFjs() {
    return new Promise((resolve, reject) => {
      if (window.pdfjsLib) return resolve();
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        resolve();
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  // ── Extrai texto completo página a página ────────────────
  async function extrairTexto(file) {
    await carregarPDFjs();
    const buf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
    let texto = '';
    for (let p = 1; p <= pdf.numPages; p++) {
      const page    = await pdf.getPage(p);
      const content = await page.getTextContent();
      // Junta tokens com espaço, preservando quebras de bloco
      const pageText = content.items.map(i => i.str).join(' ');
      texto += pageText + '\n';
    }
    return texto;
  }

  // ── Converte valor BR → número ───────────────────────────
  function parseValor(str) {
    if (!str) return null;
    const s = str.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  // ── Meses PT → número ────────────────────────────────────
  const MESES = {
    JAN:'01',FEV:'02',MAR:'03',ABR:'04',MAI:'05',JUN:'06',
    JUL:'07',AGO:'08',SET:'09',OUT:'10',NOV:'11',DEZ:'12'
  };

  // ── Verifica se token é um valor monetário BR ────────────
  function isValor(str) {
    return /^-?\d{1,3}(\.\d{3})*(,\d{2})$/.test(str.trim());
  }

  // ── Verifica se token é dia (1-31) ───────────────────────
  function isDia(str) {
    const n = parseInt(str);
    return /^\d{1,2}$/.test(str.trim()) && n >= 1 && n <= 31;
  }

  // ── Verifica se token é mês abreviado ────────────────────
  function isMes(str) {
    return MESES.hasOwnProperty(str.trim().toUpperCase());
  }

  // ── Termos a ignorar completamente ───────────────────────
  const IGNORAR = [
    'SALDO ANTERIOR', 'PAGTO.', 'PAGAMENTO', 'Data', 'Lançamentos',
    'Moeda', 'Origem', 'Valor', 'Cotação', 'US$', 'R$',
    'Gastos', 'referentes', 'cartão', 'Final', 'Fatura',
    'Data de vencimento', 'Total', 'Forma', 'Melhor',
    'Débito', 'conta', 'Validade', 'Cartao', 'selecionado',
    'Resumo', 'Despesas', 'Real', 'Saldo', 'Pagamentos',
    'Créditos', 'Despesas', 'Pagamento', 'mínimo', 'Taxas',
    'Mensais', 'Taxa', 'Mês', 'Ano', 'CET', 'Máx',
    'Rotativo', 'Saque', 'Crediário', 'anterior', 'Extrato',
    'Aberto', 'sujeitos', 'alteração', 'fechamento',
    'Parcelamento', 'Crédito', 'Próximo', 'Período'
  ];

  function deveIgnorar(str) {
    return IGNORAR.some(ig => str.toLowerCase().includes(ig.toLowerCase()));
  }

  // ── Parser principal ─────────────────────────────────────
  async function processar(file, banco, mesAno) {
    const texto  = await extrairTexto(file);
    const tokens = texto.split(/\s+/).filter(t => t.length > 0);

    const resultado = {
      mesAno,
      banco:      banco.id,
      vencimento: calcularVencimento(banco.diaVencimento, mesAno),
      cartoes:    [],
      totalGeral: 0
    };

    const finaisPrimo = banco.cartoesPrimo.map(c => c.final);

    let secaoAtual  = null;
    let lancamentos = [];
    let totalSecao  = 0;
    let dataAtual   = null;

    // Acumulador de lançamento em construção
    let diaBuffer  = null;
    let mesBuffer  = null;
    let descBuffer = [];

    const salvarSecao = () => {
      if (!secaoAtual || !finaisPrimo.includes(secaoAtual.final)) return;
      const cfg = banco.cartoesPrimo.find(c => c.final === secaoAtual.final);
      resultado.cartoes.push({
        final:       secaoAtual.final,
        apelido:     cfg?.apelido || `Cartão ${secaoAtual.final}`,
        titular:     secaoAtual.titular,
        lancamentos: lancamentos,
        subtotal:    totalSecao
      });
      resultado.totalGeral += totalSecao;
    };

    const salvarLancamento = (valorStr) => {
      const valor = parseValor(valorStr);
      if (valor === null) return;

      const data = dataAtual || '??/??';
      const descricao = limparDesc(descBuffer.join(' '));
      descBuffer = [];

      if (!descricao || deveIgnorar(descricao)) return;

      lancamentos.push({
        data,
        descricao,
        valor,
        tipo: valor < 0 ? 'estorno' : 'compra'
      });
    };

    // Varre tokens um por um
    for (let i = 0; i < tokens.length; i++) {
      const t  = tokens[i];
      const t1 = tokens[i + 1] || '';
      const t2 = tokens[i + 2] || '';

      // ── Detecta cabeçalho de seção ───────────────────────
      // "Final 9087 | GETLIO R D S FARIAS"
      if (t === 'Final' && /^\d{4}$/.test(t1)) {
        // Fecha seção anterior
        if (descBuffer.length > 0 && dataAtual) {
          // tenta salvar lançamento incompleto
          descBuffer = [];
        }
        salvarSecao();

        const final = t1;
        // Pula o '|' e coleta nome até próximo número ou keyword
        let j = i + 2;
        if (tokens[j] === '|') j++;
        const nomeTokens = [];
        while (j < tokens.length && !/^\d{4}$/.test(tokens[j]) &&
               tokens[j] !== 'Final' && tokens[j] !== 'Valor') {
          nomeTokens.push(tokens[j]);
          j++;
        }
        i = j - 1;

        secaoAtual  = { final, titular: nomeTokens.join(' ').trim() };
        lancamentos = [];
        totalSecao  = 0;
        dataAtual   = null;
        diaBuffer   = null;
        mesBuffer   = null;
        descBuffer  = [];
        continue;
      }

      if (!secaoAtual) continue;

      // ── Detecta total da seção ───────────────────────────
      // "Valor da fatura: R$ 1.403,36"
      if (t === 'fatura:' && isValor(t1)) {
        const v = parseValor(t1);
        if (v !== null) totalSecao = v;
        i++;
        continue;
      }

      // ── Detecta data: dia seguido de mês ─────────────────
      if (isDia(t) && isMes(t1)) {
        // Salva lançamento anterior se houver descrição pendente
        // (o valor já foi salvo quando encontramos o isValor)
        diaBuffer = t.padStart(2, '0');
        mesBuffer = MESES[t1.toUpperCase()];
        dataAtual = `${diaBuffer}/${mesBuffer}`;
        i++; // pula o mês
        descBuffer = [];
        continue;
      }

      // ── Detecta valor monetário ──────────────────────────
      if (isValor(t)) {
        salvarLancamento(t);
        continue;
      }

      // ── Acumula tokens de descrição ──────────────────────
      if (!deveIgnorar(t) && t !== '|' && t !== '•' &&
          !/^\d{2}\/\d{4}$/.test(t) && // ignora datas tipo 05/2026
          !/^\*{4}$/.test(t)) {
        descBuffer.push(t);
      }
    }

    salvarSecao();
    return resultado;
  }

  // ── Remove parcelamento e limpa descrição ────────────────
  function limparDesc(str) {
    return str
      .replace(/\(\s*\d{2}\/\d{2}\s*\)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ── Calcula data de vencimento ───────────────────────────
  function calcularVencimento(dia, mesAno) {
    const [mes, ano] = mesAno.split('/').map(Number);
    let mf = mes + 1, af = ano;
    if (mf > 12) { mf = 1; af++; }
    return `${String(dia).padStart(2,'0')}/${String(mf).padStart(2,'0')}/${af}`;
  }

  return { processar, calcularVencimento };

})();