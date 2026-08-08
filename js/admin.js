// ============================================================
//  NegaPay — Painel Admin v2
//
//  Regras que a tela impoe:
//  - Nenhuma fatura e publicada se a soma dos lancamentos nao
//    fechar com o valor que o banco declarou para cada cartao.
//  - Nenhum cartao e ignorado em silencio: cartao desconhecido
//    para a publicacao ate voce dizer de quem e.
//  - O mes e o vencimento vem do PDF, nunca do relogio.
// ============================================================

const Admin = (() => {

  let faturaLida = null;      // resultado do parser
  let cartoesConhecidos = {}; // final -> { dono, apelido }

  async function init() {
    renderHeader();
    renderUpload();
    await carregarCartoes();
    await renderHistorico();
  }

  function renderHeader() {
    document.getElementById('admin-header-greeting').textContent =
      NEGAPAY_CONFIG.textos.saudacaoAdmin(new Date().getHours());
  }

  async function carregarCartoes() {
    try {
      const res = await API.post({ acao: 'listarCartoes' });
      cartoesConhecidos = {};
      if (res.ok) {
        res.cartoes.forEach(c => {
          cartoesConhecidos[String(c.final)] = { dono: c.dono, apelido: c.apelido };
        });
      }
    } catch (e) {
      cartoesConhecidos = {};
    }
  }

  // ── Upload ───────────────────────────────────────────────
  function renderUpload() {
    const container = document.getElementById('admin-upload');
    container.innerHTML = `
      <div class="card">
        <p class="card-title">📤 Nova fatura</p>
        <div class="upload-zone" id="upload-zone"
             onclick="document.getElementById('file-input').click()">
          <div class="upload-icon">📄</div>
          <div class="upload-title">Clique para selecionar a fatura</div>
          <div class="upload-sub">PDF da fatura completa do Bradesco</div>
        </div>
        <input type="file" id="file-input" accept="application/pdf,.pdf"
               style="display:none" onchange="Admin._selecionar(event)">
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
      if (file) processar(file);
    });
  }

  function _selecionar(event) {
    const file = event.target.files[0];
    if (file) processar(file);
  }

  async function processar(file) {
    const barra = document.getElementById('progress-bar');
    const fill  = document.getElementById('progress-fill');
    const prev  = document.getElementById('preview-section');

    barra.style.display = 'block';
    fill.style.width = '25%';
    prev.style.display = 'none';

    try {
      fill.style.width = '60%';
      const resultado = await ParserBradesco.processar(file);
      fill.style.width = '100%';

      faturaLida = resultado;
      setTimeout(() => {
        barra.style.display = 'none';
        renderPreview(resultado);
        prev.style.display = 'block';
      }, 300);

    } catch (err) {
      barra.style.display = 'none';
      UI.toast(err.message, 'error');
      console.error(err);
    }
  }

  // ── Preview com a conferência ────────────────────────────
  function renderPreview(r) {
    const prev = document.getElementById('preview-section');
    const produto = NEGAPAY_CONFIG.produtoPorCapa(r.cartaoCapa);
    const nomeProduto = produto ? produto.nome : `Cartão final ${r.cartaoCapa}`;

    const desconhecidos = r.cartoes.filter(c => !cartoesConhecidos[String(c.final)]);
    const doPrimo = r.cartoes.filter(c =>
      (cartoesConhecidos[String(c.final)] || {}).dono === 'primo');
    const totalPrimo = doPrimo.reduce((s, c) => s + c.subtotal, 0);

    prev.innerHTML = `
      <hr class="divider">
      ${renderConferencia(r)}

      <div class="fatura-cabecalho">
        <img src="${produto ? produto.logoUrl : NEGAPAY_CONFIG.bancoPadrao.logoUrl}"
             alt="" style="height:28px" onerror="this.style.display='none'">
        <div>
          <div class="fatura-produto">${Fmt.txt(nomeProduto)}</div>
          <div class="fatura-meta">
            Vence ${Fmt.txt(r.vencimento)} · Referência ${Fmt.txt(Fmt.mesAnoLongo(r.mesAno))}
          </div>
        </div>
      </div>

      ${desconhecidos.length ? renderCartoesDesconhecidos(desconhecidos) : ''}

      ${r.cartoes.map(c => renderCartao(c)).join('')}

      <div class="total-box">
        <span class="total-label">Total a pagar pelo ${Fmt.txt(NEGAPAY_CONFIG.primo.nome)}</span>
        <span class="total-valor">${Fmt.moeda(totalPrimo)}</span>
      </div>

      <div class="acoes-preview">
        <button class="btn btn-secondary" onclick="Admin._cancelar()">Cancelar</button>
        <button class="btn btn-primary" id="btn-publicar"
                onclick="Admin._publicar()"
                ${(!r.ok || desconhecidos.length) ? 'disabled' : ''}>
          ${desconhecidos.length ? 'Defina os cartões acima' :
            (!r.ok ? 'Conferência falhou' : 'Publicar fatura')}
        </button>
      </div>
    `;
  }

  // Bloco que mostra, explicitamente, se a conta fecha.
  function renderConferencia(r) {
    if (r.ok) {
      return `
        <div class="conferencia conferencia-ok">
          <div class="conferencia-titulo">✓ Conferência bateu</div>
          <div class="conferencia-texto">
            A soma dos lançamentos fecha exatamente com o valor que o banco
            declarou para cada cartão, e com o total da fatura
            (${Fmt.moeda(r.totalFatura)}).
          </div>
        </div>`;
    }

    const linhas = [];
    r.divergentes.forEach(c => {
      linhas.push(`final ${Fmt.txt(c.final)}: somei ${Fmt.moeda(c.subtotal)},
                   o banco declarou ${Fmt.moeda(c.declarado)}
                   (diferença de ${Fmt.moedaComSinal(c.diferenca)})`);
    });
    r.semDeclarado.forEach(c => {
      linhas.push(`final ${Fmt.txt(c.final)}: não achei o valor declarado pelo banco`);
    });
    if (r.totalConfere === false) {
      linhas.push(`soma das seções ${Fmt.moeda(r.somaSecoes)} ≠
                   total da fatura ${Fmt.moeda(r.totalFatura)}`);
    }

    return `
      <div class="conferencia conferencia-erro">
        <div class="conferencia-titulo">⚠ A conta não fechou — nada será publicado</div>
        <ul class="conferencia-lista">
          ${linhas.map(l => `<li>${l}</li>`).join('')}
        </ul>
        <div class="conferencia-texto">
          Isso quase sempre significa que o PDF tem um formato que o parser
          ainda não conhece. Me mande este arquivo em vez de publicar um valor errado.
        </div>
      </div>`;
  }

  function renderCartoesDesconhecidos(lista) {
    return `
      <div class="conferencia conferencia-aviso">
        <div class="conferencia-titulo">Cartão novo nesta fatura</div>
        <div class="conferencia-texto">
          De quem é? Enquanto não disser, não publico — foi assim que o
          cartão da Æternum virou R$ 0,00 sem ninguém perceber.
        </div>
        ${lista.map(c => `
          <div class="cartao-novo">
            <div>
              <div class="cartao-novo-final">•••• ${Fmt.txt(c.final)}</div>
              <div class="cartao-novo-titular">${Fmt.txt(c.titular)} · ${Fmt.moeda(c.subtotal)}</div>
            </div>
            <div class="cartao-novo-botoes">
              <button class="btn-mini" onclick="Admin._definirDono('${Fmt.txt(c.final)}', 'admin', this)">Meu</button>
              <button class="btn-mini btn-mini-primo" onclick="Admin._definirDono('${Fmt.txt(c.final)}', 'primo', this)">${Fmt.txt(NEGAPAY_CONFIG.primo.nome)}</button>
            </div>
          </div>
        `).join('')}
      </div>`;
  }

  function renderCartao(c) {
    const info = cartoesConhecidos[String(c.final)];
    const dono = info ? info.dono : null;
    const etiqueta = dono === 'primo' ? NEGAPAY_CONFIG.primo.nome
                   : dono === 'admin' ? 'Meu' : 'sem dono';
    const classe = dono === 'primo' ? 'cartao-primo' : 'cartao-admin';

    return `
      <div class="cartao-bloco ${classe}">
        <div class="cartao-header">
          <div>
            <span class="cartao-final">•••• ${Fmt.txt(c.final)}</span>
            <span class="cartao-dono">${Fmt.txt(etiqueta)}</span>
          </div>
          <span class="cartao-subtotal">${Fmt.moeda(c.subtotal)}</span>
        </div>
        ${dono === 'primo' ? c.lancamentos.map(l => `
          <div class="lancamento-item">
            <div class="lancamento-info">
              <div class="lancamento-data">${Fmt.txt(ParserBradesco.formatarDataLancamento(l))}</div>
              <div class="lancamento-desc">
                ${Fmt.txt(l.descricao)}
                ${l.parcela ? `<span class="parcela">${Fmt.txt(l.parcela)}</span>` : ''}
              </div>
            </div>
            <div class="lancamento-valor ${l.tipo}">
              ${l.valor < 0 ? '−' : ''}${Fmt.moeda(Math.abs(l.valor))}
            </div>
          </div>
        `).join('') : `
          <div class="cartao-resumido">${c.lancamentos.length} lançamentos (não é do ${Fmt.txt(NEGAPAY_CONFIG.primo.nome)})</div>
        `}
      </div>`;
  }

  async function _definirDono(final, dono, botao) {
    const cartao = faturaLida.cartoes.find(c => String(c.final) === String(final));
    botao.disabled = true;
    try {
      const res = await API.post({
        acao: 'definirDonoCartao', final, dono,
        titular: cartao ? cartao.titular : ''
      });
      if (res.ok) {
        cartoesConhecidos[String(final)] = { dono, apelido: '' };
        UI.toast(`Cartão ${final} salvo como ${dono === 'primo' ? NEGAPAY_CONFIG.primo.nome : 'seu'}.`, 'success');
        renderPreview(faturaLida);
      } else {
        UI.toast(res.erro || 'Não consegui salvar o cartão.', 'error');
        botao.disabled = false;
      }
    } catch (e) {
      UI.toast('Erro de conexão.', 'error');
      botao.disabled = false;
    }
  }

  function _cancelar() {
    document.getElementById('preview-section').style.display = 'none';
    document.getElementById('file-input').value = '';
    faturaLida = null;
  }

  async function _publicar() {
    if (!faturaLida || !faturaLida.ok) return;

    const btn = document.getElementById('btn-publicar');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Publicando...';

    const produto = NEGAPAY_CONFIG.produtoPorCapa(faturaLida.cartaoCapa);

    try {
      const res = await API.post({
        acao: 'salvarFatura',
        fatura: {
          mesAno: faturaLida.mesAno,
          produto: produto ? produto.nome : `Final ${faturaLida.cartaoCapa}`,
          bancoId: 'bradesco',
          vencimento: faturaLida.vencimento,
          totalFaturaCentavos: faturaLida.totalFatura,
          arquivo: faturaLida.arquivo,
          cartoes: faturaLida.cartoes.map(c => ({
            final: c.final,
            titular: c.titular,
            subtotal: c.subtotal,
            declarado: c.declarado,
            confere: c.confere,
            lancamentos: c.lancamentos.map(l => ({
              data: ParserBradesco.formatarDataLancamento(l),
              descricao: l.descricao,
              parcela: l.parcela,
              valor: l.valor
            }))
          }))
        }
      });

      if (res.ok) {
        UI.toast(`Fatura publicada — ${Fmt.moeda(res.totalPrimoCentavos)} para o ${NEGAPAY_CONFIG.primo.nome}.`, 'success');
        _cancelar();
        await renderHistorico();
      } else {
        UI.toast(res.erro || 'Erro ao publicar.', 'error');
        btn.disabled = false;
        btn.innerHTML = 'Publicar fatura';
      }
    } catch (err) {
      UI.toast('Erro de conexão. Nada foi publicado.', 'error');
      btn.disabled = false;
      btn.innerHTML = 'Publicar fatura';
    }
  }

  // ── Histórico ────────────────────────────────────────────
  async function renderHistorico() {
    const container = document.getElementById('admin-historico');
    container.innerHTML = `
      <div class="card">
        <p class="card-title">📋 Faturas publicadas</p>
        <div id="historico-list">
          <div class="carregando"><span class="spinner spinner-escuro"></span></div>
        </div>
      </div>`;

    try {
      const res = await API.post({ acao: 'listarFaturas' });
      const list = document.getElementById('historico-list');

      if (!res.ok || !res.faturas.length) {
        list.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">📭</div>
            <div class="empty-title">Nenhuma fatura publicada ainda</div>
            <div class="empty-sub">Envie o PDF da primeira fatura acima</div>
          </div>`;
        return;
      }

      const abertas = res.faturas.filter(f => !f.pago);
      const acerto = abertas.length > 1 ? `
        <div class="acerto-historico">
          <div>
            <div class="acerto-titulo">Acerto histórico</div>
            <div class="acerto-texto">
              ${abertas.length} faturas em aberto. Se vocês já acertaram esses meses
              por fora, quite todas até uma data — o saldo do Getúlio passa a contar
              só do período seguinte.
            </div>
          </div>
          <button class="btn-mini btn-mini-primo" onclick="Admin._quitarAte()">Quitar até…</button>
        </div>` : '';

      list.innerHTML = acerto + res.faturas.map(f => `
        <div class="historico-item">
          <div class="historico-esq" onclick="Admin._ver('${Fmt.txt(f.faturaId)}')">
            <div class="historico-mes">${Fmt.txt(Fmt.mesAnoCurto(f.mesAno))}</div>
            <div class="historico-produto">${Fmt.txt(f.produto)}</div>
            <div class="historico-venc">Vence ${Fmt.txt(f.vencimento)}</div>
          </div>
          <div class="historico-right">
            <span class="historico-valor">${Fmt.moedaComSinal(f.totalPrimoCentavos)}</span>
            <button class="badge badge-acao ${f.pago ? 'badge-pago' : (Fmt.vencido(f.vencimento) ? 'badge-vencido' : 'badge-aberto-lista')}"
                    onclick="Admin._alternarPago('${Fmt.txt(f.faturaId)}', ${f.pago ? 'true' : 'false'})"
                    title="${f.pago ? 'Clique para desmarcar' : 'Clique para marcar como paga'}">
              ${f.pago ? '✓ Pago' : (Fmt.vencido(f.vencimento) ? '⚠ Vencido' : '⏳ Em aberto')}
            </button>
            <button class="btn-notificacao ${f.notificadoEm ? 'enviado' : ''}"
                    onclick="Admin._notificar('${Fmt.txt(f.faturaId)}', this)"
                    ${f.notificadoEm ? 'disabled' : ''}>
              ${f.notificadoEm ? 'Enviado' : 'Notificar'}
            </button>
            <button class="btn-excluir"
                    onclick="Admin._confirmarExcluir('${Fmt.txt(f.faturaId)}', '${Fmt.txt(Fmt.mesAnoCurto(f.mesAno))} · ${Fmt.txt(f.produto)}')"
                    title="Excluir fatura">🗑</button>
          </div>
        </div>
      `).join('');

    } catch (err) {
      document.getElementById('historico-list').innerHTML =
        `<div class="erro-inline">Erro ao carregar o histórico</div>`;
    }
  }

  async function _ver(faturaId) {
    UI.toast('Carregando...', '');
    const res = await API.post({ acao: 'getFatura', faturaId });
    if (!res.ok) return UI.toast('Erro ao carregar a fatura', 'error');

    const f = res.fatura;
    const prev = document.getElementById('preview-section');
    prev.innerHTML = `
      <hr class="divider">
      <p class="card-title">🔍 ${Fmt.txt(Fmt.mesAnoLongo(f.mesAno))} · ${Fmt.txt(f.produto)}</p>
      <div class="fatura-meta" style="margin-bottom:1rem">
        Vence ${Fmt.txt(f.vencimento)} ${f.conferido ? '· ✓ conferida na publicação' : ''}
      </div>
      ${f.cartoes.map(c => `
        <div class="cartao-bloco ${c.dono === 'primo' ? 'cartao-primo' : 'cartao-admin'}">
          <div class="cartao-header">
            <div>
              <span class="cartao-final">•••• ${Fmt.txt(c.final)}</span>
              <span class="cartao-dono">${c.dono === 'primo' ? Fmt.txt(NEGAPAY_CONFIG.primo.nome) : 'Meu'}</span>
            </div>
            <span class="cartao-subtotal">${Fmt.moedaComSinal(c.subtotalCentavos)}</span>
          </div>
          ${c.dono === 'primo' ? c.lancamentos.map(l => `
            <div class="lancamento-item">
              <div class="lancamento-info">
                <div class="lancamento-data">${Fmt.txt(l.data)}</div>
                <div class="lancamento-desc">
                  ${Fmt.txt(l.descricao)}
                  ${l.parcela ? `<span class="parcela">${Fmt.txt(l.parcela)}</span>` : ''}
                </div>
              </div>
              <div class="lancamento-valor ${l.tipo}">
                ${l.valorCentavos < 0 ? '−' : ''}${Fmt.moeda(Math.abs(l.valorCentavos))}
              </div>
            </div>`).join('') : ''}
        </div>`).join('')}
      <div class="total-box">
        <span class="total-label">Total do ${Fmt.txt(NEGAPAY_CONFIG.primo.nome)}</span>
        <span class="total-valor">${Fmt.moedaComSinal(f.totalPrimoCentavos)}</span>
      </div>
      <div style="margin-top:1rem">
        <button class="btn btn-secondary btn-full" onclick="Admin._cancelar()">Fechar</button>
      </div>`;
    prev.style.display = 'block';
    prev.scrollIntoView({ behavior: 'smooth' });
  }

  async function _notificar(faturaId, btn) {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Enviando...';
    try {
      const appUrl = window.location.href.split('#')[0];
      const res = await API.post({ acao: 'enviarNotificacaoFatura', faturaId, appUrl });
      if (res.ok) {
        UI.toast(res.jaEnviado ? 'Já havia sido enviada.' : 'Notificação enviada.', 'success');
        btn.textContent = 'Enviado';
        btn.classList.add('enviado');
      } else {
        UI.toast(res.erro || 'Erro ao notificar.', 'error');
        btn.disabled = false;
        btn.textContent = original;
      }
    } catch (e) {
      UI.toast('Erro de conexão.', 'error');
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  // Alterna pago/em aberto. Marcar grava valorPago = total, entao a fatura
  // deixa de pesar no saldo — inclusive quando o total e negativo.
  async function _alternarPago(faturaId, estaPago) {
    try {
      const res = await API.post({
        acao: 'registrarPagamento', faturaId, desfazer: estaPago === true
      });
      if (res.ok) {
        UI.toast(estaPago ? 'Fatura reaberta.' : 'Fatura marcada como paga.', 'success');
        await renderHistorico();
      } else {
        UI.toast(res.erro || 'Não consegui alterar.', 'error');
      }
    } catch (e) {
      UI.toast('Erro de conexão.', 'error');
    }
  }

  async function _quitarAte() {
    const sugestao = '31/08/2026';
    const ate = window.prompt(
      'Quitar todas as faturas que vencem ATÉ esta data (DD/MM/AAAA).\n\n' +
      'As que vencem depois ficam em aberto.',
      sugestao);
    if (!ate) return;
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(ate.trim())) {
      return UI.toast('Use o formato DD/MM/AAAA.', 'error');
    }

    try {
      const res = await API.post({ acao: 'quitarAte', ate: ate.trim() });
      if (!res.ok) return UI.toast(res.erro || 'Erro ao quitar.', 'error');

      if (!res.quitadas.length) {
        UI.toast('Nenhuma fatura em aberto vencendo até ' + ate + '.', '');
      } else {
        UI.toast(`${res.quitadas.length} fatura(s) quitada(s).`, 'success');
      }
      await renderHistorico();
    } catch (e) {
      UI.toast('Erro de conexão.', 'error');
    }
  }

  function _confirmarExcluir(faturaId, rotulo) {
    if (window.confirm(`Excluir a fatura de ${rotulo}?\n\nEssa ação não pode ser desfeita.`)) {
      _excluir(faturaId);
    }
  }

  async function _excluir(faturaId) {
    try {
      const res = await API.post({ acao: 'excluirFatura', faturaId });
      if (res.ok) {
        UI.toast('Fatura excluída.', 'success');
        await renderHistorico();
      } else {
        UI.toast(res.erro || 'Erro ao excluir.', 'error');
      }
    } catch (e) {
      UI.toast('Erro de conexão.', 'error');
    }
  }

  return {
    init, renderHistorico,
    _selecionar, _cancelar, _publicar, _ver,
    _notificar, _confirmarExcluir, _definirDono,
    _alternarPago, _quitarAte
  };

})();

if (typeof window !== "undefined") window.Admin = Admin;
