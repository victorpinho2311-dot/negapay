// Teste ponta a ponta: PDF real -> parser -> logica do backend -> resumo.
// Simula a planilha em memoria e reimplementa a MESMA regra de negocio
// do Code.js (agrupamento por mes, saldo acumulado) para conferir os
// numeros que o Getulio vai ver na tela.

const fs = require('fs');
const path = require('path');
const assert = require('assert');

global.window = global;
const Parser = require(path.join(__dirname, '..', 'js', 'parser-bradesco.js'));
const Fmt = require(path.join(__dirname, '..', 'js', 'formato.js'));

const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.js');

const BASE = path.join(__dirname, 'faturas');

// dono de cada cartao, como ficaria na aba "cartoes"
const DONOS = {
  '2737': 'admin', '2604': 'admin', '3268': 'admin', '2260': 'admin',
  '9087': 'primo', '2011': 'primo', '9778': 'primo',
};

const PRODUTO_POR_CAPA = { '2737': 'Visa Infinite', '3268': 'Visa Æternum' };

// ── planilha em memoria ────────────────────────────────────
const faturas = [];

function salvarFatura(f) {
  const naoConfere = f.cartoes.filter(c => c.confere !== true);
  assert.strictEqual(naoConfere.length, 0,
    `backend recusaria: ${naoConfere.map(c => c.final).join(',')}`);

  const semDono = f.cartoes.filter(c => !DONOS[String(c.final)]);
  assert.strictEqual(semDono.length, 0,
    `backend pediria dono de: ${semDono.map(c => c.final).join(',')}`);

  const totalPrimo = f.cartoes
    .filter(c => DONOS[String(c.final)] === 'primo')
    .reduce((s, c) => s + c.subtotal, 0);

  // substitui apenas mesmo mes + mesmo produto
  const i = faturas.findIndex(x => x.mesAno === f.mesAno && x.produto === f.produto);
  const linha = {
    faturaId: `FAT_${f.mesAno.replace('/', '_')}_${f.produto}`,
    mesAno: f.mesAno, produto: f.produto, vencimento: f.vencimento,
    totalPrimoCentavos: totalPrimo, pago: false, valorPagoCentavos: 0,
  };
  if (i >= 0) faturas[i] = linha; else faturas.push(linha);
  return linha;
}

function chaveCompetencia(mesAno) {
  const m = String(mesAno).match(/^(\d{1,2})\/(\d{4})$/);
  return m ? Number(m[2]) * 12 + Number(m[1]) : 0;
}

function getResumo() {
  const porMes = {};
  faturas.forEach(f => {
    if (!porMes[f.mesAno]) porMes[f.mesAno] = { mesAno: f.mesAno, faturas: [], totalCentavos: 0, pagoCentavos: 0 };
    porMes[f.mesAno].faturas.push(f);
    porMes[f.mesAno].totalCentavos += f.totalPrimoCentavos;
    porMes[f.mesAno].pagoCentavos  += f.valorPagoCentavos;
  });
  const meses = Object.values(porMes)
    .sort((a, b) => chaveCompetencia(a.mesAno) - chaveCompetencia(b.mesAno));
  let saldo = 0;
  meses.forEach(m => { saldo += m.totalCentavos - m.pagoCentavos; m.saldoAcumuladoCentavos = saldo; });
  return { saldoAtualCentavos: saldo, meses };
}

// ── arquivo -> objeto File-like que o parser aceita ────────
function comoArquivo(caminho) {
  const buf = fs.readFileSync(caminho);
  return {
    name: path.basename(caminho),
    type: 'application/pdf',
    arrayBuffer: async () => new Uint8Array(buf),
  };
}

// ── esperado, conferido a mao contra os PDFs ───────────────
const ESPERADO = {
  '05/2026': -272279,
  '06/2026':  143951,
  '07/2026':  209725,
  '08/2026':  249670,   // Infinite 248671 + Aeternum 999
};

(async () => {
  const ARQS = ['infinite-05.pdf', 'infinite-06.pdf', 'infinite-07.pdf',
                'infinite-08.pdf', 'aeternum-08.pdf'];

  console.log('PUBLICANDO AS 5 FATURAS\n' + '='.repeat(70));

  for (const arq of ARQS) {
    const r = await Parser.processar(comoArquivo(path.join(BASE, arq)), { pdfjsLib });
    const produto = PRODUTO_POR_CAPA[r.cartaoCapa] || `Final ${r.cartaoCapa}`;

    assert.ok(r.ok, `${arq}: conferencia falhou`);

    const linha = salvarFatura({
      mesAno: r.mesAno, produto, vencimento: r.vencimento, cartoes: r.cartoes,
    });

    console.log(`${arq.padEnd(18)} capa ${r.cartaoCapa} -> ${produto.padEnd(14)} ` +
                `mes ${r.mesAno}  vence ${r.vencimento}  ` +
                `Getulio ${Fmt.moedaComSinal(linha.totalPrimoCentavos).padStart(13)}`);
  }

  console.log('\nRESUMO QUE O GETULIO VE\n' + '='.repeat(70));
  const resumo = getResumo();
  resumo.meses.forEach(m => {
    console.log(`${Fmt.mesAnoLongo(m.mesAno).padEnd(16)} ` +
                `mes ${Fmt.moedaComSinal(m.totalCentavos).padStart(13)} | ` +
                `saldo acumulado ${Fmt.moedaComSinal(m.saldoAcumuladoCentavos).padStart(13)} | ` +
                `${m.faturas.length} fatura(s): ${m.faturas.map(f => f.produto).join(' + ')}`);
  });

  console.log('\nCONFERENCIA CONTRA O CALCULADO A MAO\n' + '='.repeat(70));
  let erros = 0;
  for (const [mes, esperado] of Object.entries(ESPERADO)) {
    const m = resumo.meses.find(x => x.mesAno === mes);
    const obtido = m ? m.totalCentavos : null;
    const ok = obtido === esperado;
    if (!ok) erros++;
    console.log(`${mes}  esperado ${Fmt.moedaComSinal(esperado).padStart(13)} | ` +
                `obtido ${Fmt.moedaComSinal(obtido).padStart(13)} | ${ok ? 'OK' : 'ERRADO'}`);
  }

  // ── cenario que era o bug: duas faturas no mesmo mes ─────
  console.log('\nO BUG DE ANTES: duas faturas no mesmo mes\n' + '='.repeat(70));
  const agosto = resumo.meses.find(m => m.mesAno === '08/2026');
  console.log(`agosto tem ${agosto.faturas.length} faturas guardadas: ` +
              agosto.faturas.map(f => `${f.produto}=${Fmt.moeda(f.totalPrimoCentavos)}`).join(' + '));
  assert.strictEqual(agosto.faturas.length, 2, 'a segunda fatura apagou a primeira!');
  assert.strictEqual(agosto.totalCentavos, 249670);
  console.log('-> as duas sobrevivem. Antes a Aeternum apagava a Infinite e sobrava R$ 9,99.');

  // ── republicar a mesma fatura nao duplica ───────────────
  console.log('\nREPUBLICAR A MESMA FATURA\n' + '='.repeat(70));
  const antes = faturas.length;
  const r2 = await Parser.processar(comoArquivo(path.join(BASE, 'infinite-08.pdf')), { pdfjsLib });
  salvarFatura({ mesAno: r2.mesAno, produto: PRODUTO_POR_CAPA[r2.cartaoCapa],
                 vencimento: r2.vencimento, cartoes: r2.cartoes });
  console.log(`faturas antes: ${antes} | depois de republicar: ${faturas.length}`);
  assert.strictEqual(faturas.length, antes, 'republicar duplicou a fatura');
  const resumo2 = getResumo();
  assert.strictEqual(resumo2.meses.find(m => m.mesAno === '08/2026').totalCentavos, 249670);
  console.log('-> substituiu no lugar, sem duplicar e sem mexer na Aeternum.');

  // ── acerto historico: quitar tudo ate 31/08 zera o saldo ────
  console.log('\nACERTO HISTORICO: quitar tudo que vence ate 31/08/2026\n' + '='.repeat(70));

  const limite = new Date(2026, 7, 31).getTime();
  const venc = f => {
    const m = String(f.vencimento).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
  };
  const quitadas = faturas.filter(f => !f.pago && venc(f) <= limite);
  quitadas.forEach(f => { f.pago = true; f.valorPagoCentavos = f.totalPrimoCentavos; });
  console.log(`quitadas ${quitadas.length} faturas: ` +
              quitadas.map(f => `${f.mesAno} ${f.produto}`).join(', '));

  const zerado = getResumo();
  console.log(`saldo depois do acerto: ${Fmt.moedaComSinal(zerado.saldoAtualCentavos)}`);
  assert.strictEqual(zerado.saldoAtualCentavos, 0,
    'quitar tudo deveria zerar o saldo, inclusive o mes negativo de maio');
  console.log('-> saldo zerado. O credito de maio some junto, como pedido.');

  // ── setembro entra limpo ────────────────────────────────────
  console.log('\nSETEMBRO ENTRA LIMPO\n' + '='.repeat(70));
  salvarFatura({
    mesAno: '09/2026', produto: 'Visa Infinite', vencimento: '05/09/2026',
    cartoes: [{ final: '9087', titular: 'GETLIO R D S FARIAS', subtotal: 150000,
                declarado: 150000, confere: true, lancamentos: [] }],
  });
  salvarFatura({
    mesAno: '09/2026', produto: 'Visa Æternum', vencimento: '10/09/2026',
    cartoes: [{ final: '9778', titular: 'GETULIO FARIAS', subtotal: 45446,
                declarado: 45446, confere: true, lancamentos: [] }],
  });
  const set = getResumo();
  const mesSet = set.meses.find(m => m.mesAno === '09/2026');
  console.log(`setembro: ${mesSet.faturas.length} faturas | ` +
              `mes ${Fmt.moedaComSinal(mesSet.totalCentavos)} | ` +
              `saldo ${Fmt.moedaComSinal(set.saldoAtualCentavos)}`);
  assert.strictEqual(mesSet.totalCentavos, 195446);
  assert.strictEqual(set.saldoAtualCentavos, 195446,
    'saldo de setembro deveria ser so o proprio mes, sem heranca');
  console.log('-> o que o Getulio deve em setembro e so setembro: R$ 1.954,46');

  console.log('\n' + '='.repeat(70));
  if (erros) { console.log(`FALHOU: ${erros} mes(es) divergiram`); process.exit(1); }
  console.log('RESULTADO: todos os valores conferem com o calculado a mao a partir dos PDFs');
})().catch(e => { console.error('\nFALHOU:', e.message); process.exit(1); });
