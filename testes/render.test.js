// Renderiza as telas com dados REAIS das faturas, num DOM de mentira,
// para pegar erro de template antes de ir pro ar.
//
// Nota: admin.js/primo.js declaram `const Admin = ...` no topo. Isso cria
// binding lexico global (nao vira window.Admin) — no navegador os handlers
// inline do HTML resolvem por escopo, entao funciona. Aqui buscamos via eval.

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const RAIZ = path.join(__dirname, '..');
const dom = new JSDOM(fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8'),
                      { runScripts: 'outside-only', url: 'https://exemplo.test/negapay/' });
const { window } = dom;

const carregar = f => window.eval(fs.readFileSync(path.join(RAIZ, f), 'utf8'));

const mensagens = [];
window.UI = { toast: (m, t) => mensagens.push([t || '', m]) };

const CARTOES_CONHECIDOS = [
  { final: '2737', titular: 'VICTOR P FERRAZ', dono: 'admin', apelido: '' },
  { final: '2604', titular: 'VICTOR P FERRAZ', dono: 'admin', apelido: '' },
  { final: '9087', titular: 'GETLIO R D S FARIAS', dono: 'primo', apelido: '' },
  { final: '2011', titular: 'GETLIO R D S FARIAS', dono: 'primo', apelido: '' },
];
let respostaAPI = async (body) => {
  if (body.acao === 'listarCartoes') return { ok: true, cartoes: CARTOES_CONHECIDOS };
  if (body.acao === 'listarFaturas') return { ok: true, faturas: [] };
  return { ok: true };
};
window.API = { post: (b) => respostaAPI(b) };

carregar('js/config.js');
carregar('js/formato.js');
carregar('js/parser-bradesco.js');
carregar('js/admin.js');
carregar('js/primo.js');

const Admin  = window.Admin;
const Primo  = window.Primo;
const Parser = window.ParserBradesco;
const Fmt    = window.Fmt;

const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.js');
// o parser usa window.pdfjsLib quando nao recebe opcoes; no fluxo da tela
// (Admin._selecionar) nao da pra passar opcoes, entao plantamos aqui.
window.pdfjsLib = pdfjsLib;

const arquivo = nome => {
  const buf = fs.readFileSync(path.join(__dirname, 'faturas', nome));
  return { name: nome, type: 'application/pdf', arrayBuffer: async () => new Uint8Array(buf) };
};

const esperar = ms => new Promise(r => setTimeout(r, ms));

async function enviar(...nomes) {
  Admin._selecionar({ target: { files: nomes.map(arquivo) } });
  await esperar(1200 * nomes.length + 1500);
  return window.document.getElementById('preview-section').innerHTML;
}

const botaoPublicar = html => (html.match(/id="btn-publicar"[^>]*/) || [''])[0];

(async () => {
  await Admin.init();
  assert.ok(window.document.getElementById('admin-upload').innerHTML.includes('upload-zone'),
            'area de upload nao renderizou');

  // 1) Infinite de agosto — tudo conhecido, conferencia bate
  const h1 = await enviar('infinite-08.pdf');
  assert.ok(h1.includes('Conferência bateu'), 'nao mostrou que a conferencia bateu');
  assert.ok(h1.includes('Visa Infinite'), 'nao identificou o produto pela capa');
  assert.ok(h1.includes('05/08/2026'), 'nao usou o vencimento lido do PDF');
  assert.ok(h1.includes('R$ 2.486,71'), 'total do Getulio errado na tela');
  assert.ok(!botaoPublicar(h1).includes('disabled'), 'publicar deveria estar habilitado');
  console.log('1) Infinite agosto — conferencia OK, total R$ 2.486,71, publicar habilitado');

  // 2) Aeternum — cartao 9778 desconhecido, tem que travar
  const h2 = await enviar('aeternum-08.pdf');
  assert.ok(/Cart(ão|ões) novo?s? nesta fatura/.test(h2), 'nao avisou do cartao novo');
  assert.ok(h2.includes('9778'), 'nao listou o 9778');
  assert.ok(botaoPublicar(h2).includes('disabled'), 'publicar deveria estar BLOQUEADO');
  assert.ok(h2.includes('Defina os cartões acima'), 'texto do botao errado');
  console.log('2) Aeternum — 9778 detectado, publicacao BLOQUEADA ate definir o dono');

  // 3) Maio: total do Getulio negativo, tem que aparecer com sinal
  const h3 = await enviar('infinite-05.pdf');
  assert.ok(h3.includes('Conferência bateu'), 'maio: conferencia deveria bater');
  assert.ok(h3.includes('−R$ 2.722,79'), 'maio: valor negativo do Getulio nao apareceu com sinal');
  console.log('3) Maio — conferencia bate mesmo com secao negativa (−R$ 2.722,79)');

  // 4) Descricao maliciosa nao vira HTML
  const escapado = Fmt.txt('<img src=x onerror=alert(1)>');
  assert.ok(!escapado.includes('<img'), 'Fmt.txt nao escapou');
  assert.strictEqual(escapado, '&lt;img src=x onerror=alert(1)&gt;');
  assert.ok(h1.includes('lancamento-desc'), 'esperava lancamentos renderizados');
  assert.ok(!h1.includes('<img src=x'), 'html do preview contem tag nao escapada');
  console.log('4) XSS — descricao do lancamento e escapada antes do innerHTML');

  // 5) Tela do primo com saldo negativo acumulado
  respostaAPI = async (body) => {
    if (body.acao !== 'getResumo') return { ok: true };
    const f0 = { faturaId: 'F0', produto: 'Visa Infinite', vencimento: '05/05/2026',
                 totalPrimoCentavos: -272279, pago: false };
    const f1 = { faturaId: 'F1', produto: 'Visa Infinite', vencimento: '05/06/2026',
                 totalPrimoCentavos: 143951, pago: false };
    return { ok: true, saldoAtualCentavos: -128328,
      mesAtual: { mesAno: '06/2026', totalCentavos: 143951, pagoCentavos: 0,
                  vencimento: '05/06/2026', faturas: [f1] },
      meses: [
        { mesAno: '06/2026', totalCentavos: 143951, pagoCentavos: 0,
          saldoAcumuladoCentavos: -128328, faturas: [f1] },
        { mesAno: '05/2026', totalCentavos: -272279, pagoCentavos: 0,
          saldoAcumuladoCentavos: -272279, faturas: [f0] },
      ]};
  };
  await Primo.init();
  const hp = window.document.getElementById('primo-atual').innerHTML;
  assert.ok(hp.includes('Crédito a seu favor'), 'nao mostrou credito');
  assert.ok(hp.includes('R$ 1.283,28'), 'saldo acumulado errado');
  assert.ok(hp.includes('saldo acumulado'), 'nao explicou o saldo acumulado');
  console.log('5) Primo — saldo negativo vira "Crédito a seu favor" de R$ 1.283,28');

  // 6) Duas faturas no mesmo mes aparecem as duas
  respostaAPI = async (body) => {
    if (body.acao !== 'getResumo') return { ok: true };
    const inf = { faturaId: 'A', produto: 'Visa Infinite', vencimento: '05/08/2026',
                  totalPrimoCentavos: 248671, pago: false };
    const aet = { faturaId: 'B', produto: 'Visa Æternum', vencimento: '10/08/2026',
                  totalPrimoCentavos: 999, pago: false };
    return { ok: true, saldoAtualCentavos: 249670,
      mesAtual: { mesAno: '08/2026', totalCentavos: 249670, pagoCentavos: 0,
                  vencimento: '05/08/2026', faturas: [inf, aet] },
      meses: [{ mesAno: '08/2026', totalCentavos: 249670, pagoCentavos: 0,
                saldoAcumuladoCentavos: 249670, faturas: [inf, aet] }] };
  };
  await Primo.init();
  const hp2 = window.document.getElementById('primo-atual').innerHTML;
  assert.ok(hp2.includes('R$ 2.496,70'), 'total do mes errado');
  assert.ok(hp2.includes('Visa Infinite') && hp2.includes('Visa Æternum'),
            'nao listou as duas faturas');
  assert.ok(hp2.includes('05/08/2026') && hp2.includes('10/08/2026'),
            'nao mostrou os dois vencimentos diferentes');
  console.log('6) Primo — R$ 2.496,70 num card so, detalhado nas duas faturas (venc. 05/08 e 10/08)');

  // 7) LOTE: as 5 faturas de uma vez
  respostaAPI = async (body) => {
    if (body.acao === 'listarCartoes') return { ok: true, cartoes: [
      ...CARTOES_CONHECIDOS,
      { final: '3268', titular: 'VICTOR P FERRAZ', dono: 'admin', apelido: '' },
      { final: '2260', titular: 'VICTOR P FERRAZ', dono: 'admin', apelido: '' },
      { final: '9778', titular: 'GETULIO FARIAS', dono: 'primo', apelido: '' },
    ]};
    if (body.acao === 'listarFaturas') return { ok: true, faturas: [] };
    return { ok: true };
  };
  await Admin.init();
  const hl = await enviar('infinite-05.pdf', 'infinite-06.pdf', 'infinite-07.pdf',
                          'infinite-08.pdf', 'aeternum-08.pdf');

  assert.ok(hl.includes('5 faturas lidas'), 'nao resumiu o lote');
  assert.ok(hl.includes('todas conferem'), 'lote deveria conferir inteiro');
  assert.ok(hl.includes('Publicar 5 faturas'), 'botao nao ofereceu publicar as 5');
  for (const v of ['05/05/2026','05/06/2026','05/07/2026','05/08/2026','10/08/2026']) {
    assert.ok(hl.includes(v), 'faltou a fatura que vence ' + v);
  }
  // total do primo nas 5: -2722,79 +1439,51 +2097,25 +2486,71 +9,99 = 3310,67
  assert.ok(hl.includes('R$ 3.310,67'), 'total do lote errado');
  // ordem cronologica: maio antes de agosto
  assert.ok(hl.indexOf('05/05/2026') < hl.indexOf('10/08/2026'),
            'lote fora de ordem cronologica');
  console.log('7) Lote — 5 faturas numa tela so, em ordem, total R$ 3.310,67, publicar as 5');

  console.log('\nRESULTADO: telas renderizam com dados reais, sem erro de template');
})().catch(e => { console.error('\nFALHOU:', e.message); console.error(e.stack); process.exit(1); });
