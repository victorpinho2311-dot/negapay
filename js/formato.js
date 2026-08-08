// ============================================================
//  NegaPay — Formatação (fonte única)
//
//  Existia uma copia quase identica desta logica em Code.js,
//  admin.js e primo.js. Cada correcao de data arrumava uma copia
//  e deixava as outras erradas — foi o que gerou a sequencia de
//  commits "corrige vencimento". Agora e um lugar so.
//
//  Dinheiro trafega em CENTAVOS (inteiro) do parser ate a tela.
// ============================================================

const Fmt = (() => {

  const MESES_CURTO = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
                       'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const MESES_LONGO = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                       'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  // Negativo sai como "−R$ 2.722,79", com o sinal ANTES do R$.
  // O toLocaleString sozinho devolveria "R$ -2.722,79", com o sinal no
  // meio — e o app tinha dois jeitos diferentes de mostrar o mesmo valor
  // negativo dependendo da tela.
  function moeda(centavos) {
    const n = Number(centavos || 0);
    const abs = Math.abs(n) / 100;
    const texto = abs.toLocaleString('pt-BR', {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
    return (n < 0 ? '−' : '') + 'R$ ' + texto;
  }

  // Mantido porque o nome deixa a intencao explicita na chamada
  // (saldo, subtotal que pode ser credito). Formata igual a moeda().
  const moedaComSinal = moeda;

  // "08/2026" -> "Agosto 2026"
  function mesAnoLongo(mesAno) {
    const m = String(mesAno || '').match(/^(\d{1,2})\/(\d{4})$/);
    if (!m) return String(mesAno || '');
    return `${MESES_LONGO[Number(m[1]) - 1] || m[1]} ${m[2]}`;
  }

  // "08/2026" -> "Ago 2026"
  function mesAnoCurto(mesAno) {
    const m = String(mesAno || '').match(/^(\d{1,2})\/(\d{4})$/);
    if (!m) return String(mesAno || '');
    return `${MESES_CURTO[Number(m[1]) - 1] || m[1]} ${m[2]}`;
  }

  // Vencimento chega sempre como DD/MM/YYYY (lido do PDF, gravado
  // como texto). Se vier um Date ou ISO, e porque o Sheets converteu
  // — normalizamos em vez de confiar.
  function data(valor) {
    if (!valor) return '';
    const texto = String(valor).trim();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(texto)) return texto;

    const d = new Date(texto);
    if (!isNaN(d)) {
      return String(d.getUTCDate()).padStart(2, '0') + '/' +
             String(d.getUTCMonth() + 1).padStart(2, '0') + '/' +
             d.getUTCFullYear();
    }
    return texto;
  }

  function paraDate(vencimento) {
    const m = String(vencimento || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  }

  function diasAte(vencimento) {
    const d = paraDate(vencimento);
    if (!d) return null;
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    return Math.round((d - hoje) / 86400000);
  }

  function vencido(vencimento) {
    const dias = diasAte(vencimento);
    return dias !== null && dias < 0;
  }

  // Escapa texto que veio da fatura antes de entrar em innerHTML.
  // As descricoes vem de um PDF externo — nunca vao cruas pra tela.
  function txt(valor) {
    return String(valor === null || valor === undefined ? '' : valor)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  return { moeda, moedaComSinal, mesAnoLongo, mesAnoCurto, data,
           paraDate, diasAte, vencido, txt };

})();

if (typeof window !== 'undefined') window.Fmt = Fmt;
if (typeof module !== 'undefined' && module.exports) module.exports = Fmt;
