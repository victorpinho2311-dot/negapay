// Guarda o tamanho do que vai para o Apps Script.
//
// O app manda o corpo na URL (GET com ?payload=) para nao disparar
// preflight CORS. O Apps Script rejeita URL muito longa, e o fetch
// falha antes de sair — na tela isso aparecia como "falha de conexao",
// o que mandava investigar rede em vez de tamanho.
//
// Mandar os lancamentos dos cartoes do titular (nunca exibidos) levava
// a URL a 14.224 caracteres. Este teste impede a volta disso.

const fs = require('fs');
const path = require('path');
const assert = require('assert');

global.window = global;
const Parser = require(path.join(__dirname, '..', 'js', 'parser-bradesco.js'));

const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.js');

// mesmo limite de js/auth.js
const LIMITE_URL = 7000;
// margem: acima disso o app ainda funciona (cai no POST), mas quero saber
const ALERTA = 5000;

const DONO = {
  '2737': 'admin', '2604': 'admin', '3268': 'admin', '2260': 'admin',
  '9087': 'primo', '2011': 'primo', '9778': 'primo',
};

const ARQS = ['infinite-05.pdf', 'infinite-06.pdf', 'infinite-07.pdf',
              'infinite-08.pdf', 'aeternum-08.pdf'];

const arquivo = nome => {
  const buf = fs.readFileSync(path.join(__dirname, 'faturas', nome));
  return { name: nome, type: 'application/pdf',
           arrayBuffer: async () => new Uint8Array(buf) };
};

// replica o corpo que js/admin.js monta em _publicar
function corpoDaPublicacao(r) {
  return {
    acao: 'salvarFatura',
    token: 'x'.repeat(60),
    fatura: {
      mesAno: r.mesAno, produto: 'Visa Æternum', bancoId: 'bradesco',
      vencimento: r.vencimento, totalFaturaCentavos: r.totalFatura,
      arquivo: r.arquivo,
      cartoes: r.cartoes.map(c => ({
        final: c.final, titular: c.titular, subtotal: c.subtotal,
        declarado: c.declarado, confere: c.confere,
        lancamentos: DONO[c.final] === 'primo'
          ? c.lancamentos.map(l => ({
              data: Parser.formatarDataLancamento(l),
              descricao: l.descricao, parcela: l.parcela, valor: l.valor
            }))
          : []
      }))
    }
  };
}

(async () => {
  const base = 'https://script.google.com/macros/s/' + 'A'.repeat(70) + '/exec';
  let maior = 0, maiorArq = '';

  console.log('TAMANHO DA URL ENVIADA AO APPS SCRIPT');
  console.log('='.repeat(66));

  for (const nome of ARQS) {
    const r = await Parser.processar(arquivo(nome), { pdfjsLib });
    const url = base + '?payload=' + encodeURIComponent(JSON.stringify(corpoDaPublicacao(r)));

    if (url.length > maior) { maior = url.length; maiorArq = nome; }

    const primo = r.cartoes.filter(c => DONO[c.final] === 'primo')
                           .reduce((s, c) => s + c.lancamentos.length, 0);
    console.log(`  ${nome.padEnd(18)} ${String(url.length).padStart(5)} caracteres` +
                `  (${primo} lançamentos do primo)` +
                (url.length > LIMITE_URL ? '  -> iria por POST' : ''));

    assert.ok(url.length <= LIMITE_URL,
      `${nome}: URL de ${url.length} caracteres passa do limite de ${LIMITE_URL}`);
  }

  console.log('='.repeat(66));
  console.log(`maior: ${maior} caracteres (${maiorArq}) | limite ${LIMITE_URL}`);

  if (maior > ALERTA) {
    console.log(`ATENCAO: passou de ${ALERTA}. Ainda funciona (cai no POST), mas revise.`);
  }

  // o corpo nao pode levar lancamento de cartao que nao e do primo
  const r = await Parser.processar(arquivo('infinite-05.pdf'), { pdfjsLib });
  const corpo = corpoDaPublicacao(r);
  corpo.fatura.cartoes.forEach(c => {
    if (DONO[c.final] !== 'primo') {
      assert.strictEqual(c.lancamentos.length, 0,
        `cartao ${c.final} nao e do primo e mandou ${c.lancamentos.length} lancamentos`);
    } else {
      assert.ok(c.lancamentos.length > 0,
        `cartao ${c.final} e do primo e nao mandou lancamento nenhum`);
    }
    // o subtotal sempre vai, e dele que sai o total e a conferencia
    assert.strictEqual(typeof c.subtotal, 'number');
    assert.strictEqual(c.confere, true);
  });
  console.log('lançamentos: só os do primo; subtotal e conferência vão de todos os cartões');

  console.log('\nRESULTADO: o corpo da publicação cabe na URL com folga');
})().catch(e => { console.error('\nFALHOU:', e.message); process.exit(1); });
