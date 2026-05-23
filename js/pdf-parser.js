// ============================================================
//  NegaPay — PDF Parser v5.0 DEFINITIVO
//  Baseado no texto real extraído do PDF Bradesco.
//  Padrão confirmado:
//    "DD\nDESCRIÇÃO VALOR\nMES"  (dia ANTES, mês DEPOIS)
//  Estratégia: processa linha a linha com lookahead para mês.
// ============================================================

const PDFParser = (() => {

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

  // ── Extrai linhas reais do PDF (uma por item de texto) ───
  async function extrairLinhas(file) {
    await carregarPDFjs();
    const buf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
    const linhas = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page    = await pdf.getPage(p);
      const content = await page.getTextContent();
      // Cada item.str é uma "linha" do PDF
      content.items.forEach(item => {
        const s = item.str.trim();
        if (s) linhas.push(s);
      });
    }
    return linhas;
  }

  const MESES = {
    JAN:'01',FEV:'02',MAR:'03',ABR:'04',MAI:'05',JUN:'06',
    JUL:'07',AGO:'08',SET:'09',OUT:'10',NOV:'11',DEZ:'12'
  };

  function isMes(s)  { return MESES.hasOwnProperty(s.trim().toUpperCase()); }
  function isDia(s)  { const n = parseInt(s); return /^\d{1,2}$/.test(s.trim()) && n >= 1 && n <= 31; }
  function isValor(s){ return /^-?\d{1,3}(\.\d{3})*(,\d{2})$/.test(s.trim()); }

  function parseValor(s) {
    const n = parseFloat(s.replace(/\./g,'').replace(',','.'));
    return isNaN(n) ? null : n;
  }

  // Linhas que identificam início/fim de seção ou devem ser ignoradas
  const IGNORAR_LINHAS = [
    /^Data\s+Lançamentos/i,
    /^Moeda de Origem/i,
    /^Valor \(US\$\)/i,
    /^Cotação/i,
    /^Valor \(R\$\)/i,
    /^Resumo das Despesas/i,
    /^Saldo anterior/i,
    /^\(-\)Pagamentos/i,
    /^\(\+\)Despesas/i,
    /^Despesas no exterior/i,
    /^Pagamento mínimo/i,
    /^\(=\)Total/i,
    /^Taxas Mensais/i,
    /^Taxa ao/i,
    /^Pagamento de contas/i,
    /^Parcelamento de fatura/i,
    /^Compras parceladas/i,
    /^Rotativo/i,
    /^Saque/i,
    /^Crediário/i,
    /^A falta de pagamento/i,
    /^Fatura e\/ou/i,
    /^\+ IOF/i,
    /^Total da fatura \(final/i,
    /^\*Extrato em Aberto/i,
    /^Fatura\s+Data/i,
    /^Cartao selecionado/i,
    /^Data de vencimento/i,
    /^Total da fatura:/i,
    /^Forma de pagamento/i,
    /^Melhor data de compra/i,
    /^Valor da fatura anterior/i,
    /^\*{4}/,
    /^Validade/i,
  ];

  function deveIgnorar(linha) {
    return IGNORAR_LINHAS.some(r => r.test(linha.trim()));
  }

  function limparDesc(s) {
    return s.replace(/\(\s*\d{2}\/\d{2}\s*\)/g,'').replace(/\s+/g,' ').trim();
  }

  // ── Parser principal ─────────────────────────────────────
  async function processar(file, banco, mesAno) {
    const linhas = await extrairLinhas(file);

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
    let diaBuffer   = null; // dia pendente aguardando mês

    const salvarSecao = () => {
      if (!secaoAtual || !finaisPrimo.includes(secaoAtual.final)) return;
      const cfg = banco.cartoesPrimo.find(c => c.final === secaoAtual.final);
      resultado.cartoes.push({
        final:       secaoAtual.final,
        apelido:     cfg?.apelido || `Cartão ${secaoAtual.final}`,
        titular:     secaoAtual.titular,
        lancamentos: [...lancamentos],
        subtotal:    totalSecao
      });
      resultado.totalGeral += totalSecao;
    };

    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i].trim();

      // ── Cabeçalho de seção ───────────────────────────────
      // "Gastos referentes ao cartão: Final 9087 | GETLIO R D S FARIAS Valor da fatura: R$ 1.403,36"
      const mSecao = linha.match(/Final\s+(\d{4})\s*\|\s*(.+?)(?:\s+Valor da fatura[:\s]+R\$\s*([\d.,]+))?$/i);
      if (mSecao) {
        salvarSecao();
        secaoAtual  = { final: mSecao[1], titular: mSecao[2].trim() };
        lancamentos = [];
        totalSecao  = mSecao[3] ? (parseValor(mSecao[3]) || 0) : 0;
        diaBuffer   = null;
        continue;
      }

      if (!secaoAtual) continue;

      // ── Total da seção (caso não venha no cabeçalho) ─────
      const mTotal = linha.match(/Valor da fatura[:\s]+R\$\s*([\d.,]+)/i);
      if (mTotal) {
        const v = parseValor(mTotal[1]);
        if (v !== null) totalSecao = v;
        continue;
      }

      // ── Ignora linhas de controle ────────────────────────
      if (deveIgnorar(linha)) { diaBuffer = null; continue; }

      // ── Dia isolado (ex: "11") ───────────────────────────
      if (isDia(linha) && !isValor(linha)) {
        diaBuffer = linha.trim().padStart(2,'0');
        continue;
      }

      // ── Mês isolado (ex: "MAI") ──────────────────────────
      // O mês confirma a data do lançamento anterior
      if (isMes(linha)) {
        // O mês já foi processado junto com o lançamento
        // via diaBuffer — só limpa o buffer
        diaBuffer = null;
        continue;
      }

      // ── Lançamento: "DESCRIÇÃO VALOR" ────────────────────
      // Ex: "MP *58PRODUTOS -84,95"
      // Ex: "MERCADOLIVRE*MERCADOLIVRE ( 01/05 ) 70,98"
      // Ex: "KIWIFY*JTechContr ( 01/12 ) 36,15"
      const mLanc = linha.match(/^(.+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})$/);
      if (mLanc) {
        const desc  = limparDesc(mLanc[1]);
        const valor = parseValor(mLanc[2]);

        if (desc && valor !== null && !deveIgnorar(desc) && desc.length >= 2) {
          // Pega o mês da próxima linha se disponível
          const proximaMes = linhas[i + 1] ? linhas[i + 1].trim() : '';
          let mes = '??';
          if (isMes(proximaMes)) {
            mes = MESES[proximaMes.toUpperCase()];
            i++; // consome a linha do mês
          }

          const data = diaBuffer ? `${diaBuffer}/${mes}` : `??/${mes}`;

          lancamentos.push({ data, descricao: desc, valor, tipo: valor < 0 ? 'estorno' : 'compra' });
          diaBuffer = null;
        }
        continue;
      }
    }

    salvarSecao();
    return resultado;
  }

  // ── Calcula vencimento ───────────────────────────────────
  function calcularVencimento(dia, mesAno) {
    const [mes, ano] = mesAno.split('/').map(Number);
    let mf = mes + 1, af = ano;
    if (mf > 12) { mf = 1; af++; }
    return `${String(dia).padStart(2,'0')}/${String(mf).padStart(2,'0')}/${af}`;
  }

  return { processar, calcularVencimento };

})();