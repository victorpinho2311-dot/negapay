// ============================================================
//  NegaPay — Parser de fatura Bradesco (PDF)
//
//  Le o PDF da fatura e devolve os lancamentos por cartao.
//
//  O PDF e a fonte de verdade porque traz duas coisas que o CSV
//  nao tem: a data de vencimento e o total declarado por cartao
//  ("Valor da fatura: R$ X"). Esse total e usado como conferencia:
//  se a soma dos lancamentos nao bater com ele, o parser marca a
//  secao como divergente e o app se recusa a publicar.
//
//  A extracao usa a POSICAO de cada texto no PDF, nao o fluxo de
//  leitura. O fluxo de leitura quebra a linha do cabecalho em duas
//  quando o titular e o valor ficam distantes na horizontal.
// ============================================================

const ParserBradesco = (() => {

  const PDFJS_VERSION = '3.11.174';
  const CDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;

  // Tolerancia vertical (em pontos) para considerar que dois textos
  // estao na mesma linha. Medido nas faturas reais: partes da mesma
  // linha chegam a diferir 0,04pt, linhas distintas ficam acima de 8pt.
  const TOLERANCIA_LINHA = 3.0;

  const MESES = {
    JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6,
    JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12
  };

  const RE_INICIO_SECAO = /Gastos referentes ao cart[aã]o:\s*Final\s*(\d{4})\s*\|\s*(.*)/;
  const RE_VALOR_DECLARADO = /Valor da fatura:\s*(-?)R\$\s*(-?[\d.,]+)/;
  const RE_FIM_SECAO = /Total da fatura\s*\(final|Resumo das Despesas|Taxas Mensais/;
  const RE_VALOR = /^-?[\d.]{1,12},\d{2}$/;
  const RE_PARCELA = /\(\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\)/;
  const RE_VENCIMENTO = /Data de vencimento:\s*(\d{2})\/(\d{2})\/(\d{4})/;
  const RE_TOTAL_FATURA = /Total da fatura:\s*(-?)R\$\s*(-?[\d.,]+)/;
  const RE_SO_DIA = /^\d{1,2}$/;
  // Capa da fatura: "**** **** **** 2737". Identifica QUAL fatura e esta —
  // o nome do produto (Infinite, Aeternum) nao aparece no PDF, mas o cartao
  // titular da capa e unico por produto e vem sempre na primeira pagina.
  const RE_CARTAO_CAPA = /\*{4}\s*\*{4}\s*\*{4}\s*(\d{4})/;

  // ── Converte "1.234,56" em centavos (inteiro) ──────────────
  // Dinheiro em centavos, nunca em ponto flutuante: somar 0.1+0.2
  // em float ja da 0.30000000000000004, e aqui a soma precisa
  // fechar exatamente com o total declarado pelo banco.
  function paraCentavos(texto) {
    if (!texto) return null;
    const limpo = String(texto).trim().replace(/\./g, '').replace(',', '.');
    if (!/^-?\d+(\.\d{1,2})?$/.test(limpo)) return null;
    return Math.round(parseFloat(limpo) * 100);
  }

  function formatarMoeda(centavos) {
    const v = (centavos / 100).toLocaleString('pt-BR', {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
    return `R$ ${v}`;
  }

  // ── Carrega o pdf.js sob demanda ───────────────────────────
  function carregarPDFjs() {
    return new Promise((resolve, reject) => {
      if (window.pdfjsLib) return resolve();
      const script = document.createElement('script');
      script.src = `${CDN}/pdf.min.js`;
      script.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${CDN}/pdf.worker.min.js`;
        resolve();
      };
      script.onerror = () => reject(new Error('Nao foi possivel carregar o leitor de PDF.'));
      document.head.appendChild(script);
    });
  }

  // ── Extrai as linhas do PDF agrupando por posicao vertical ──
  async function extrairLinhas(dados, pdfjsLib) {
    const lib = pdfjsLib || window.pdfjsLib;
    const pdf = await lib.getDocument({ data: dados }).promise;
    const linhas = [];

    for (let p = 1; p <= pdf.numPages; p++) {
      const pagina = await pdf.getPage(p);
      const conteudo = await pagina.getTextContent();

      const itens = conteudo.items
        .filter(i => i.str && i.str.trim())
        .map(i => ({
          texto: i.str.trim(),
          x: i.transform[4],
          y: i.transform[5]
        }))
        // y cresce para cima no PDF: ordem de leitura e y decrescente
        .sort((a, b) => (b.y - a.y) || (a.x - b.x));

      let grupo = [];
      let baseY = null;
      for (const item of itens) {
        if (baseY === null || Math.abs(item.y - baseY) <= TOLERANCIA_LINHA) {
          if (baseY === null) baseY = item.y;
          grupo.push(item);
        } else {
          linhas.push(grupo.sort((a, b) => a.x - b.x));
          grupo = [item];
          baseY = item.y;
        }
      }
      if (grupo.length) linhas.push(grupo.sort((a, b) => a.x - b.x));
    }

    return linhas;
  }

  // ── Percorre as linhas e monta as secoes por cartao ────────
  function interpretar(linhas) {
    const cartoes = [];
    let atual = null;
    let dia = null;
    let mes = null;
    // O mes aparece DEPOIS do primeiro lancamento do dia no layout do
    // Bradesco ("24" / "MONSTER BURGUER 64,00" / "JUN"), entao os
    // lancamentos sem mes ficam pendentes e recebem o mes quando ele vem.
    let pendentes = [];

    const fixarMes = (m) => {
      pendentes.forEach(l => { l.mes = m; });
      pendentes = [];
    };

    let vencimento = null;
    let totalFatura = null;
    let cartaoCapa = null;

    for (const linha of linhas) {
      const texto = linha.map(i => i.texto).join(' ').replace(/\s+/g, ' ').trim();

      if (vencimento === null) {
        const v = texto.match(RE_VENCIMENTO);
        if (v) vencimento = `${v[1]}/${v[2]}/${v[3]}`;
      }
      if (cartaoCapa === null) {
        const c = texto.match(RE_CARTAO_CAPA);
        if (c) cartaoCapa = c[1];
      }
      if (totalFatura === null) {
        const t = texto.match(RE_TOTAL_FATURA);
        if (t) {
          const c = paraCentavos(t[2]);
          if (c !== null) totalFatura = t[1] === '-' ? -c : c;
        }
      }

      if (RE_FIM_SECAO.test(texto)) {
        fixarMes(mes);
        atual = null;
        continue;
      }

      const inicio = texto.match(RE_INICIO_SECAO);
      if (inicio) {
        fixarMes(mes);
        const declarada = texto.match(RE_VALOR_DECLARADO);
        let declarado = null;
        if (declarada) {
          const c = paraCentavos(declarada[2]);
          if (c !== null) declarado = declarada[1] === '-' ? -c : c;
        }
        const titular = inicio[2].replace(RE_VALOR_DECLARADO, '').trim();

        atual = {
          final: inicio[1],
          titular,
          declarado,
          lancamentos: []
        };
        cartoes.push(atual);
        dia = null;
        mes = null;
        continue;
      }

      if (!atual) continue;
      if (texto.startsWith('Data Lançamentos') || texto.startsWith('Data Lancamentos')) continue;

      if (RE_SO_DIA.test(texto)) {
        dia = parseInt(texto, 10);
        continue;
      }
      const chaveMes = texto.toUpperCase();
      if (MESES[chaveMes]) {
        mes = MESES[chaveMes];
        fixarMes(mes);
        continue;
      }

      // Linha de lancamento: o ultimo texto da linha e o valor em reais
      const ultimo = linha[linha.length - 1];
      if (linha.length >= 2 && RE_VALOR.test(ultimo.texto)) {
        const valor = paraCentavos(ultimo.texto);
        if (valor === null) continue;

        let descricao = linha.slice(0, -1).map(i => i.texto).join(' ');
        const parc = descricao.match(RE_PARCELA);
        const parcela = parc ? `${parseInt(parc[1], 10)}/${parseInt(parc[2], 10)}` : null;
        descricao = descricao.replace(RE_PARCELA, '').replace(/\s+/g, ' ').trim();
        if (!descricao) continue;

        const lanc = {
          dia, mes, descricao, parcela, valor,
          tipo: valor < 0 ? 'estorno' : 'compra'
        };
        atual.lancamentos.push(lanc);
        if (mes === null) pendentes.push(lanc);
      }
    }
    fixarMes(mes);

    return { cartoes, vencimento, totalFatura, cartaoCapa };
  }

  // ── Confere cada secao contra o total declarado pelo banco ──
  function conferir(cartoes) {
    return cartoes.map(c => {
      const soma = c.lancamentos.reduce((s, l) => s + l.valor, 0);
      const temDeclarado = c.declarado !== null && c.declarado !== undefined;
      return {
        ...c,
        subtotal: soma,
        confere: temDeclarado ? soma === c.declarado : null,
        diferenca: temDeclarado ? soma - c.declarado : null
      };
    });
  }

  // ── Data do lancamento como DD/MM ──────────────────────────
  function formatarDataLancamento(lanc) {
    if (!lanc.dia || !lanc.mes) return '';
    return String(lanc.dia).padStart(2, '0') + '/' + String(lanc.mes).padStart(2, '0');
  }

  // ════════════════════════════════════════════════════════
  //  ENTRADA PRINCIPAL
  // ════════════════════════════════════════════════════════
  async function processar(arquivo, opcoes = {}) {
    if (!/\.pdf$/i.test(arquivo.name) && arquivo.type !== 'application/pdf') {
      throw new Error('Envie o PDF da fatura. O CSV nao traz a data de vencimento nem o total por cartao, entao nao da para conferir se a conta fechou.');
    }

    await carregarPDFjs();
    const dados = await arquivo.arrayBuffer();
    const linhas = await extrairLinhas(dados, opcoes.pdfjsLib);
    const { cartoes, vencimento, totalFatura, cartaoCapa } = interpretar(linhas);

    if (!cartoes.length) {
      throw new Error('Nenhum cartao encontrado neste PDF. Confirme que e a fatura completa do Bradesco.');
    }
    if (!vencimento) {
      throw new Error('Nao encontrei a data de vencimento neste PDF. Sem ela nao da para saber a que mes a fatura pertence.');
    }

    const conferidos = conferir(cartoes);
    const divergentes = conferidos.filter(c => c.confere === false);
    const semDeclarado = conferidos.filter(c => c.confere === null);

    // O mes de referencia vem do vencimento impresso na fatura,
    // nunca do relogio. Era o relogio que fazia a fatura de julho,
    // enviada em agosto, ser gravada como se fosse de agosto.
    const partes = vencimento.split('/');
    const mesAno = `${partes[1]}/${partes[2]}`;

    const somaSecoes = conferidos.reduce((s, c) => s + c.subtotal, 0);

    return {
      arquivo: arquivo.name,
      cartaoCapa,
      vencimento,
      mesAno,
      totalFatura,
      somaSecoes,
      totalConfere: totalFatura === null ? null : somaSecoes === totalFatura,
      cartoes: conferidos,
      ok: divergentes.length === 0 && semDeclarado.length === 0 &&
          (totalFatura === null || somaSecoes === totalFatura),
      divergentes,
      semDeclarado
    };
  }

  return {
    processar,
    // expostos para teste e para as telas
    _extrairLinhas: extrairLinhas,
    _interpretar: interpretar,
    _conferir: conferir,
    paraCentavos,
    formatarMoeda,
    formatarDataLancamento
  };

})();

if (typeof window !== 'undefined') window.ParserBradesco = ParserBradesco;
if (typeof module !== 'undefined' && module.exports) module.exports = ParserBradesco;
