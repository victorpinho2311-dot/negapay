// ============================================================
//  NegaPay — Configuração
//
//  O que NAO esta mais aqui, e por que:
//
//  - diaVencimento: era chutado ("dia 5 do mes seguinte") e errava
//    o mes inteiro. Agora o vencimento e lido do proprio PDF.
//  - padraoSecao / padraoLancamento / padraoTotal: resquicio de uma
//    versao antiga do parser, nao eram usados por ninguem.
//  - cartoesPrimo: a lista fixa fazia cartao novo virar R$ 0,00 em
//    silencio. Agora fica na aba "cartoes" da planilha, confirmada
//    na tela na primeira vez que o cartao aparece.
// ============================================================

const NEGAPAY_CONFIG = {

  apiUrl: 'https://script.google.com/macros/s/AKfycbyhfO7TiK9MThPhfSHkRrSBcMr1RZEaNRRN1LDj-F8hLxkwDY3Oo7dBqzo9YKHIv8vY/exec',

  sessaoDias: 30,

  // ──────────────────────────────────────────────────────────
  //  PRODUTOS
  //  O PDF nao escreve o nome do produto, mas o cartao da capa
  //  ("**** **** **** 2737") e unico por fatura. E por ele que o
  //  app sabe qual fatura chegou — sem o admin precisar escolher,
  //  e portanto sem risco de sobrescrever a fatura errada.
  // ──────────────────────────────────────────────────────────
  produtos: [
    {
      cartaoCapa: '2737',
      nome: 'Visa Infinite',
      cor: '#CC0000',
      corSecundaria: '#1a1a1a',
      logoUrl: 'assets/bradesco-logo.png',
      cardImageUrl: 'assets/visa-infinite.png?v=20260808-6'
    },
    {
      cartaoCapa: '3268',
      nome: 'Visa Æternum',
      cor: '#8A6E2F',
      corSecundaria: '#141414',
      logoUrl: 'assets/bradesco-logo.png',
      cardImageUrl: 'assets/Æternum.png?v=20260808-6'
    }
  ],

  bancoPadrao: {
    id: 'bradesco',
    nome: 'Bradesco',
    logoUrl: 'assets/bradesco-logo.png',
    cardImageUrl: 'assets/bradesco-card.png',
    cor: '#CC0000',
    corSecundaria: '#1a1a1a'
  },

  // Produto ainda nao cadastrado: o app pergunta o nome em vez de
  // adivinhar, e passa a reconhece-lo pelo cartao da capa.
  produtoPorCapa(final) {
    return this.produtos.find(p => p.cartaoCapa === String(final)) || null;
  },

  // O backend devolve o produto pelo nome (nao pelo cartao da capa) em
  // faturas ja publicadas — usado pra achar o icone do cartao nas listas.
  produtoPorNome(nome) {
    return this.produtos.find(p => p.nome === nome) || null;
  },

  primo: {
    nome: 'Getúlio',
    apelido: 'Nega',
    usuarioLogin: 'getlio'
  },

  aviso: {
    diasAntesAviso: 3
  },

  textos: {
    saudacaoAdmin: (hora) => {
      if (hora < 12) return 'Bom dia, Pinho';
      if (hora < 18) return 'Boa tarde, Pinho';
      return 'Boa noite, Pinho';
    },
    saudacaoPrimo: (hora) => {
      if (hora < 12) return 'Bom dia, Nega 👀';
      if (hora < 18) return 'Boa tarde, Nega 👀';
      return 'Boa noite, Nega 👀';
    }
  }
};

window.NEGAPAY_CONFIG = NEGAPAY_CONFIG;
