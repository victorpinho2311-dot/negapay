// ============================================================
//  NegaPay — Painel do Primo (Readonly)
//  Visualização de faturas, marcar como pago, lembrete iOS
// ============================================================

const Primo = (() => {

  let faturaAtual = null;

  // ── Inicializa painel ────────────────────────────────────
  async function init() {
    renderHeader();
    await carregarFaturaAtual();
    await renderHistorico();
  }

  // ── Header com saudação ──────────────────────────────────
  function renderHeader() {
    const hora = new Date().getHours();
    document.getElementById('header-greeting').textContent =
      NEGAPAY_CONFIG.textos.saudacaoPrimo(hora);
  }

  // ── Carrega e exibe a fatura mais recente ────────────────
  async function carregarFaturaAtual() {
    const container = document.getElementById('primo-atual');
    container.innerHTML = `
      <div style="text-align:center;padding:2rem">
        <span class="spinner" style="border-color:rgba(0,0,0,0.15);border-top-color:var(--brand-blue)"></span>
      </div>
    `;

    try {
      const res = await API.post({ acao: 'listarFaturas' });

      if (!res.ok || res.faturas.length === 0) {
        container.innerHTML = `
          <div class="summary-card">
            <div class="summary-mes">Sem fatura</div>
            <div class="summary-valor">R$ 0,00</div>
            <div class="summary-vencimento">Nenhuma fatura publicada ainda</div>
          </div>
        `;
        return;
      }

      const faturaInfo = res.faturas[0]; // mais recente
      const detalhes = await API.post({ acao: 'getFatura', faturaId: faturaInfo.faturaId });

      if (!detalhes.ok) throw new Error(detalhes.erro);

      faturaAtual = detalhes.fatura;
      renderFaturaAtual(faturaAtual);

    } catch (err) {
      container.innerHTML = `
        <div class="card" style="color:var(--danger);text-align:center">
          Erro ao carregar fatura. Tente novamente.
        </div>
      `;
      console.error(err);
    }
  }

  // ── Render da fatura atual (card hero + lançamentos) ─────
  function renderFaturaAtual(fatura) {
    const container = document.getElementById('primo-atual');
    const banco = NEGAPAY_CONFIG.bancos.find(b => b.id === fatura.banco) || NEGAPAY_CONFIG.bancos[0];
    const pago = fatura.pago;
    const vencido = isVencido(fatura.vencimento) && !pago;
    const diasParaVencer = diasAteVencimento(fatura.vencimento);

    let badgeClass = 'badge-aberto';
    let badgeTexto = '⏳ Em aberto';
    if (pago)   { badgeClass = 'badge-pago';    badgeTexto = '✓ Pago'; }
    if (vencido) { badgeClass = 'badge-vencido'; badgeTexto = '⚠ Vencido'; }

    const avisoVencimento = !pago && diasParaVencer <= NEGAPAY_CONFIG.lembrete.diasAntesAviso
      ? `<div style="background:var(--warning-bg);border:1px solid var(--warning);border-radius:var(--radius-sm);padding:0.6rem 1rem;margin-bottom:1rem;font-size:0.85rem;font-weight:700;color:var(--warning)">
          ⚡ ${diasParaVencer === 0 ? 'Vence hoje!' : diasParaVencer < 0 ? `Venceu há ${Math.abs(diasParaVencer)} dia(s)` : `Vence em ${diasParaVencer} dia(s)`}
        </div>`
      : '';

    container.innerHTML = `
      <!-- Card hero com total -->
      <div class="summary-card">
        <div class="summary-status">
          <span class="badge ${badgeClass}">${badgeTexto}</span>
        </div>
        <div class="summary-mes">Fatura ${formatarMesAno(fatura.mesAno)}</div>
        <div class="summary-valor">${formatarMoeda(fatura.totalGeral)}</div>
        <div class="summary-vencimento">Vencimento: ${formatarVencimento(fatura.vencimento)}</div>
      </div>

      ${avisoVencimento}

      <!-- Lembrete iOS -->
      ${!pago ? `
        <div class="lembrete-card">
          <div class="lembrete-info">
            <div class="lembrete-titulo">📅 Adicionar ao Calendário</div>
            <div class="lembrete-sub">Receba um lembrete 1 dia antes do vencimento</div>
          </div>
          <button class="btn-lembrete" onclick="Primo._gerarLembrete()">+ Adicionar</button>
        </div>
      ` : ''}

      <!-- Imagem do cartão -->
      <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1rem">
        <img src="${banco.logoUrl}" alt="${banco.nome}" style="height:26px" onerror="this.style.display='none'">
        <span style="font-size:0.85rem;font-weight:700;color:var(--text-secondary)">${banco.nome}</span>
      </div>
      <div style="margin-bottom:1.25rem">
        <img src="${banco.cardImageUrl}" alt="Cartão ${banco.nome}"
          style="width:100%;max-width:280px;border-radius:var(--radius-md);box-shadow:var(--shadow-md)"
          onerror="this.style.display='none'">
      </div>

      <!-- Lançamentos por cartão -->
      ${fatura.cartoes.map(cartao => renderCartao(cartao)).join('')}

      <!-- Botão marcar como pago -->
      ${!pago ? `
        <button class="btn btn-success btn-full" id="btn-pago" onclick="Primo._marcarPago()">
          ✓ Marcar como pago
        </button>
        <p style="font-size:0.75rem;color:var(--text-muted);text-align:center;margin-top:0.5rem">
          Isso avisará o Pinho que você pagou 👍
        </p>
      ` : `
        <div style="text-align:center;padding:1.5rem;color:var(--success)">
          <div style="font-size:2rem;margin-bottom:0.5rem">✓</div>
          <div style="font-weight:800;font-size:1rem">Fatura paga!</div>
          <div style="font-size:0.78rem;color:var(--text-muted);margin-top:0.2rem">Pago em ${formatarData(fatura.dataPagamento)}</div>
        </div>
      `}
    `;
  }

  // ── Render de um cartão com lançamentos ──────────────────
  function renderCartao(cartao) {
    return `
      <div class="card" style="margin-bottom:1rem">
        <div class="cartao-header">
          <div>
            <span class="cartao-final">•••• ${cartao.final}</span>
            ${cartao.apelido ? `<span style="font-size:0.78rem;color:var(--text-muted);margin-left:0.5rem">${cartao.apelido}</span>` : ''}
          </div>
          <span class="cartao-subtotal">${formatarMoeda(cartao.subtotal)}</span>
        </div>
        ${cartao.lancamentos.map((l, idx) => `
          <div class="lancamento-item" style="animation-delay:${idx * 0.04}s">
            <div class="lancamento-info">
              <div class="lancamento-data">${formatarDataLanc(l.data)}</div>
              <div class="lancamento-desc" title="${l.descricao}">${l.descricao}</div>
            </div>
            <div class="lancamento-valor ${l.tipo}">
              ${l.tipo === 'estorno' ? '<span style="font-size:0.7rem;background:var(--estorno-bg);color:var(--estorno);padding:1px 5px;border-radius:4px;margin-right:4px">estorno</span>' : ''}
              ${l.tipo === 'estorno' ? '−' : ''}${formatarMoeda(Math.abs(l.valor))}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // ── Marcar como pago ─────────────────────────────────────
  async function _marcarPago() {
    if (!faturaAtual) return;

    const btn = document.getElementById('btn-pago');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Registrando...';

    try {
      const res = await API.post({ acao: 'marcarPago', faturaId: faturaAtual.faturaId });

      if (res.ok) {
        UI.toast('Pago! O Pinho já foi notificado. ✅', 'success');
        await carregarFaturaAtual(); // recarrega com status atualizado
        await renderHistorico();
      } else {
        UI.toast('Erro: ' + res.erro, 'error');
        btn.disabled = false;
        btn.innerHTML = '✓ Marcar como pago';
      }
    } catch (err) {
      UI.toast('Erro de conexão. Tente novamente.', 'error');
      btn.disabled = false;
      btn.innerHTML = '✓ Marcar como pago';
    }
  }

  // ── Gerar lembrete .ics para iPhone ──────────────────────
  function _gerarLembrete() {
    if (!faturaAtual) return;

    const cfg = NEGAPAY_CONFIG.lembrete;
    const banco = NEGAPAY_CONFIG.bancos.find(b => b.id === faturaAtual.banco) || NEGAPAY_CONFIG.bancos[0];

    // Parseia data de vencimento DD/MM/AAAA
    const [d, m, a] = faturaAtual.vencimento.split('/').map(Number);
    const vencimento = new Date(a, m - 1, d);

    // Data do evento = dia do vencimento
    const dtStart = formatarDataICS(vencimento);

    // Alarme = 1 dia antes (1440 minutos)
    const valorFormatado = formatarMoeda(faturaAtual.totalGeral);

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//NegaPay//NegaPay//PT',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `DTSTART;VALUE=DATE:${dtStart}`,
      `DTEND;VALUE=DATE:${dtStart}`,
      `SUMMARY:${cfg.titulo(valorFormatado)}`,
      `DESCRIPTION:${cfg.descricao(valorFormatado, banco.nome)}`,
      'STATUS:CONFIRMED',
      `UID:negapay-${faturaAtual.faturaId}@negapay`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${cfg.titulo(valorFormatado)}`,
      'TRIGGER:-P1D',  // 1 dia antes
      'END:VALARM',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${cfg.titulo(valorFormatado)} — VENCE HOJE!`,
      'TRIGGER:PT0S',  // no dia
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');

    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a_tag = document.createElement('a');
    a_tag.href = url;
    a_tag.download = `negapay-fatura-${faturaAtual.mesAno.replace('/', '-')}.ics`;
    document.body.appendChild(a_tag);
    a_tag.click();
    document.body.removeChild(a_tag);
    URL.revokeObjectURL(url);

    UI.toast('Arquivo baixado! Abra-o para adicionar ao Calendário 📅', 'success');
  }

  // ── Histórico de faturas anteriores ──────────────────────
  async function renderHistorico() {
    const container = document.getElementById('primo-historico');

    try {
      const res = await API.post({ acao: 'listarFaturas' });

      if (!res.ok || res.faturas.length <= 1) {
        container.innerHTML = '';
        return;
      }

      // Pula a primeira (já exibida no card atual)
      const anteriores = res.faturas.slice(1);

      container.innerHTML = `
        <div class="card">
          <p class="card-title">📋 Faturas anteriores</p>
          ${anteriores.map(f => `
            <div class="historico-item">
              <div>
                <div class="historico-mes">${formatarMesAno(f.mesAno)}</div>
                <div style="font-size:0.78rem;color:var(--text-muted)">Venc. ${f.vencimento}</div>
              </div>
              <div class="historico-right">
                <span class="historico-valor" style="color:var(--text-secondary)">${formatarMoeda(f.totalGeral)}</span>
                <span class="badge ${f.pago ? 'badge-pago' : 'badge-vencido'}">
                  ${f.pago ? '✓ Pago' : '⚠ Não pago'}
                </span>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    } catch (err) {
      container.innerHTML = '';
    }
  }

  // ── Helpers ──────────────────────────────────────────────
  function formatarMoeda(valor) {
    return 'R$ ' + Number(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatarMesAno(mesAno) {
    if (!mesAno) return 'Fatura';
    const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    let mes, ano;
    if (mesAno.length > 7) {
      const d = new Date(mesAno);
      mes = String(d.getUTCMonth() + 1);
      ano = String(d.getUTCFullYear());
    } else {
      const partes = mesAno.split('/');
      mes = partes[0]; ano = partes[1] || '';
    }
    return (meses[parseInt(mes) - 1] || mes) + ' ' + ano;
  }

  function formatarVencimento(venc) {
    if (!venc) return '';
    if (venc.includes('T') || (venc.length > 8 && venc.includes('-'))) {
      const d = new Date(venc);
      if (!isNaN(d)) {
        return String(d.getUTCDate()).padStart(2,'0') + '/' +
               String(d.getUTCMonth()+1).padStart(2,'0') + '/' +
               d.getUTCFullYear();
      }
    }
    return venc;
  }

  function formatarDataLanc(data) {
    if (!data) return '';
    // Se vier como ISO (2026-05-11T...), converte para DD/MM
    if (data.includes('T') || data.includes('-')) {
      const d = new Date(data);
      if (!isNaN(d)) {
        return String(d.getUTCDate()).padStart(2,'0') + '/' + String(d.getUTCMonth()+1).padStart(2,'0');
      }
    }
    return data; // já está no formato DD/MM
  }

  function formatarData(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    return d.toLocaleDateString('pt-BR');
  }

  function formatarDataICS(date) {
    const a = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${a}${m}${d}`;
  }

  function parseVenc(vencimento) {
    if (!vencimento) return new Date();
    if (vencimento.includes('T') || (vencimento.length > 8 && vencimento.includes('-'))) return new Date(vencimento);
    // Formato DD/MM/YYYY
    const partes = vencimento.split('/').map(Number);
    if (partes.length === 3) {
      const [d, m, a] = partes;
      return new Date(a, m - 1, d);
    }
    return new Date(vencimento);
  }

  function isVencido(vencimento) {
    return new Date() > parseVenc(vencimento);
  }

  function diasAteVencimento(vencimento) {
    const venc = parseVenc(vencimento);
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    return Math.round((venc - hoje) / (1000 * 60 * 60 * 24));
  }

  return { init, _marcarPago, _gerarLembrete };

})();