// ============================================================
//  NegaPay — PDF Parser v1.2
//  Usa coordenadas X/Y do PDF.js para reconstruir linhas
//  corretamente, independente de quebras de texto.
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

  // ── Extrai itens com posição de todas as páginas ─────────
  async function extrairItens(file) {
    await carregarPDFjs();
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    const todosItens = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page    = await pdf.getPage(p);
      const content = await page.getTextContent();
      const vp      = page.getViewport({ scale: 1 });

      content.items.forEach(item => {
        if (!item.str || !item.str.trim()) return;
        todosItens.push({
          texto: item.str.trim(),
          x: Math.round(item.transform[4]),
          y: Math.round(vp.height - item.transform[5]), // inverte Y (PDF origin = bottom)
          pagina: p
        });
      });
    }
    return todosItens;
  }

  // ── Agrupa itens em linhas por proximidade vertical ──────
  function agruparEmLinhas(itens, toleranciaY = 4) {
    const linhas = [];
    let linhaAtual = [];
    let yAtual = null;

    // Ordena por página → Y → X
    itens.sort((a, b) => a.pagina - b.pagina || a.y - b.y || a.x - b.x);

    for (const item of itens) {
      if (yAtual === null || Math.abs(item.y - yAtual) <= toleranciaY) {
        linhaAtual.push(item);
        yAtual = yAtual === null ? item.y : (yAtual + item.y) / 2;
      } else {
        if (linhaAtual.length) {
          linhas.push(linhaAtual.sort((a, b) => a.x - b.x));
        }
        linhaAtual = [item];
        yAtual = item.y;
      }
    }
    if (linhaAtual.length) linhas.push(linhaAtual.sort((a, b) => a.x - b.x));

    return linhas.map(linha => linha.map(i => i.texto).join(' '));
  }

  // ── Converte valor BR para número ────────────────────────
  function parseValor(str) {
    if (!str) return null;
    const limpo = str.trim().replace(/\./g, '').replace(',', '.');
    const n = parseFloat(limpo);
    return isNaN(n) ? null : n;
  }

  // ── Normaliza mês abreviado para número ──────────────────
  function mesNum(mes) {
    const m = { JAN:'01',FEV:'02',MAR:'03',ABR:'04',MAI:'05',JUN:'06',
                JUL:'07',AGO:'08',SET:'09',OUT:'10',NOV:'11',DEZ:'12' };
    return m[mes.toUpperCase()] || '00';
  }

  // ── Parser principal ─────────────────────────────────────
  async function processar(file, banco, mesAno) {
    const itens  = await extrairItens(file);
    const linhas = agruparEmLinhas(itens);

    const resultado = {
      mesAno,
      banco: banco.id,
      vencimento: calcularVencimento(banco.diaVencimento, mesAno),
      cartoes: [],
      totalGeral: 0
    };

    const finaisPrimo = banco.cartoesPrimo.map(c => c.final);

    let secaoAtual     = null;
    let lancamentos    = [];
    let totalSecao     = 0;
    let dataAtual      = null;

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

    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];

      // ── Cabeçalho de seção ───────────────────────────────
      // "Gastos referentes ao cartão: Final 9087 | GETLIO R D S FARIAS"
      const mSecao = linha.match(/Gastos referentes ao cart[aã]o[:\s]+Final\s+(\d{4})\s*[|\|]\s*(.+)/i);
      if (mSecao) {
        salvarSecao();
        secaoAtual  = { final: mSecao[1], titular: mSecao[2].trim() };
        lancamentos = [];
        totalSecao  = 0;
        dataAtual   = null;
        continue;
      }

      if (!secaoAtual) continue;

      // ── Total da seção ───────────────────────────────────
      // "Valor da fatura: R$ 1.403,36"
      const mTotal = linha.match(/Valor da fatura[:\s]+R\$\s*([\d.,]+)/i);
      if (mTotal) {
        const v = parseValor(mTotal[1]);
        if (v !== null) totalSecao = v;
        continue;
      }

      // ── Data isolada ─────────────────────────────────────
      // "11 MAI" ou "11 MAI 2026"
      const mData = linha.match(/^(\d{1,2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)(\s+\d{4})?$/i);
      if (mData) {
        dataAtual = `${mData[1].padStart(2,'0')}/${mesNum(mData[2])}`;
        continue;
      }

      // ── Lançamento: data + descrição + valor na mesma linha ──
      // "11 MAI MP *58PRODUTOS -84,95"
      // "06 ABR MERCADOLIVRE*51PRODUTOS ( 02/10 ) 1.189,98"
      const mLancComData = linha.match(
        /^(\d{1,2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s+(.+?)\s+([-]?\d{1,3}(?:\.\d{3})*,\d{2})$/i
      );
      if (mLancComData) {
        const data      = `${mLancComData[1].padStart(2,'0')}/${mesNum(mLancComData[2])}`;
        const descricao = limparDesc(mLancComData[3]);
        const valor     = parseValor(mLancComData[4]);
        if (valor !== null && !ignorar(descricao)) {
          lancamentos.push({ data, descricao, valor, tipo: valor < 0 ? 'estorno' : 'compra' });
          dataAtual = data;
        }
        continue;
      }

      // ── Lançamento: apenas descrição + valor (sem data) ──
      // "MERCADOLIVRE*MERCADOLIVRE 89,90"
      const mLancSemData = linha.match(
        /^(.+?)\s+([-]?\d{1,3}(?:\.\d{3})*,\d{2})$/
      );
      if (mLancSemData && dataAtual) {
        const descricao = limparDesc(mLancSemData[1]);
        const valor     = parseValor(mLancSemData[2]);
        if (valor !== null && !ignorar(descricao) && descricao.length > 2) {
          lancamentos.push({ data: dataAtual, descricao, valor, tipo: valor < 0 ? 'estorno' : 'compra' });
        }
        continue;
      }
    }

    salvarSecao();
    return resultado;
  }

  // ── Remove info de parcelamento da descrição ─────────────
  function limparDesc(str) {
    return str.replace(/\(\s*\d{2}\/\d{2}\s*\)/g, '').replace(/\s+/g, ' ').trim();
  }

  // ── Linhas que devem ser ignoradas ───────────────────────
  function ignorar(desc) {
    const bloqueios = ['SALDO ANTERIOR', 'PAGTO', 'PAGAMENTO', 'Total da fatura',
                       'Valor da fatura', 'Data Lançamentos', 'Moeda de Origem'];
    return bloqueios.some(b => desc.toUpperCase().includes(b.toUpperCase()));
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