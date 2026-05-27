// ============================================================
//  NegaPay — Configuração Central
//  Para adicionar novo banco ou cartão, edite apenas este arquivo.
//  Nunca mexa no código principal para mudanças de configuração.
// ============================================================

const NEGAPAY_CONFIG = {

  // URL do Apps Script publicado como Web App
  // Após publicar o Code.gs, cole a URL aqui
apiUrl: 'https://script.google.com/macros/s/AKfycbzQIRHs2u3sj_OpYf7ppfnUcSgg6XCfVKBAE7Lq3huW9fe-g-vCrrYnXq5D7xG0YYq4/exec',
  // Duração da sessão local (em dias)
  sessaoDias: 30,

  // ──────────────────────────────────────────────────────────
  //  BANCOS E CARTÕES
  //  Para adicionar novo banco: copie o bloco abaixo e ajuste.
  //  Para adicionar cartão: adicione um item em "cartoesPrimo".
  // ──────────────────────────────────────────────────────────
  bancos: [
    {
      id: 'bradesco',
      nome: 'Bradesco Prime',
      cor: '#CC0000',              // vermelho Bradesco
      corSecundaria: '#1a1a1a',    // fundo do cartão (preto)
      logoUrl: 'assets/bradesco-logo.png',
      cardImageUrl: 'assets/bradesco-card.png',
      diaVencimento: 5,            // todo dia 5

      // Parser: padrão de texto que identifica seção de cartão no PDF
      // Formato Bradesco: "Gastos referentes ao cartão: Final XXXX | NOME"
      padraoSecao: /Gastos referentes ao cartão:\s*Final\s*(\d{4})\s*\|\s*(.+)/i,

      // Padrão de linha de lançamento: "DD MES DESCRIÇÃO ... VALOR"
      padraoLancamento: /^(\d{1,2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s+(.+?)\s+([-]?\d{1,3}(?:\.\d{3})*(?:,\d{2})?)$/i,

      // Linha do total da seção: "Valor da fatura: R$ X.XXX,XX"
      padraoTotal: /Valor da fatura:\s*R\$\s*([\d.,]+)/i,

      // Cartões do primo monitorados neste banco
      cartoesPrimo: [
        {
          final: '9087',
          apelido: 'Cartão Principal',
          titular: 'Getlio R D S Farias'
        },
        {
          final: '2011',
          apelido: 'Cartão Secundário',
          titular: 'Getlio R D S Farias'
        }
      ]
    }

    // ── Exemplo para banco futuro ──────────────────────────
    // {
    //   id: 'nubank',
    //   nome: 'Nubank',
    //   cor: '#8A05BE',
    //   corSecundaria: '#3d0066',
    //   logoUrl: 'assets/nubank-logo.png',
    //   cardImageUrl: 'assets/nubank-card.png',
    //   diaVencimento: 15,
    //   padraoSecao: /...,
    //   padraoLancamento: /...,
    //   padraoTotal: /...,
    //   cartoesPrimo: [
    //     { final: 'ZZZZ', apelido: 'Cartão Nubank', titular: 'Getlio R D S Farias' }
    //   ]
    // }
  ],

  // ──────────────────────────────────────────────────────────
  //  DADOS DO PRIMO (readonly)
  // ──────────────────────────────────────────────────────────
  primo: {
    nome: 'Getlio',
    apelido: 'Nega',                         // usado em saudações informais
    usuarioLogin: 'getlio'
  },

  // ──────────────────────────────────────────────────────────
  //  LEMBRETE iOS (.ics)
  // ──────────────────────────────────────────────────────────
  lembrete: {
    diasAntesAviso: 1,       // começa a avisar X dias antes do vencimento
    titulo: (valor) => `NegaPay — Pagar R$ ${valor}`,
    descricao: (valor, banco) => `Fatura ${banco} no valor de R$ ${valor}. Pague até hoje!`,
    alarmeMinutos: -1440     // 1 dia antes (em minutos negativos = antes do evento)
  },

  // ──────────────────────────────────────────────────────────
  //  TEXTOS DO APP
  // ──────────────────────────────────────────────────────────
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

// Expõe globalmente
window.NEGAPAY_CONFIG = NEGAPAY_CONFIG;
