// Testa js/parser-bradesco.js com o MESMO pdf.js que roda no navegador.
// Criterio: toda secao de todo PDF precisa fechar exatamente com o
// "Valor da fatura" declarado pelo proprio banco.

const fs = require('fs');
const path = require('path');

global.window = global;
const Parser = require(path.join(__dirname, '..', 'js', 'parser-bradesco.js'));

const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.js');

const BASE = path.join(__dirname, 'faturas');
const ARQS = [
  ['infinite-05.pdf', 'Maio Infinite'],
  ['infinite-06.pdf', 'Junho Infinite'],
  ['infinite-07.pdf', 'Julho Infinite'],
  ['infinite-08.pdf', 'Agosto Infinite'],
  ['aeternum-08.pdf', 'Agosto Aeternum'],
];

const moeda = c => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  let falhas = 0;
  let totalSecoes = 0;
  let semData = 0;
  let totalLanc = 0;

  for (const [arq, nome] of ARQS) {
    const dados = new Uint8Array(fs.readFileSync(path.join(BASE, arq)));
    const linhas = await Parser._extrairLinhas(dados, pdfjsLib);
    const { cartoes, vencimento, totalFatura } = Parser._interpretar(linhas);
    const conferidos = Parser._conferir(cartoes);

    console.log(`\n### ${nome}`);
    console.log(`    vencimento lido do PDF: ${vencimento}   |   total da fatura: ${moeda(totalFatura)}`);

    let somaGeral = 0;
    for (const c of conferidos) {
      totalSecoes++;
      totalLanc += c.lancamentos.length;
      const sd = c.lancamentos.filter(l => !l.dia || !l.mes).length;
      semData += sd;
      somaGeral += c.subtotal;
      const ok = c.confere === true;
      if (!ok) falhas++;
      console.log(
        `    ${c.final} ${c.titular.slice(0, 22).padEnd(24)} ` +
        `${String(c.lancamentos.length).padStart(3)} lanc | ` +
        `soma ${moeda(c.subtotal).padStart(11)} | ` +
        `banco ${moeda(c.declarado).padStart(11)} | ` +
        (ok ? 'OK' : `FALHOU (dif ${moeda(c.diferenca)})`) +
        (sd ? ` | ${sd} sem data` : '')
      );
    }
    const bateTotal = somaGeral === totalFatura;
    console.log(`    soma de todas as secoes: ${moeda(somaGeral)} vs total da fatura ${moeda(totalFatura)} -> ${bateTotal ? 'OK' : 'DIVERGE'}`);
    if (!bateTotal) falhas++;
  }

  console.log('\n' + '='.repeat(72));
  console.log(`secoes conferidas: ${totalSecoes} | lancamentos: ${totalLanc} | sem data: ${semData}`);
  console.log(falhas === 0
    ? 'RESULTADO: todas as secoes fecham exatamente com o valor declarado pelo banco'
    : `RESULTADO: ${falhas} divergencia(s)`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch(e => { console.error('ERRO:', e); process.exit(2); });
