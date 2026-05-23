// ============================================================
//  NegaPay — PDF Parser v4.0
//  Usa índices manuais de "Final XXXX" para dividir blocos,
//  sem depender de regex multiline entre páginas.
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

  // ── Extrai texto completo (todas as páginas concatenadas) ─
  async function extrairTexto(file) {
    await carregarPDFjs();
    const buf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
    let texto = '';
    for (let p = 1; p <= pdf.numPages; p++) {
      const page    = await pdf.getPage(p);
      const content = await page.getTextContent();
      texto += ' ' + content.items.map(i => i.str).join(' ');
    }
    // Normaliza espaços múltiplos
    return texto.replace(/\s+/g, ' ').trim();
  }

  // ── Converte valor BR para número ────────────────────────
  function parseValor(str) {
    if (!str) return null;
    const s = str.trim().replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  const MESES = {
    JAN:'01',FEV:'02',MAR:'03',ABR:'04',MAI:'05',JUN:'06',
    JUL:'07',AGO:'08',SET:'09',OUT:'10',NOV:'11',DEZ:'12'
  };

  // ── Extrai lançamentos de um bloco ───────────────────────
  function extrairLancamentos(bloco) {
    const lancamentos = [];

    // Encontra todas as posições de data "DD MES" no bloco
    const regexData = /\b(\d{1,2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\b/gi;
    const posicoes  = [];
    let m;
    while ((m = regexData.exec(bloco)) !== null) {
      posicoes.push({
        index: m.index,
        end:   m.index + m[0].length,
        data:  `${m[1].padStart(2,'0')}/${MESES[m[2].toUpperCase()]}`
      });
    }

    for (let i = 0; i < posicoes.length; i++) {
      const pos    = posicoes[i];
      const fim    = posicoes[i + 1] ? posicoes[i + 1].index : bloco.length;
      const trecho = bloco.slice(pos.end, fim).trim();

      // Extrai todos os pares "descrição + valor" no trecho
      // Valor: número com vírgula decimal, pode ter sinal negativo
      const regexLanc = /(.+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})(?=\s|$)/g;
      let match;
      while ((match = regexLanc.exec(trecho)) !== null) {
        const desc  = limparDesc(match[1]);
        const valor = parseValor(match[2]);

        if (!desc || valor === null) continue;
        if (deveIgnorar(desc)) continue;
        if (desc.length < 2) continue;

        lancamentos.push({
          data:     pos.data,
          descricao: desc,
          valor,
          tipo: valor < 0 ? 'estorno' : 'compra'
        });
      }
    }

    return lancamentos;
  }

  const BLOQUEIOS = [
    'saldo anterior', 'pagto', 'pagamento por', 'data lançamentos',
    'moeda de origem', 'valor da fatura', 'total da fatura',
    'resumo das despesas', 'taxas mensais', 'parcelamento de fatura',
    'crédito rotativo', 'pagamento mínimo', 'despesas locais',
    'despesas no exterior', 'extrato em aberto', 'fatura anterior',
    'melhor data', 'forma de pagamento', 'débito em conta',
    'data de vencimento', 'total de fatura', 'cotação'
  ];

  function deveIgnorar(str) {
    const s = str.toLowerCase();
    return BLOQUEIOS.some(b => s.includes(b));
  }

  function limparDesc(str) {
    return str
      .replace(/\(\s*\d{2}\/\d{2}\s*\)/g, '')
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

    // ── Encontra todas as ocorrências de "Final XXXX" ──────
    const regexFinal = /Final\s+(\d{4})\s*\|\s*([\w\s]+?)(?=\s+(?:Valor|Data|Final|\d{1,2}\s+(?:JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)))/gi;
    const secoes = [];
    let sm;
    while ((sm = regexFinal.exec(texto)) !== null) {
      secoes.push({
        final:   sm[1],
        titular: sm[2].trim(),
        index:   sm.index
      });
    }

    // ── Para cada seção, extrai o bloco até a próxima ──────
    for (let i = 0; i < secoes.length; i++) {
      const secao = secoes[i];
      if (!finaisPrimo.includes(secao.final)) continue;

      const inicio = secao.index;
      const fim    = secoes[i + 1] ? secoes[i + 1].index : texto.length;
      const bloco  = texto.slice(inicio, fim);

      // Total da seção (calculado pelo Bradesco)
      const mTotal   = bloco.match(/Valor da fatura[:\s]+R\$\s*([\d.,]+)/i);
      const subtotal = mTotal ? (parseValor(mTotal[1]) || 0) : 0;

      // Lançamentos
      const lancamentos = extrairLancamentos(bloco);

      const cfg = banco.cartoesPrimo.find(c => c.final === secao.final);
      resultado.cartoes.push({
        final:       secao.final,
        apelido:     cfg?.apelido || `Cartão ${secao.final}`,
        titular:     secao.titular,
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