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

  let faturasLidas = [];      // resultados do parser, uma por PDF
  let falhasLeitura = [];     // arquivos que nao deram para ler
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
          cartoesConhecidos[String(c.final)] = {
            dono: c.dono, apelido: c.apelido, titular: c.titular
          };
        });
      }
    } catch (e) {
      cartoesConhecidos = {};
    }
  }

  // ── Sugestão de dono para cartão novo ────────────────────
  //
  //  O banco escreve o mesmo nome de jeitos diferentes conforme o
  //  produto: "GETLIO R D S FARIAS" na Infinite e "GETULIO FARIAS"
  //  na Æternum. Comparar string crua não serve; comparamos palavra
  //  a palavra, aceitando uma letra de diferença.
  //
  //  Isto só SUGERE — quem decide é você. Um cartão novo continua
  //  travando a publicação até ser confirmado.

  function normalizarNome(s) {
    return String(s || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase().replace(/[^A-Z ]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  function palavras(s) {
    return normalizarNome(s).split(' ').filter(p => p.length >= 3);
  }

  function distancia(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    let linha = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
      let ant = linha[0];
      linha[0] = i;
      for (let j = 1; j <= n; j++) {
        const tmp = linha[j];
        linha[j] = Math.min(
          linha[j] + 1,
          linha[j - 1] + 1,
          ant + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
        ant = tmp;
      }
    }
    return linha[n];
  }

  function sugerirDono(titular) {
    const alvo = palavras(titular);
    if (!alvo.length) return null;

    let melhor = null;
    Object.keys(cartoesConhecidos).forEach(final => {
      const info = cartoesConhecidos[final];
      if (!info.titular) return;
      const ref = palavras(info.titular);
      let pontos = 0;
      alvo.forEach(a => ref.forEach(b => {
        if (a === b) pontos += 2;
        else if (Math.abs(a.length - b.length) <= 1 && distancia(a, b) <= 1) pontos += 1;
      }));
      if (pontos >= 2 && (!melhor || pontos > melhor.pontos)) {
        melhor = { dono: info.dono, pontos, titular: info.titular, final };
      }
    });
    return melhor;
  }

  // ── Upload ───────────────────────────────────────────────
  //  Aceita varias faturas de uma vez. Todo mes sao pelo menos duas
  //  (Infinite e Aeternum), e uma tela que so mostrava a ultima fazia
  //  parecer que as anteriores tinham sumido.
  function renderUpload() {
    const container = document.getElementById('admin-upload');
    container.innerHTML = `
      <div class="card">
        <p class="card-title">📤 Novas faturas</p>
        <div class="upload-zone" id="upload-zone"
             onclick="document.getElementById('file-input').click()">
          <div class="upload-icon">📄</div>
          <div class="upload-title">Clique para selecionar as faturas</div>
          <div class="upload-sub">PDF do Bradesco — pode escolher várias de uma vez</div>
        </div>
        <input type="file" id="file-input" accept="application/pdf,.pdf" multiple
               style="display:none" onchange="Admin._selecionar(event)">
        <div class="progress-bar" id="progress-bar" style="display:none">
          <div class="progress-fill" id="progress-fill" style="width:0%"></div>
        </div>
        <div id="progresso-texto" class="progresso-texto" style="display:none"></div>
        <div id="preview-section" style="display:none"></div>
      </div>
    `;

    const zone = document.getElementById('upload-zone');
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      processar(Array.from(e.dataTransfer.files || []));
    });
  }

  function _selecionar(event) {
    processar(Array.from(event.target.files || []));
  }

  async function processar(arquivos) {
    if (!arquivos.length) return;

    const barra = document.getElementById('progress-bar');
    const fill  = document.getElementById('progress-fill');
    const texto = document.getElementById('progresso-texto');
    const prev  = document.getElementById('preview-section');

    barra.style.display = 'block';
    texto.style.display = 'block';
    prev.style.display = 'none';

    const lidas = [];
    const falhas = [];

    for (let i = 0; i < arquivos.length; i++) {
      const arq = arquivos[i];
      texto.textContent = `Lendo ${i + 1} de ${arquivos.length}: ${arq.name}`;
      fill.style.width = Math.round(((i + 0.5) / arquivos.length) * 100) + '%';
      try {
        lidas.push(await ParserBradesco.processar(arq));
      } catch (err) {
        falhas.push({ arquivo: arq.name, erro: err.message });
        console.error(arq.name, err);
      }
    }

    fill.style.width = '100%';
    // ordem cronologica, para revisar na sequencia em que venceram
    lidas.sort((a, b) => (Fmt.paraDate(a.vencimento) || 0) - (Fmt.paraDate(b.vencimento) || 0));

    faturasLidas = lidas;
    falhasLeitura = falhas;

    setTimeout(() => {
      barra.style.display = 'none';
      texto.style.display = 'none';
      if (!lidas.length) {
        UI.toast(falhas[0] ? falhas[0].erro : 'Nenhuma fatura foi lida.', 'error');
        return;
      }
      renderPreview();
      prev.style.display = 'block';
    }, 250);
  }

  // ── Preview: uma seção por fatura lida ───────────────────
  function renderPreview() {
    const prev = document.getElementById('preview-section');

    const desconhecidos = cartoesSemDono();
    const comProblema = faturasLidas.filter(r => !r.ok);
    const publicaveis = faturasLidas.filter(r => r.ok);
    const podePublicar = publicaveis.length > 0 && desconhecidos.length === 0;

    const totalGeral = publicaveis.reduce((s, r) => s + totalDoPrimo(r), 0);

    prev.innerHTML = `
      <hr class="divider">

      ${renderResumoLote()}
      ${falhasLeitura.length ? renderFalhas() : ''}
      ${desconhecidos.length ? renderCartoesDesconhecidos(desconhecidos) : ''}

      ${faturasLidas.map((r, i) => renderFatura(r, i)).join('')}

      ${publicaveis.length > 1 ? `
        <div class="total-box">
          <span class="total-label">
            Total do ${Fmt.txt(NEGAPAY_CONFIG.primo.nome)} nas ${publicaveis.length} faturas
          </span>
          <span class="total-valor">${Fmt.moeda(totalGeral)}</span>
        </div>` : ''}

      <div class="acoes-preview">
        <button class="btn btn-secondary" onclick="Admin._cancelar()">Cancelar</button>
        <button class="btn btn-primary" id="btn-publicar"
                onclick="Admin._publicar()" ${podePublicar ? '' : 'disabled'}>
          ${desconhecidos.length ? 'Defina os cartões acima'
            : !publicaveis.length ? 'Conferência falhou'
            : publicaveis.length === 1 ? 'Publicar fatura'
            : `Publicar ${publicaveis.length} faturas`}
        </button>
      </div>
    `;
  }

  function totalDoPrimo(r) {
    return r.cartoes
      .filter(c => (cartoesConhecidos[String(c.final)] || {}).dono === 'primo')
      .reduce((s, c) => s + c.subtotal, 0);
  }

  // Cartoes sem dono, juntando todas as faturas do lote (sem repetir)
  function cartoesSemDono() {
    const vistos = {};
    faturasLidas.forEach(r => r.cartoes.forEach(c => {
      const f = String(c.final);
      if (cartoesConhecidos[f] || vistos[f]) return;
      vistos[f] = c;
    }));
    return Object.keys(vistos).map(f => vistos[f]);
  }

  function renderResumoLote() {
    const ok = faturasLidas.filter(r => r.ok).length;
    const ruins = faturasLidas.length - ok;

    // Uma fatura só: mantém a confirmação explícita de que a conta fechou.
    // É ela que dá segurança para publicar sem conferir à mão.
    if (faturasLidas.length === 1) {
      const r = faturasLidas[0];
      if (!r.ok) return '';   // o detalhe do erro aparece dentro da fatura
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

    return `
      <div class="conferencia ${ruins ? 'conferencia-aviso' : 'conferencia-ok'}">
        <div class="conferencia-titulo">
          ${ruins ? '⚠' : '✓'} ${faturasLidas.length} faturas lidas${ruins ? ` — ${ruins} com problema` : ' — todas conferem'}
        </div>
        <div class="conferencia-texto">
          ${ruins
            ? 'As que conferem podem ser publicadas; as com problema ficam de fora.'
            : 'A soma dos lançamentos fecha com o valor declarado pelo banco em todas.'}
        </div>
      </div>`;
  }

  function renderFalhas() {
    return `
      <div class="conferencia conferencia-erro">
        <div class="conferencia-titulo">⚠ Não consegui ler ${falhasLeitura.length} arquivo(s)</div>
        <ul class="conferencia-lista">
          ${falhasLeitura.map(f => `<li><strong>${Fmt.txt(f.arquivo)}</strong>: ${Fmt.txt(f.erro)}</li>`).join('')}
        </ul>
      </div>`;
  }

  // Uma fatura do lote, recolhida por padrao quando sao varias
  function renderFatura(r, indice) {
    const produto = NEGAPAY_CONFIG.produtoPorCapa(r.cartaoCapa);
    const nomeProduto = produto ? produto.nome : `Cartão final ${r.cartaoCapa}`;
    const totalPrimo = totalDoPrimo(r);
    const varias = faturasLidas.length > 1;

    return `
      <div class="fatura-lote ${r.ok ? '' : 'fatura-lote-erro'}">
        <div class="fatura-lote-topo" onclick="Admin._alternarDetalhe(${indice})">
          <div class="fatura-lote-id">
            <span class="fatura-lote-status">${r.ok ? '✓' : '⚠'}</span>
            <div>
              <div class="fatura-produto">${Fmt.txt(nomeProduto)}</div>
              <div class="fatura-meta">
                Vence ${Fmt.txt(r.vencimento)} · ${Fmt.txt(Fmt.mesAnoLongo(r.mesAno))}
              </div>
            </div>
          </div>
          <div class="fatura-lote-valor">
            <div class="total-valor">${Fmt.moeda(totalPrimo)}</div>
            <div class="fatura-lote-abrir">${varias ? 'ver lançamentos' : ''}</div>
          </div>
        </div>

        ${r.ok ? '' : renderConferencia(r)}

        <div id="lote-detalhe-${indice}" class="fatura-lote-detalhe"
             style="display:${varias ? 'none' : 'block'}">
          ${r.cartoes.map(c => renderCartao(c)).join('')}
        </div>
      </div>`;
  }

  function _alternarDetalhe(indice) {
    const el = document.getElementById('lote-detalhe-' + indice);
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
  }

  // Detalhe do que nao fechou numa fatura
  function renderConferencia(r) {
    const linhas = [];
    r.divergentes.forEach(c => {
      linhas.push(`final ${Fmt.txt(c.final)}: somei ${Fmt.moeda(c.subtotal)},
                   o banco declarou ${Fmt.moeda(c.declarado)}
                   (diferença de ${Fmt.moeda(c.diferenca)})`);
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
        <div class="conferencia-titulo">A conta não fechou — esta fatura não será publicada</div>
        <ul class="conferencia-lista">${linhas.map(l => `<li>${l}</li>`).join('')}</ul>
        <div class="conferencia-texto">
          Quase sempre é um PDF num formato que o parser ainda não conhece.
          Me mande este arquivo em vez de publicar um valor errado.
        </div>
      </div>`;
  }

  function renderCartoesDesconhecidos(lista) {
    return `
      <div class="conferencia conferencia-aviso">
        <div class="conferencia-titulo">${
          (lista.length > 1 ? 'Cartões novos' : 'Cartão novo') + ' ' +
          (faturasLidas.length > 1 ? 'nestas faturas' : 'nesta fatura')
        }</div>
        <div class="conferencia-texto">
          De quem é? Enquanto não disser, não publico — foi assim que o
          cartão da Æternum virou R$ 0,00 sem ninguém perceber.
        </div>
        ${lista.map(c => {
          const s = sugerirDono(c.titular);
          return `
          <div class="cartao-novo">
            <div>
              <div class="cartao-novo-final">•••• ${Fmt.txt(c.final)}</div>
              <div class="cartao-novo-titular">${Fmt.txt(c.titular)}</div>
              ${s ? `<div class="cartao-novo-sugestao">
                       Parece ser do mesmo titular do cartão ••••${Fmt.txt(s.final)}
                       (${Fmt.txt(s.titular)})
                     </div>` : ''}
            </div>
            <div class="cartao-novo-botoes">
              <button class="btn-mini ${s && s.dono === 'admin' ? 'btn-sugerido' : ''}"
                      onclick="Admin._definirDono('${Fmt.txt(c.final)}', 'admin', this)">Meu</button>
              <button class="btn-mini btn-mini-primo ${s && s.dono === 'primo' ? 'btn-sugerido' : ''}"
                      onclick="Admin._definirDono('${Fmt.txt(c.final)}', 'primo', this)">${Fmt.txt(NEGAPAY_CONFIG.primo.nome)}</button>
            </div>
          </div>`;
        }).join('')}
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
            <div class="lancamento-valor ${l.tipo}">${Fmt.moeda(l.valor)}</div>
          </div>
        `).join('') : `
          <div class="cartao-resumido">${c.lancamentos.length} lançamentos (não é do ${Fmt.txt(NEGAPAY_CONFIG.primo.nome)})</div>
        `}
      </div>`;
  }

  async function _definirDono(final, dono, botao) {
    let cartao = null;
    faturasLidas.forEach(r => {
      const achado = r.cartoes.find(c => String(c.final) === String(final));
      if (achado && !cartao) cartao = achado;
    });

    botao.disabled = true;
    try {
      const res = await API.post({
        acao: 'definirDonoCartao', final, dono,
        titular: cartao ? cartao.titular : ''
      });
      if (res.ok) {
        cartoesConhecidos[String(final)] = {
          dono, apelido: '', titular: cartao ? cartao.titular : ''
        };
        UI.toast(`Cartão ${final} salvo como ${dono === 'primo' ? NEGAPAY_CONFIG.primo.nome : 'seu'}.`, 'success');
        renderPreview();
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
    faturasLidas = [];
    falhasLeitura = [];
  }

  // Publica em lote. Cada fatura vai numa chamada — o Apps Script tem
  // limite de tempo por requisicao e uma fatura pode ter 380 lancamentos.
  // Uma que falhe nao impede as outras.
  async function _publicar() {
    const publicaveis = faturasLidas.filter(r => r.ok);
    if (!publicaveis.length) return;

    const btn = document.getElementById('btn-publicar');
    btn.disabled = true;

    const oks = [];
    const erros = [];

    for (let i = 0; i < publicaveis.length; i++) {
      const r = publicaveis[i];
      const produto = NEGAPAY_CONFIG.produtoPorCapa(r.cartaoCapa);
      const nomeProduto = produto ? produto.nome : `Final ${r.cartaoCapa}`;
      btn.innerHTML = `<span class="spinner"></span> Publicando ${i + 1} de ${publicaveis.length}...`;

      try {
        const res = await API.post({
          acao: 'salvarFatura',
          fatura: {
            mesAno: r.mesAno,
            produto: nomeProduto,
            bancoId: 'bradesco',
            vencimento: r.vencimento,
            totalFaturaCentavos: r.totalFatura,
            arquivo: r.arquivo,
            cartoes: r.cartoes.map(c => ({
              final: c.final, titular: c.titular, subtotal: c.subtotal,
              declarado: c.declarado, confere: c.confere,
              lancamentos: c.lancamentos.map(l => ({
                data: ParserBradesco.formatarDataLancamento(l),
                descricao: l.descricao, parcela: l.parcela, valor: l.valor
              }))
            }))
          }
        });
        if (res.ok) oks.push({ nome: nomeProduto, mes: r.mesAno, total: res.totalPrimoCentavos });
        else erros.push({ nome: nomeProduto, mes: r.mesAno, erro: res.erro });
      } catch (e) {
        erros.push({ nome: nomeProduto, mes: r.mesAno, erro: 'falha de conexão' });
      }
    }

    if (oks.length) {
      const soma = oks.reduce((s, o) => s + o.total, 0);
      UI.toast(oks.length === 1
        ? `Fatura publicada — ${Fmt.moeda(soma)} para o ${NEGAPAY_CONFIG.primo.nome}.`
        : `${oks.length} faturas publicadas — ${Fmt.moeda(soma)} no total.`, 'success');
    }
    if (erros.length) {
      UI.toast(`${erros.length} não publicada(s): ` +
               erros.map(e => `${e.nome} ${e.mes} (${e.erro})`).join('; '), 'error');
    }

    if (!erros.length) {
      _cancelar();
    } else {
      // mantem na tela so as que falharam, para tentar de novo
      const falhou = new Set(erros.map(e => e.mes + '|' + e.nome));
      faturasLidas = publicaveis.filter(r => {
        const p = NEGAPAY_CONFIG.produtoPorCapa(r.cartaoCapa);
        return falhou.has(r.mesAno + '|' + (p ? p.nome : `Final ${r.cartaoCapa}`));
      });
      renderPreview();
    }
    await renderHistorico();
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
    _alternarPago, _quitarAte, _alternarDetalhe,
    _sugerirDono: sugerirDono
  };

})();

if (typeof window !== "undefined") window.Admin = Admin;
