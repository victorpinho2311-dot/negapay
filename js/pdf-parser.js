// ============================================================
//  NegaPay — PDF Parser v3.0
//  Estratégia: extrai texto completo, divide em blocos por
//  cartão usando o padrão "Final XXXX", usa total já calculado
//  pelo Bradesco e extrai lançamentos por regex no bloco.
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

  // ── Extrai texto de cada página separadamente ────────────
  async function extrairTexto(file) {
    await carregarPDFjs();
    const buf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
    const paginas = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page    = await pdf.getPage(p);
      const content = await page.getTextContent();
      paginas.push(content.items.map(i => i.str).join(' '));
    }
    return paginas.join('\n---PAGINA---\n');
  }

  // ── Converte valor BR para número ────────────────────────
  function parseValor(str) {
    if (!str) return null;
    const s = str.trim().replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  // ── Meses PT ─────────────────────────────────────────────
  const MESES = {
    JAN:'01',FEV:'02',MAR:'03',ABR:'04',MAI:'05',JUN:'06',
    JUL:'07',AGO:'08',SET:'09',OUT:'10',NOV:'11',DEZ:'12'
  };

  // ── Extrai lançamentos de um bloco de texto de cartão ────
  function extrairLancamentos(bloco) {
    const lancamentos = [];

    // Normaliza espaços
    const texto = bloco.replace(/\s+/g, ' ').trim();

    // Padrão: número dia (1-31) + mês (JAN..DEZ) + descrição + valor
    // Ex: "11 MAI MP *58PRODUTOS -84,95"
    // Ex: "18 ABR DL *AliExpress BR Alip ( 02/12 ) 123,81"
    // Ex: "17 MAI RAIA202 26,89  TAUSTE SUPERMERCADOS 179,56"
    // Estratégia: encontra todas as ocorrências de "DD MES" e
    // divide o texto nesses pontos, processando cada fragmento

    const regexData = /\b(\d{1,2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\b/gi;
    const posicoes = [];
    let m;
    while ((m = regexData.exec(texto)) !== null) {
      posicoes.push({ index: m.index, dia: m[1], mes: m[2].toUpperCase(), end: m.index + m[0].length });
    }

    for (let i = 0; i < posicoes.length; i++) {
      const pos   = posicoes[i];
      const data  = `${pos.dia.padStart(2,'0')}/${MESES[pos.mes]}`;
      const fim   = posicoes[i + 1] ? posicoes[i + 1].index : texto.length;
      const trecho = texto.slice(pos.end, fim).trim();

      // Dentro do trecho, extrai pares "descrição valor"
      // Um valor é: -?digits(,digits)(.digits)* com vírgula decimal
      const regexLanc = /(.+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})(?=\s|$)/g;
      let match;
      while ((match = regexLanc.exec(trecho)) !== null) {
        const desc  = limparDesc(match[1]);
        const valor = parseValor(match[2]);

        if (!desc || valor === null) continue;
        if (deveIgnorar(desc)) continue;
        if (desc.length < 2) continue;

        lancamentos.push({
          data,
          descricao: desc,
          valor,
          tipo: valor < 0 ? 'estorno' : 'compra'
        });
      }
    }

    return lancamentos;
  }

  // ── Termos a ignorar ──────────────────────────────────────
  const BLOQUEIOS = [
    'saldo anterior', 'pagto', 'pagamento', 'data lançamentos',
    'moeda de origem', 'valor da fatura', 'total da fatura',
    'resumo das despesas', 'taxas mensais', 'parcelamento',
    'crédito rotativo', 'pagamento mínimo', 'despesas locais',
    'despesas no exterior', 'extrato em aberto'
  ];

  function deveIgnorar(str) {
    const s = str.toLowerCase();
    return BLOQUEIOS.some(b => s.includes(b));
  }

  function limparDesc(str) {
    return str
      .replace(/\(\s*\d{2}\/\d{2}\s*\)/g, '') // remove ( 02/10 )
      .replace(/•/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ── Parser principal ─────────────────────────────────────
  async function processar(file, banco, mesAno) {
    const texto = await extrairTexto(file);

    const resultado = {
      mesAno,
      banco:      banco.id,
      vencimento: calcularVencimento(banco.diaVencimento, mesAno),
      cartoes:    [],
      totalGeral: 0
    };

    const finaisPrimo = banco.cartoesPrimo.map(c => c.final);

    // Divide o texto em blocos por seção de cartão
    // Padrão: "Final XXXX | NOME ... Valor da fatura: R$ X"
    // Usamos split com captura para manter os delimitadores
    const regexSecao = /Final\s+(\d{4})\s*\|\s*([^\n]+?)(?=Final\s+\d{4}|$)/gi;

    let match;
    while ((match = regexSecao.exec(texto)) !== null) {
      const final   = match[1];
      const titular = match[2].split(/Valor da fatura|Data Lançamentos/)[0].trim();
      const bloco   = match[0];

      if (!finaisPrimo.includes(final)) continue;

      // Extrai total da seção
      const mTotal = bloco.match(/Valor da fatura[:\s]+R\$\s*([\d.,]+)/i);
      const subtotal = mTotal ? (parseValor(mTotal[1]) || 0) : 0;

      // Extrai lançamentos
      const lancamentos = extrairLancamentos(bloco);

      const cfg = banco.cartoesPrimo.find(c => c.final === final);
      resultado.cartoes.push({
        final,
        apelido:  cfg?.apelido || `Cartão ${final}`,
        titular:  titular.replace(/Valor da fatura.*/i, '').trim(),
        lancamentos,
        subtotal
      });

      resultado.totalGeral += subtotal;
    }

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