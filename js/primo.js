// ============================================================
//  NegaPay — Painel do Primo v2
//
//  Mostra UM valor no topo (quanto ele deve no total) e, abaixo,
//  o detalhe por fatura — porque agora sao duas faturas no mesmo
//  mes, com vencimentos diferentes (Infinite dia 5, Aeternum dia 10).
//
//  O saldo e acumulado, como o banco faz: mes que fecha negativo
//  vira credito e abate nos meses seguintes.
// ============================================================

const Primo = (() => {

  let resumo = null;

  async function init() {
    renderHeader();
    await carregar();
  }

  function renderHeader() {
    document.getElementById('primo-header-greeting').textContent =
      NEGAPAY_CONFIG.textos.saudacaoPrimo(new Date().getHours());
  }

  async function carregar() {
    const container = document.getElementById('primo-atual');
    container.innerHTML = `<div class="carregando"><span class="spinner spinner-escuro"></span></div>`;

    try {
      const res = await API.post({ acao: 'getResumo' });
      if (!res.ok) throw new Error(res.erro);

      resumo = res;

      if (!res.meses.length) {
        container.innerHTML = `
          <div class="summary-card">
            <div class="summary-mes">Sem fatura</div>
            <div class="summary-valor">R$ 0,00</div>
            <div class="summary-vencimento">Nenhuma fatura publicada ainda</div>
          </div>`;
        document.getElementById('primo-historico').innerHTML = '';
        return;
      }

      renderAtual(res);
      renderHistorico(res);

    } catch (err) {
      container.innerHTML = `<div class="card erro-inline">Erro ao carregar. Tente novamente.</div>`;
      console.error(err);
    }
  }

  // ── Card principal: um valor só ──────────────────────────
  function renderAtual(res) {
    const container = document.getElementById('primo-atual');
    const mes = res.mesAtual;
    const saldo = res.saldoAtualCentavos;
    const credito = saldo < 0;

    // vencimento mais proximo entre as faturas ainda em aberto do mes
    const emAberto = mes.faturas.filter(f => !f.pago);
    const proximo = emAberto.length
      ? emAberto.slice().sort((a, b) => (Fmt.paraDate(a.vencimento) || 0) - (Fmt.paraDate(b.vencimento) || 0))[0]
      : null;

    const dias = proximo ? Fmt.diasAte(proximo.vencimento) : null;
    const vencido = dias !== null && dias < 0;

    let badgeClasse = 'badge-aberto';
    let badgeTexto  = '⏳ Em aberto';
    if (credito || saldo === 0) { badgeClasse = 'badge-pago'; badgeTexto = credito ? '★ Você tem crédito' : '✓ Tudo pago'; }
    else if (vencido)           { badgeClasse = 'badge-vencido'; badgeTexto = '⚠ Vencido'; }

    const aviso = (!credito && saldo > 0 && dias !== null && dias <= NEGAPAY_CONFIG.lembrete.diasAntesAviso)
      ? `<div class="aviso-vencimento">
           ⚡ ${dias === 0 ? 'Vence hoje!' : dias < 0
              ? `Venceu há ${Math.abs(dias)} dia(s)`
              : `Vence em ${dias} dia(s)`}
         </div>`
      : '';

    container.innerHTML = `
      <div class="summary-card ${credito ? 'summary-credito' : ''}">
        <div class="summary-status"><span class="badge ${badgeClasse}">${badgeTexto}</span></div>
        <div class="summary-rotulo">${credito ? 'Crédito a seu favor' : 'Você deve'}</div>
        <div class="summary-valor">${Fmt.moeda(Math.abs(saldo))}</div>
        ${proximo && !credito && saldo > 0
          ? `<div class="summary-vencimento">Vencimento mais próximo: ${Fmt.txt(proximo.vencimento)}</div>`
          : `<div class="summary-vencimento">${Fmt.txt(Fmt.mesAnoLongo(mes.mesAno))}</div>`}
      </div>

      ${aviso}

      ${renderFaturasDoMes(mes)}

      ${saldo !== mes.totalCentavos ? `
        <div class="nota-saldo">
          O valor acima é o saldo acumulado: soma tudo que ficou em aberto
          nos meses anteriores. A fatura deste mês, sozinha, é
          ${Fmt.moedaComSinal(mes.totalCentavos)}.
        </div>` : ''}
    `;
  }

  // ── Detalhe: uma linha por fatura do mês ─────────────────
  function renderFaturasDoMes(mes) {
    return `
      <div class="card">
        <p class="card-title">📄 Faturas de ${Fmt.txt(Fmt.mesAnoLongo(mes.mesAno))}</p>
        ${mes.faturas.map(f => `
          <div class="fatura-linha">
            <div class="fatura-linha-esq" onclick="Primo._detalhar('${Fmt.txt(f.faturaId)}')">
              <div class="fatura-linha-produto">${Fmt.txt(f.produto)}</div>
              <div class="fatura-linha-venc">Vence ${Fmt.txt(f.vencimento)}</div>
            </div>
            <div class="fatura-linha-dir">
              <span class="fatura-linha-valor">${Fmt.moedaComSinal(f.totalPrimoCentavos)}</span>
              ${f.pago
                ? `<span class="badge badge-pago">✓ Pago</span>`
                : `<button class="btn-mini btn-mini-primo"
                     onclick="Primo._pagar('${Fmt.txt(f.faturaId)}', this)">Marcar pago</button>`}
            </div>
          </div>
          <div id="detalhe-${Fmt.txt(f.faturaId)}" class="fatura-detalhe" style="display:none"></div>
        `).join('')}
        <div class="fatura-total-mes">
          <span>Total do mês</span>
          <span>${Fmt.moedaComSinal(mes.totalCentavos)}</span>
        </div>
      </div>

      ${mes.faturas.some(f => !f.pago) ? `
        <div class="lembrete-card">
          <div class="lembrete-info">
            <div class="lembrete-titulo">📅 Adicionar ao Calendário</div>
            <div class="lembrete-sub">Um lembrete para cada vencimento</div>
          </div>
          <button class="btn-lembrete" onclick="Primo._lembrete()">+ Adicionar</button>
        </div>` : ''}
    `;
  }

  // ── Lançamentos de uma fatura, sob demanda ───────────────
  async function _detalhar(faturaId) {
    const alvo = document.getElementById('detalhe-' + faturaId);
    if (!alvo) return;

    if (alvo.style.display === 'block') {
      alvo.style.display = 'none';
      return;
    }

    alvo.style.display = 'block';
    alvo.innerHTML = `<div class="carregando"><span class="spinner spinner-escuro"></span></div>`;

    try {
      const res = await API.post({ acao: 'getFatura', faturaId });
      if (!res.ok) throw new Error(res.erro);

      const meus = res.fatura.cartoes.filter(c => c.dono === 'primo');
      alvo.innerHTML = meus.map(c => `
        <div class="cartao-bloco cartao-primo">
          <div class="cartao-header">
            <span class="cartao-final">•••• ${Fmt.txt(c.final)}</span>
            <span class="cartao-subtotal">${Fmt.moedaComSinal(c.subtotalCentavos)}</span>
          </div>
          ${c.lancamentos.map(l => `
            <div class="lancamento-item">
              <div class="lancamento-info">
                <div class="lancamento-data">${Fmt.txt(l.data)}</div>
                <div class="lancamento-desc">
                  ${Fmt.txt(l.descricao)}
                  ${l.parcela ? `<span class="parcela">${Fmt.txt(l.parcela)}</span>` : ''}
                </div>
              </div>
              <div class="lancamento-valor ${l.tipo}">
                ${l.tipo === 'estorno' ? '<span class="tag-estorno">estorno</span>' : ''}
                ${l.valorCentavos < 0 ? '−' : ''}${Fmt.moeda(Math.abs(l.valorCentavos))}
              </div>
            </div>`).join('')}
        </div>`).join('') || '<div class="cartao-resumido">Nenhum lançamento seu nesta fatura.</div>';

    } catch (e) {
      alvo.innerHTML = `<div class="erro-inline">Erro ao carregar os lançamentos.</div>`;
    }
  }

  async function _pagar(faturaId, btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    try {
      const res = await API.post({ acao: 'registrarPagamento', faturaId });
      if (res.ok) {
        UI.toast('Pago! O Pinho já vê aqui. ✅', 'success');
        await carregar();
      } else {
        UI.toast(res.erro || 'Erro ao registrar.', 'error');
        btn.disabled = false;
        btn.textContent = 'Marcar pago';
      }
    } catch (e) {
      UI.toast('Erro de conexão.', 'error');
      btn.disabled = false;
      btn.textContent = 'Marcar pago';
    }
  }

  // ── Lembrete .ics: um evento por fatura em aberto ────────
  function _lembrete() {
    if (!resumo || !resumo.mesAtual) return;

    const cfg = NEGAPAY_CONFIG.lembrete;
    const abertas = resumo.mesAtual.faturas.filter(f => !f.pago);
    if (!abertas.length) return;

    const eventos = abertas.map(f => {
      const d = Fmt.paraDate(f.vencimento);
      if (!d) return null;
      const dt = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      const valor = Fmt.moeda(f.totalPrimoCentavos);
      return [
        'BEGIN:VEVENT',
        `DTSTART;VALUE=DATE:${dt}`,
        `DTEND;VALUE=DATE:${dt}`,
        `SUMMARY:${cfg.titulo(valor)} (${f.produto})`,
        `DESCRIPTION:${cfg.descricao(valor, f.produto)}`,
        'STATUS:CONFIRMED',
        `UID:negapay-${f.faturaId}@negapay`,
        'BEGIN:VALARM', 'ACTION:DISPLAY',
        `DESCRIPTION:${cfg.titulo(valor)}`, 'TRIGGER:-P1D', 'END:VALARM',
        'BEGIN:VALARM', 'ACTION:DISPLAY',
        `DESCRIPTION:${cfg.titulo(valor)} — VENCE HOJE!`, 'TRIGGER:PT0S', 'END:VALARM',
        'END:VEVENT'
      ].join('\r\n');
    }).filter(Boolean);

    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NegaPay//NegaPay//PT',
                 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...eventos, 'END:VCALENDAR'].join('\r\n');

    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `negapay-${resumo.mesAtual.mesAno.replace('/', '-')}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    UI.toast(`${eventos.length} lembrete(s) baixado(s). Abra para adicionar ao Calendário 📅`, 'success');
  }

  // ── Meses anteriores ─────────────────────────────────────
  function renderHistorico(res) {
    const container = document.getElementById('primo-historico');
    const anteriores = res.meses.slice(1);

    if (!anteriores.length) { container.innerHTML = ''; return; }

    container.innerHTML = `
      <div class="card">
        <p class="card-title">📋 Meses anteriores</p>
        ${anteriores.map(m => {
          const quitado = m.totalCentavos - m.pagoCentavos === 0;
          const credito = m.totalCentavos < 0;
          return `
          <div class="historico-item">
            <div>
              <div class="historico-mes">${Fmt.txt(Fmt.mesAnoCurto(m.mesAno))}</div>
              <div class="historico-produto">${m.faturas.length} fatura(s)</div>
            </div>
            <div class="historico-right">
              <span class="historico-valor">${Fmt.moedaComSinal(m.totalCentavos)}</span>
              <span class="badge ${quitado ? 'badge-pago' : credito ? 'badge-credito' : 'badge-vencido'}">
                ${quitado ? '✓ Quitado' : credito ? '★ Crédito' : '⚠ Em aberto'}
              </span>
            </div>
          </div>`;
        }).join('')}
      </div>`;
  }

  return { init, _pagar, _lembrete, _detalhar };

})();

if (typeof window !== "undefined") window.Primo = Primo;
