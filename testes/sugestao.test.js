// Testa a sugestao de dono para cartao novo, com os nomes REAIS que o
// Bradesco escreve — que variam de grafia entre os produtos.
const fs=require('fs'), path=require('path'), assert=require('assert');
const { JSDOM } = require('jsdom');

const RAIZ = path.join(__dirname, '..');
const dom = new JSDOM(fs.readFileSync(path.join(RAIZ,'index.html'),'utf8'),
                      { runScripts:'outside-only', url:'https://exemplo.test/' });
const { window } = dom;
window.UI = { toast: () => {} };

let cartoes = [];
window.API = { post: async b => b.acao==='listarCartoes'
  ? { ok:true, cartoes } : { ok:true, faturas: [] } };

const carregar = f => window.eval(fs.readFileSync(path.join(RAIZ,f),'utf8'));
carregar('js/config.js'); carregar('js/formato.js');
carregar('js/parser-bradesco.js'); carregar('js/admin.js'); carregar('js/primo.js');
const Admin = window.Admin;

// o que ja seria conhecido depois de publicar a Infinite
cartoes = [
  { final:'2737', titular:'VICTOR P FERRAZ',     dono:'admin', apelido:'' },
  { final:'2604', titular:'VICTOR P FERRAZ',     dono:'admin', apelido:'' },
  { final:'9087', titular:'GETLIO R D S FARIAS', dono:'primo', apelido:'' },
  { final:'2011', titular:'GETLIO R D S FARIAS', dono:'primo', apelido:'' },
];

(async () => {
  await Admin.init();
  const s = Admin._sugerirDono;

  // caso real: o 9778 da Aeternum, grafado diferente
  const a = s('GETULIO FARIAS');
  assert.ok(a, 'nao sugeriu nada para GETULIO FARIAS');
  assert.strictEqual(a.dono, 'primo',
    `sugeriu ${a.dono} para GETULIO FARIAS (esperado primo)`);
  console.log(`"GETULIO FARIAS"        -> ${a.dono}  (parecido com "${a.titular}", ${a.pontos} pts)`);

  // o titular da capa da Aeternum
  const b = s('VICTOR P FERRAZ');
  assert.strictEqual(b.dono, 'admin');
  console.log(`"VICTOR P FERRAZ"       -> ${b.dono}  (${b.pontos} pts)`);

  // variacoes plausiveis do nome dele
  for (const nome of ['GETULIO R D S FARIAS','GETLIO FARIAS','GETULIO RDS FARIAS']) {
    const r = s(nome);
    assert.ok(r && r.dono === 'primo', `${nome} deveria sugerir primo`);
    console.log(`"${nome}"`.padEnd(24) + ` -> ${r.dono}  (${r.pontos} pts)`);
  }

  // nome de terceiro nao pode ser confundido
  for (const nome of ['MARIA S OLIVEIRA','JOAO PEREIRA LIMA']) {
    const r = s(nome);
    assert.strictEqual(r, null, `${nome} nao deveria sugerir nada, sugeriu ${r && r.dono}`);
    console.log(`"${nome}"`.padEnd(24) + ` -> nenhuma sugestao (correto)`);
  }

  // sobrenome parecido mas pessoa diferente: FERRAZ vs FARIAS
  const c = s('CARLOS FERRAZ');
  console.log(`"CARLOS FERRAZ"          -> ${c ? c.dono+' ('+c.pontos+' pts)' : 'nenhuma'}`);
  assert.ok(!c || c.dono === 'admin', 'FERRAZ nao pode virar primo');

  console.log('\nRESULTADO: sugestao acerta os nomes reais e nao chuta em nome de terceiro');
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
