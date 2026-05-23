// ============================================================
//  NegaPay — Parser v6.0 — CSV + PDF
//  Aceita tanto CSV (Bradesco) quanto PDF.
//  CSV é preferido por ser mais confiável.
//  Formato CSV Bradesco (Windows-1252, separador ";"):
//    NOME ;;; FINAL
//    Data;Histórico;Valor(US$);Valor(R$);
//    DD/MM;DESCRIÇÃO;0,00;VALOR
// ============================================================

const PDFParser = (() => {

  // ── Detecta tipo de arquivo ──────────────────────────────
  function isCSV(file) {
    return file.name.toLowerCase().endsWith('.csv') ||
           file.type === 'text/csv' ||
           file.type === 'application/vnd.ms-excel';
  }

  // ── Lê arquivo como texto com encoding Windows-1252 ──────
  async function lerArquivo(file, encoding = 'windows-1252') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = e => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsText(file, encoding);
    });
  }

  // ── Converte valor BR para número ────────────────────────
  function parseValor(str) {
    if (!str) return null;
    const s = str.trim().replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  // ── Remove parcelamento da descrição ─────────────────────
  // Ex: "MERCADOLIVRE*PRODUTO 1/5" → "MERCADOLIVRE*PRODUTO"
  function limparDesc(str) {
    return str
      .replace(/\s+\d{1,2}\/\d{1,2}\s*$/, '') // remove "1/5" no final
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ── Linhas a ignorar ──────────────────────────────────────
  const IGNORAR = [
    'SALDO ANTERIOR', 'PAGTO.', 'PAGAMENTO', 'Total da fatura',
    'Resumo', 'Saldo Anterior', 'Pagamentos/Créditos',
    'Despesas locais', 'Despesas no exterior', 'Pagamento mínimo'
  ];
  function deveIgnorar(desc) {
    return IGNORAR.some(ig => desc.toUpperCase().includes(ig.toUpperCase()));
  }

  // ════════════════════════════════════════════════════════
  //  PARSER CSV
  // ════════════════════════════════════════════════════════
  function processarCSV(texto, banco, mesAno) {
    const linhas = texto.split(/\r\n|\r|\n/);
    const finaisPrimo = banco.cartoesPrimo.map(c => c.final);

    const resultado = {
      mesAno,
      banco:      banco.id,
      vencimento: calcularVencimento(banco.diaVencimento, mesAno),
      cartoes:    [],
      totalGeral: 0
    };

    let secaoAtual  = null;
    let lancamentos = [];

    const salvarSecao = () => {
      if (!secaoAtual || !finaisPrimo.includes(secaoAtual.final)) return;
      const cfg = banco.cartoesPrimo.find(c => c.final === secaoAtual.final);

      // Calcula subtotal a partir dos lançamentos (valores já líquidos)
      const subtotal = lancamentos.reduce((sum, l) => sum + l.valor, 0);

      resultado.cartoes.push({
        final:       secaoAtual.final,
        apelido:     cfg?.apelido || `Cartão ${secaoAtual.final}`,
        titular:     secaoAtual.titular,
        lancamentos: [...lancamentos],
        subtotal:    Math.round(subtotal * 100) / 100
      });
      resultado.totalGeral += Math.round(subtotal * 100) / 100;
    };

    for (const linha of linhas) {
      const cols = linha.split(';');

      // ── Cabeçalho de cartão ────────────────────────────
      // "GETLIO R D S FARIAS ;;; 9087"
      // cols[0] = "NOME", cols[3] = "FINAL"
      if (cols.length >= 4 && /^\d{4}$/.test(cols[3].trim())) {
        salvarSecao();
        secaoAtual  = {
          final:   cols[3].trim(),
          titular: cols[0].trim()
        };
        lancamentos = [];
        continue;
      }

      if (!secaoAtual) continue;

      // ── Linha de dados ─────────────────────────────────
      // "DD/MM;DESCRIÇÃO;0,00;VALOR"
      // cols[0]=data, cols[1]=desc, cols[2]=valorUS, cols[3]=valorBR
      if (cols.length >= 4 && /^\d{2}\/\d{2}/.test(cols[0].trim())) {
        const data    = cols[0].trim(); // já vem como DD/MM
        const desc    = limparDesc(cols[1]);
        const valor   = parseValor(cols[3]);

        if (!desc || valor === null) continue;
        if (deveIgnorar(desc)) continue;

        lancamentos.push({
          data,
          descricao: desc,
          valor,
          tipo: valor < 0 ? 'estorno' : 'compra'
        });
      }
    }

    salvarSecao();
    return resultado;
  }

  // ════════════════════════════════════════════════════════
  //  PARSER PDF (fallback)
  // ════════════════════════════════════════════════════════
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

  async function processarPDF(file, banco, mesAno) {
    await carregarPDFjs();
    const buf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
    const linhas = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page    = await pdf.getPage(p);
      const content = await page.getTextContent();
      content.items.forEach(item => {
        const s = item.str.trim();
        if (s) linhas.push(s);
      });
    }
    // Reconstrói como CSV simulado usando o texto extraído
    // e chama o processador CSV após montar o texto
    // (simplificação — CSV é o caminho recomendado)
    return { mesAno, banco: banco.id,
      vencimento: calcularVencimento(banco.diaVencimento, mesAno),
      cartoes: [], totalGeral: 0,
      erro: 'Use o formato CSV para melhor resultado'
    };
  }

  // ════════════════════════════════════════════════════════
  //  ENTRY POINT
  // ════════════════════════════════════════════════════════
  async function processar(file, banco, mesAno) {
    if (isCSV(file)) {
      const texto = await lerArquivo(file, 'windows-1252');
      return processarCSV(texto, banco, mesAno);
    } else {
      return processarPDF(file, banco, mesAno);
    }
  }

  function calcularVencimento(dia, mesAno) {
    const [mes, ano] = mesAno.split('/').map(Number);
    let mf = mes + 1, af = ano;
    if (mf > 12) { mf = 1; af++; }
    return `${String(dia).padStart(2,'0')}/${String(mf).padStart(2,'0')}/${af}`;
  }

  return { processar, calcularVencimento };

})();