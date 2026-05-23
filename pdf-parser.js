// ============================================================
//  NegaPay — PDF Parser
//  Extrai lançamentos dos cartões do primo a partir do PDF
//  da fatura Bradesco usando PDF.js (carregado via CDN).
// ============================================================

const PDFParser = (() => {

  // ── Carrega PDF.js via CDN ───────────────────────────────
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

  // ── Extrai todo o texto do PDF página a página ───────────
  async function extrairTexto(file) {
    await carregarPDFjs();

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let textoCompleto = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const linhas = content.items.map(item => item.str).join(' ');
      textoCompleto += linhas + '\n';
    }

    return textoCompleto;
  }

  // ── Converte valor brasileiro para número ────────────────
  // Ex: "1.234,56" → 1234.56 | "-529,90" → -529.90
  function parseValor(str) {
    if (!str) return 0;
    const limpo = str.trim().replace(/\./g, '').replace(',', '.');
    return parseFloat(limpo) || 0;
  }

  // ── Normaliza data para formato legível ──────────────────
  // Ex: "11 MAI" → "11/05"
  function normalizarData(dia, mes) {
    const meses = {
      JAN: '01', FEV: '02', MAR: '03', ABR: '04',
      MAI: '05', JUN: '06', JUL: '07', AGO: '08',
      SET: '09', OUT: '10', NOV: '11', DEZ: '12'
    };
    return `${dia.padStart(2, '0')}/${meses[mes.toUpperCase()] || mes}`;
  }

  // ── Parser principal ─────────────────────────────────────
  /**
   * Processa o arquivo PDF e retorna apenas os cartões do primo.
   * @param {File} file - arquivo PDF do input
   * @param {Object} banco - configuração do banco (de config.js)
   * @param {string} mesAno - ex: "05/2026"
   * @returns {Object} resultado com cartoes[], totalGeral, mesAno, vencimento
   */
  async function processar(file, banco, mesAno) {
    const texto = await extrairTexto(file);

    // Divide o texto em seções por cartão
    // Cada seção começa com o padrão do banco
    const resultado = {
      mesAno,
      banco: banco.id,
      vencimento: calcularVencimento(banco.diaVencimento, mesAno),
      cartoes: [],
      totalGeral: 0,
      textoCompleto: texto // mantém para debug
    };

    // Tokeniza o texto em linhas limpas
    const linhas = texto
      .split(/\n/)
      .map(l => l.trim())
      .filter(l => l.length > 0);

    // Identifica quais finais de cartão pertencem ao primo
    const finaisPrimo = banco.cartoesPrimo.map(c => c.final);

    let secaoAtual = null;
    let lancamentosSecao = [];
    let totalSecao = 0;
    let dataAtual = null;

    const processarSecao = () => {
      if (!secaoAtual) return;
      if (!finaisPrimo.includes(secaoAtual.final)) return;

      const configCartao = banco.cartoesPrimo.find(c => c.final === secaoAtual.final);
      resultado.cartoes.push({
        final: secaoAtual.final,
        apelido: configCartao?.apelido || `Cartão ${secaoAtual.final}`,
        titular: secaoAtual.titular,
        lancamentos: lancamentosSecao,
        subtotal: totalSecao
      });
      resultado.totalGeral += totalSecao;
    };

    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];

      // ── Detecta início de nova seção de cartão ───────────
      const matchSecao = linha.match(banco.padraoSecao);
      if (matchSecao) {
        processarSecao(); // fecha seção anterior
        secaoAtual = {
          final: matchSecao[1],
          titular: matchSecao[2].trim()
        };
        lancamentosSecao = [];
        totalSecao = 0;
        dataAtual = null;
        continue;
      }

      if (!secaoAtual) continue;

      // ── Detecta total da seção ───────────────────────────
      const matchTotal = linha.match(banco.padraoTotal);
      if (matchTotal) {
        totalSecao = parseValor(matchTotal[1]);
        continue;
      }

      // ── Detecta data (DD MES) ────────────────────────────
      // O PDF do Bradesco às vezes tem data na linha separada
      const matchData = linha.match(/^(\d{1,2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)$/i);
      if (matchData) {
        dataAtual = normalizarData(matchData[1], matchData[2]);
        continue;
      }

      // ── Detecta lançamento com data na mesma linha ───────
      const matchLancComData = linha.match(
        /^(\d{1,2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s+(.+?)\s+([-]?\d{1,3}(?:\.\d{3})*,\d{2})$/i
      );
      if (matchLancComData) {
        const data = normalizarData(matchLancComData[1], matchLancComData[2]);
        const descricao = limparDescricao(matchLancComData[3]);
        const valor = parseValor(matchLancComData[4]);
        lancamentosSecao.push({ data, descricao, valor, tipo: valor < 0 ? 'estorno' : 'compra' });
        dataAtual = data;
        continue;
      }

      // ── Detecta lançamento sem data (usa data anterior) ──
      const matchLancSemData = linha.match(
        /^(.+?)\s+([-]?\d{1,3}(?:\.\d{3})*,\d{2})$/
      );
      if (matchLancSemData && dataAtual) {
        const descricao = limparDescricao(matchLancSemData[1]);
        const valor = parseValor(matchLancSemData[2]);

        // Ignora linhas de controle (pagamentos, saldo anterior, etc.)
        const ignorar = ['SALDO ANTERIOR', 'PAGTO.', 'PAGAMENTO', 'Total da fatura'];
        if (ignorar.some(ig => descricao.toUpperCase().includes(ig.toUpperCase()))) continue;

        lancamentosSecao.push({ data: dataAtual, descricao, valor, tipo: valor < 0 ? 'estorno' : 'compra' });
        continue;
      }
    }

    // Fecha última seção
    processarSecao();

    return resultado;
  }

  // ── Remove informações de parcelamento da descrição ──────
  // Ex: "MERCADOLIVRE*PRODUTO ( 02/10 )" → "MERCADOLIVRE*PRODUTO"
  // Mantém o parcelamento como metadado separado
  function limparDescricao(descricao) {
    return descricao
      .replace(/\(\s*\d{2}\/\d{2}\s*\)/g, '')   // remove ( 02/10 )
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ── Extrai info de parcelamento ──────────────────────────
  function extrairParcelamento(descricao) {
    const match = descricao.match(/\(\s*(\d{2})\/(\d{2})\s*\)/);
    if (!match) return null;
    return { parcela: parseInt(match[1]), total: parseInt(match[2]) };
  }

  // ── Calcula data de vencimento para o mesAno ─────────────
  // mesAno: "05/2026", diaVencimento: 5
  // → vencimento no mês seguinte: "05/06/2026"
  function calcularVencimento(dia, mesAno) {
    const [mes, ano] = mesAno.split('/').map(Number);
    let mesFatura = mes + 1;
    let anoFatura = ano;
    if (mesFatura > 12) { mesFatura = 1; anoFatura++; }
    return `${String(dia).padStart(2, '0')}/${String(mesFatura).padStart(2, '0')}/${anoFatura}`;
  }

  return { processar, calcularVencimento };

})();
