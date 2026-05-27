// ============================================================
//  NegaPay — Painel Admin v1.1
//  Adicionado: botão excluir fatura no histórico
// ============================================================

const Admin = (() => {

  let faturaProcessada = null;
  let bancoSelecionado = null;

  function init() {
    renderHeader();
    renderUploadSection();
    renderHistorico();
  }

  function renderHeader() {
    const hora = new Date().getHours();
    document.getElementById('admin-header-greeting').textContent =
      NEGAPAY_CONFIG.textos.saudacaoAdmin(hora);
  }

  function renderUploadSection() {
    const container = document.getElementById('admin-upload');
    const bancos = NEGAPAY_CONFIG.bancos;

    const seletorBanco = bancos.length > 1
      ? `<div class="banco-select-group" id="banco-selector">
          ${bancos.map((b, i) => `
            <div class="banco-option ${i === 0 ? 'selected' : ''}" data-banco="${b.id}" onclick="Admin._selecionarBanco('${b.id}', this)">
              <img src="${b.logoUrl}" alt="${b.nome}" onerror="this.style.display='none'">
              <span style="font-size:0.85rem;font-weight:700">${b.nome}</span>
            </div>
          `).join('')}
        </div>`
      : '';

    bancoSelecionado = bancos[0].id;

    container.innerHTML = `
      <div class="card">
        <p class="card-title">📤 Nova fatura</p>
        ${seletorBanco}
        <div class="upload-zone" id="upload-zone" onclick="document.getElementById('file-input').click()">
          <div class="upload-icon">📄</div>
          <div class="upload-title">Clique para selecionar a fatura</div>
          <div class="upload-sub">PDF da fatura completa do cartão</div>
        </div>
        <input type="file" id="file-input" accept=".pdf,.csv" style="display:none" onchange="Admin._onFileSelect(event)">
        <div class="progress-bar" id="progress-bar" style="display:none">
          <div class="progress-fill" id="progress-fill" style="width:0%"></div>
        </div>
        <div id="preview-section" style="display:none"></div>
      </div>
    `;

    const zone = document.getElementById('upload-zone');
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file && (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".csv"))) processarPDF(file);
      else UI.toast('Selecione um arquivo PDF válido', 'error');
    });
  }

  function _selecionarBanco(bancoId, el) {
    bancoSelecionado = bancoId;
    document.querySelectorAll('.banco-option').forEach(o => o.classList.remove('selected'));
    el.classList.add('selected');
  }

  function _onFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    processarPDF(file);
  }

  async function processarPDF(file) {
    const progressBar  = document.getElementById('progress-bar');
    const progressFill = document.getElementById('progress-fill');
    const preview      = document.getElementById('preview-section');

    progressBar.style.display = 'block';
    progressFill.style.width  = '20%';
    preview.style.display     = 'none';

    try {
      const banco  = NEGAPAY_CONFIG.bancos.find(b => b.id === bancoSelecionado);
      const mesAno = calcularMesAno();

      progressFill.style.width = '50%';
      const resultado = await PDFParser.processar(file, banco, mesAno);
      progressFill.style.width = '90%';

      if (resultado.cartoes.length === 0) {
        UI.toast('Nenhum cartão do primo encontrado. Verifique os dígitos configurados.', 'error');
        progressBar.style.display = 'none';
        return;
      }

      faturaProcessada = resultado;
      progressFill.style.width = '100%';

      setTimeout(() => {
        progressBar.style.display = 'none';
        renderPreview(resultado, banco);
        preview.style.display = 'block';
      }, 400);

    } catch (err) {
      progressBar.style.display = 'none';
      UI.toast('Erro ao processar o PDF: ' + err.message, 'error');
      console.error(err);
    }
  }

  function calcularMesAno() {
    const agora = new Date();
    const mes   = String(agora.getMonth() + 1).padStart(2, '0');
    const ano   = agora.getFullYear();
    return `${mes}/${ano}`;
  }

  function renderPreview(resultado, banco) {
    const preview = document.getElementById('preview-section');

    preview.innerHTML = `
      <hr class="divider">
      <p class="card-title" style="margin-top:0.5rem">✅ Fatura processada — revise antes de publicar</p>
      <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1.25rem">
        <img src="${banco.logoUrl}" alt="${banco.nome}" style="height:28px" onerror="this.style.display='none'">
        <div>
          <div style="font-size:0.9rem;font-weight:700">${banco.nome}</div>
          <div style="font-size:0.78rem;color:var(--text-secondary)">
            Vencimento: ${formatarVencimento(resultado.vencimento)} · Referência: ${resultado.mesAno}
          </div>
        </div>
      </div>
      ${resultado.cartoes.map(cartao => renderCartaoPreview(cartao)).join('')}
      <div style="background:var(--surface-2);border-radius:var(--radius-md);padding:1rem;margin-top:1rem;display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:0.9rem;font-weight:700;color:var(--text-secondary)">Total a pagar pelo Getlio</span>
        <span style="font-size:1.4rem;font-weight:900;color:var(--text-primary)">${formatarMoeda(resultado.totalGeral)}</span>
      </div>
      <div style="display:flex;gap:0.75rem;margin-top:1rem">
        <button class="btn btn-secondary" onclick="Admin._cancelarPreview()" style="flex:1">Cancelar</button>
        <button class="btn btn-primary" onclick="Admin._publicarFatura()" style="flex:2" id="btn-publicar">
          Publicar fatura
        </button>
      </div>
    `;
  }

  function renderCartaoPreview(cartao) {
    return `
      <div style="margin-bottom:1rem">
        <div class="cartao-header">
          <div>
            <span class="cartao-final">•••• ${cartao.final}</span>
            <span style="font-size:0.8rem;color:var(--text-muted);margin-left:0.5rem">${cartao.apelido || ''}</span>
          </div>
          <span class="cartao-subtotal">${formatarMoeda(cartao.subtotal)}</span>
        </div>
        ${cartao.lancamentos.map((l, idx) => `
          <div class="lancamento-item" style="animation-delay:${idx * 0.03}s">
            <div class="lancamento-info">
              <div class="lancamento-data">${formatarDataLanc(l.data)}</div>
              <div class="lancamento-desc">${l.descricao}</div>
            </div>
            <div class="lancamento-valor ${l.tipo}">${l.tipo === 'estorno' ? '−' : ''}${formatarMoeda(Math.abs(l.valor))}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function _cancelarPreview() {
    document.getElementById('preview-section').style.display = 'none';
    document.getElementById('file-input').value = '';
    faturaProcessada = null;
  }

  async function _publicarFatura() {
    if (!faturaProcessada) return;

    const btn = document.getElementById('btn-publicar');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Publicando...';

    try {
      const res = await API.post({ acao: 'salvarFatura', fatura: faturaProcessada });

      if (res.ok) {
        UI.toast('Fatura publicada! O Getlio já pode visualizar. ✅', 'success');
        _cancelarPreview();
        await renderHistorico();
      } else {
        UI.toast('Erro ao publicar: ' + res.erro, 'error');
      }
    } catch (err) {
      UI.toast('Erro de conexão. Tente novamente.', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = 'Publicar fatura';
    }
  }

  async function renderHistorico() {
    const container = document.getElementById('admin-historico');
    container.innerHTML = `
      <div class="card">
        <p class="card-title">📋 Histórico de faturas</p>
        <div id="historico-list">
          <div style="text-align:center;padding:2rem;color:var(--text-muted)">
            <span class="spinner" style="border-color:rgba(0,0,0,0.15);border-top-color:var(--brand-blue)"></span>
          </div>
        </div>
      </div>
    `;

    try {
      const res  = await API.post({ acao: 'listarFaturas' });
      const list = document.getElementById('historico-list');

      if (!res.ok || res.faturas.length === 0) {
        list.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">📭</div>
            <div class="empty-title">Nenhuma fatura publicada ainda</div>
            <div class="empty-sub">Faça o upload da primeira fatura acima</div>
          </div>
        `;
        return;
      }

      list.innerHTML = res.faturas.map(f => `
        <div class="historico-item">
          <div onclick="Admin._verFatura('${f.faturaId}')" style="flex:1;cursor:pointer">
            <div class="historico-mes">${formatarMesAno(f.mesAno)}</div>
            <div style="font-size:0.78rem;color:var(--text-muted)">Venc. ${formatarVencimento(f.vencimento)}</div>
          </div>
          <div class="historico-right">
            <span class="historico-valor">${formatarMoeda(f.totalGeral)}</span>
            <span class="badge ${f.pago ? 'badge-pago' : statusBadge(f.vencimento)}">
              ${f.pago ? '✓ Pago' : statusTexto(f.vencimento)}
            </span>
            <button
              class="btn-notificacao"
              onclick="Admin._enviarNotificacao('${f.faturaId}', this)"
              title="Enviar notificação por email"
            >Enviar notificação</button>
            <button
              onclick="Admin._confirmarExcluir('${f.faturaId}', '${formatarMesAno(f.mesAno)}')"
              title="Excluir fatura"
              style="background:none;border:none;cursor:pointer;padding:4px 6px;border-radius:6px;color:var(--text-muted);font-size:1rem;transition:all 0.2s;line-height:1"
              onmouseover="this.style.background='var(--danger-bg)';this.style.color='var(--danger)'"
              onmouseout="this.style.background='none';this.style.color='var(--text-muted)'"
            >🗑</button>
          </div>
        </div>
      `).join('');

    } catch (err) {
      document.getElementById('historico-list').innerHTML =
        `<div style="color:var(--danger);text-align:center;padding:1rem;font-size:0.85rem">Erro ao carregar histórico</div>`;
    }
  }

  async function _enviarNotificacao(faturaId, btn) {
    if (!faturaId || !btn) return;

    const textoOriginal = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Enviando...';

    try {
      const appUrl = window.location.href.split('#')[0];
      const res = await API.post({ acao: 'enviarNotificacaoFatura', faturaId, appUrl });

      if (res.ok) {
        UI.toast('Notificação enviada por email.', 'success');
        btn.textContent = 'Enviado';
        btn.classList.add('enviado');
      } else {
        UI.toast(res.erro || 'Erro ao enviar notificação.', 'error');
        btn.disabled = false;
        btn.textContent = textoOriginal;
      }
    } catch (err) {
      UI.toast('Erro de conexão ao enviar notificação.', 'error');
      btn.disabled = false;
      btn.textContent = textoOriginal;
    }
  }

  // ── Confirma exclusão com dialog simples ─────────────────
  function _confirmarExcluir(faturaId, mesAno) {
    const confirmado = window.confirm(`Excluir a fatura de ${mesAno}?\n\nEssa ação não pode ser desfeita.`);
    if (confirmado) _excluirFatura(faturaId);
  }

  async function _excluirFatura(faturaId) {
    try {
      const res = await API.post({ acao: 'excluirFatura', faturaId });
      if (res.ok) {
        UI.toast('Fatura excluída.', 'success');
        await renderHistorico();
      } else {
        UI.toast('Erro ao excluir: ' + res.erro, 'error');
      }
    } catch (err) {
      UI.toast('Erro de conexão.', 'error');
    }
  }

  async function _verFatura(faturaId) {
    UI.toast('Carregando fatura...', '');
    const res = await API.post({ acao: 'getFatura', faturaId });
    if (res.ok) {
      const banco = NEGAPAY_CONFIG.bancos.find(b => b.id === res.fatura.banco) || NEGAPAY_CONFIG.bancos[0];
      faturaProcessada = res.fatura;
      renderPreviewReadonly(res.fatura, banco);
      document.getElementById('preview-section').style.display = 'block';
      document.getElementById('preview-section').scrollIntoView({ behavior: 'smooth' });
    } else {
      UI.toast('Erro ao carregar fatura', 'error');
    }
  }

  // Preview somente leitura (fatura já publicada)
  function renderPreviewReadonly(resultado, banco) {
    const preview = document.getElementById('preview-section');
    preview.innerHTML = `
      <hr class="divider">
      <p class="card-title" style="margin-top:0.5rem">🔍 Visualizando fatura publicada</p>
      <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1.25rem">
        <img src="${banco.logoUrl}" alt="${banco.nome}" style="height:28px" onerror="this.style.display='none'">
        <div>
          <div style="font-size:0.9rem;font-weight:700">${banco.nome}</div>
          <div style="font-size:0.78rem;color:var(--text-secondary)">
            Vencimento: ${formatarVencimento(resultado.vencimento)} · Referência: ${formatarMesAno(resultado.mesAno)}
          </div>
        </div>
      </div>
      ${(resultado.cartoes || []).map(cartao => renderCartaoPreview(cartao)).join('')}
      <div style="background:var(--surface-2);border-radius:var(--radius-md);padding:1rem;margin-top:1rem;display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:0.9rem;font-weight:700;color:var(--text-secondary)">Total pago pelo Getlio</span>
        <span style="font-size:1.4rem;font-weight:900;color:var(--text-primary)">${formatarMoeda(resultado.totalGeral)}</span>
      </div>
      <div style="margin-top:1rem">
        <button class="btn btn-secondary btn-full" onclick="Admin._cancelarPreview()">Fechar</button>
      </div>
    `;
  }

  // ── Helpers ──────────────────────────────────────────────
  function formatarVencimento(venc) {
    if (!venc) return '';
    if (venc.includes('T') || venc.match(/^[0-9]{4}-/)) {
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
    if (data.includes('T') || (data.includes('-') && data.length > 5)) {
      const d = new Date(data);
      if (!isNaN(d)) {
        return String(d.getUTCDate()).padStart(2,'0') + '/' + String(d.getUTCMonth()+1).padStart(2,'0');
      }
    }
    return data;
  }

  function formatarMoeda(valor) {
    return 'R$ ' + Number(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatarMesAno(mesAno) {
    if (!mesAno) return 'Fatura';
    const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    // Aceita DD/MM/YYYY, MM/YYYY, ou ISO
    let mes, ano;
    if (mesAno.includes('T') || mesAno.match(/^\d{4}-/)) {
      const d = new Date(mesAno);
      mes = String(d.getUTCMonth() + 1);
      ano = String(d.getUTCFullYear());
    } else {
      const partes = mesAno.split('/');
      mes = partes[0];
      ano = partes[1] || partes[2] || '';
    }
    const idx = parseInt(mes) - 1;
    return `${meses[idx] || mes} ${ano}`;
  }

  function parseVenc(vencimento) {
    if (!vencimento) return new Date();
    if (vencimento.includes('T') || vencimento.match(/^[0-9]{4}-/)) return new Date(vencimento);
    const [d, m, a] = vencimento.split('/').map(Number);
    return new Date(a, m - 1, d);
  }

  function statusBadge(vencimento) {
    return new Date() > parseVenc(vencimento) ? 'badge-vencido' : 'badge-aberto-lista';
  }

  function statusTexto(vencimento) {
    return new Date() > parseVenc(vencimento) ? '⚠ Vencido' : '⏳ Em aberto';
  }

  return {
    init, renderHistorico,
    _selecionarBanco, _onFileSelect,
    _cancelarPreview, _publicarFatura,
    _verFatura, _confirmarExcluir, _enviarNotificacao
  };

})();
