// ============================================================
//  NegaPay — Backend Apps Script v2.0
//
//  Mudancas em relacao a v1, todas motivadas por erro de valor:
//
//  1. Dinheiro e guardado em CENTAVOS (inteiro). Float erra
//     centavo em soma longa e aqui a conta precisa fechar exata.
//  2. Uma fatura e identificada por mesAno + produto. Antes, salvar
//     apagava TODA linha do mesmo mes — com duas faturas no mesmo
//     mes, a segunda apagava a primeira.
//  3. O vencimento vem lido do PDF, nao e mais calculado.
//  4. Guarda o total declarado pelo banco e se a conferencia bateu.
//     Fatura que nao confere nao pode ser publicada.
//  5. A dona de cada cartao fica na aba "cartoes", aprendida na
//     primeira vez. Cartao novo nunca e ignorado em silencio.
//
//  As abas v2 sao novas. As antigas (faturas, lancamentos) ficam
//  intactas para conferencia e podem ser apagadas depois.
// ============================================================

const SHEET_ID = '1qHp4OOiOYxz-JYEZF3gmXfUW3cVAiODD2nNy2fZM1jA';
const EMAIL_PRIMO = 'getulio.farias@outlook.com';
const EMAIL_ADMIN = 'victor-pinho@hotmail.com';

const ABA_USUARIOS    = 'usuarios';
const ABA_FATURAS     = 'faturas_v2';
const ABA_LANCAMENTOS = 'lancamentos_v2';
const ABA_CARTOES     = 'cartoes';

const COLS_FATURAS = [
  'faturaId', 'mesAno', 'produto', 'bancoId', 'vencimento',
  'totalPrimoCentavos', 'totalFaturaCentavos', 'conferido',
  'pago', 'valorPagoCentavos', 'dataPagamento',
  'criadoEm', 'notificadoEm', 'notificadoPara', 'arquivo'
];
const COLS_LANCAMENTOS = [
  'id', 'faturaId', 'cartaoFinal', 'data', 'descricao',
  'parcela', 'valorCentavos', 'tipo'
];
const COLS_CARTOES = ['final', 'titular', 'dono', 'apelido', 'atualizadoEm'];

// ─────────────────────────────────────────
//  ROTEADOR
// ─────────────────────────────────────────
function doGet(e) {
  try {
    const payload = e.parameter.payload;
    if (!payload) {
      return resposta({ ok: true, servico: 'NegaPay API', versao: '2.0' });
    }

    // No GET o próprio Apps Script já decodifica o parâmetro; no POST o
    // corpo chega cru. E uma descrição de lançamento pode conter "%",
    // que faria decodeURIComponent estourar num JSON já decodificado.
    let body;
    try {
      body = JSON.parse(payload);
    } catch (e) {
      body = JSON.parse(decodeURIComponent(payload));
    }
    const acao = body.acao;
    let resultado;

    switch (acao) {
      case 'login':                   resultado = login(body); break;
      case 'validarToken':            resultado = validarToken(body); break;
      case 'logout':                  resultado = logout(body); break;
      case 'listarCartoes':           resultado = listarCartoes(body); break;
      case 'definirDonoCartao':       resultado = definirDonoCartao(body); break;
      case 'salvarFatura':            resultado = salvarFatura(body); break;
      case 'listarFaturas':           resultado = listarFaturas(body); break;
      case 'getFatura':               resultado = getFatura(body); break;
      case 'getResumo':               resultado = getResumo(body); break;
      case 'registrarPagamento':      resultado = registrarPagamento(body); break;
      case 'quitarAte':               resultado = quitarAte(body); break;
      case 'excluirFatura':           resultado = excluirFatura(body); break;
      case 'enviarNotificacaoFatura': resultado = enviarNotificacaoFatura(body); break;
      default:                        resultado = { ok: false, erro: 'Ação desconhecida: ' + acao };
    }

    return resposta(resultado);

  } catch (err) {
    return resposta({ ok: false, erro: err.message });
  }
}

function doPost(e) {
  return doGet({ parameter: { payload: encodeURIComponent(e.postData.contents) } });
}

// ─────────────────────────────────────────
//  AUTENTICACAO
// ─────────────────────────────────────────
function login(body) {
  const { usuario, senha } = body;
  if (!usuario || !senha) return { ok: false, erro: 'Campos obrigatórios ausentes' };

  const sheet = getAba(ABA_USUARIOS);
  const dados = sheet.getDataRange().getValues();

  for (let i = 1; i < dados.length; i++) {
    const [u, s, perfil, ativo] = dados[i];
    if (u === usuario && s === hashSenha(senha) && ativo === true) {
      const token  = gerarToken();
      const expira = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      sheet.getRange(i + 1, 5).setValue(token);
      sheet.getRange(i + 1, 6).setValue(expira.toISOString());

      return { ok: true, token, perfil, nome: usuario, expira: expira.toISOString() };
    }
  }

  return { ok: false, erro: 'Usuário ou senha incorretos' };
}

function validarToken(body) {
  const { token } = body;
  if (!token) return { ok: false, erro: 'Token ausente' };

  const sheet = getAba(ABA_USUARIOS);
  const dados = sheet.getDataRange().getValues();

  for (let i = 1; i < dados.length; i++) {
    const [usuario, , perfil, ativo, tkn, expira] = dados[i];
    if (tkn === token && ativo === true) {
      if (new Date() < new Date(expira)) {
        return { ok: true, perfil, nome: usuario };
      }
      return { ok: false, erro: 'Token expirado' };
    }
  }

  return { ok: false, erro: 'Token inválido' };
}

// Invalida o token no servidor. Antes o logout so apagava o
// localStorage — o token continuava valido para sempre.
function logout(body) {
  const { token } = body;
  if (!token) return { ok: true };

  const sheet = getAba(ABA_USUARIOS);
  const dados = sheet.getDataRange().getValues();
  for (let i = 1; i < dados.length; i++) {
    if (dados[i][4] === token) {
      sheet.getRange(i + 1, 5).setValue('');
      sheet.getRange(i + 1, 6).setValue('');
      break;
    }
  }
  return { ok: true };
}

function exigirAdmin(body) {
  const auth = validarToken(body);
  if (!auth.ok) return auth;
  if (auth.perfil !== 'admin') return { ok: false, erro: 'Sem permissão' };
  return auth;
}

// ─────────────────────────────────────────
//  CARTOES — de quem e cada cartao
// ─────────────────────────────────────────
function listarCartoes(body) {
  const auth = validarToken(body);
  if (!auth.ok) return auth;

  const sheet = getAba(ABA_CARTOES);
  const dados = sheet.getDataRange().getValues();
  const cartoes = [];
  for (let i = 1; i < dados.length; i++) {
    const [final, titular, dono, apelido, atualizadoEm] = dados[i];
    if (!final) continue;
    cartoes.push({
      final: String(final),
      titular, dono, apelido,
      atualizadoEm: paraTexto(atualizadoEm)
    });
  }
  return { ok: true, cartoes };
}

function definirDonoCartao(body) {
  const auth = exigirAdmin(body);
  if (!auth.ok) return auth;

  const { final, titular, dono, apelido } = body;
  if (!final || !dono) return { ok: false, erro: 'Cartão e dono são obrigatórios' };
  if (dono !== 'admin' && dono !== 'primo') {
    return { ok: false, erro: 'Dono deve ser admin ou primo' };
  }

  const sheet = getAba(ABA_CARTOES);
  const dados = sheet.getDataRange().getValues();
  const agora = new Date().toISOString();

  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][0]) === String(final)) {
      sheet.getRange(i + 1, 1, 1, COLS_CARTOES.length)
           .setValues([[String(final), titular || dados[i][1], dono,
                        apelido || dados[i][3] || '', agora]]);
      return { ok: true, atualizado: true };
    }
  }

  sheet.appendRow([String(final), titular || '', dono, apelido || '', agora]);
  return { ok: true, criado: true };
}

function mapaDeCartoes() {
  const sheet = getAba(ABA_CARTOES);
  const dados = sheet.getDataRange().getValues();
  const mapa = {};
  for (let i = 1; i < dados.length; i++) {
    if (!dados[i][0]) continue;
    mapa[String(dados[i][0])] = { dono: dados[i][2], apelido: dados[i][3] || '' };
  }
  return mapa;
}

// ─────────────────────────────────────────
//  FATURAS
// ─────────────────────────────────────────
function salvarFatura(body) {
  const auth = exigirAdmin(body);
  if (!auth.ok) return auth;

  const { fatura } = body;
  if (!fatura) return { ok: false, erro: 'Fatura ausente' };

  const { mesAno, produto, bancoId, vencimento, cartoes, totalFaturaCentavos, arquivo } = fatura;

  if (!mesAno || !produto) {
    return { ok: false, erro: 'Fatura precisa de mês de referência e produto' };
  }
  if (!vencimento) {
    return { ok: false, erro: 'Vencimento não foi lido do PDF — não publico sem ele' };
  }
  if (!Array.isArray(cartoes) || !cartoes.length) {
    return { ok: false, erro: 'Fatura sem cartões' };
  }

  // Nao publica fatura cuja conta nao fecha com o que o banco declarou.
  const naoConfere = cartoes.filter(c => c.confere !== true);
  if (naoConfere.length) {
    return {
      ok: false,
      erro: 'A soma dos lançamentos não bate com o valor declarado pelo banco em: ' +
            naoConfere.map(c => 'final ' + c.final).join(', ') +
            '. Nada foi publicado.'
    };
  }

  const mapa = mapaDeCartoes();
  const semDono = cartoes.filter(c => !mapa[String(c.final)]);
  if (semDono.length) {
    return {
      ok: false,
      erro: 'Cartão sem dono definido: ' + semDono.map(c => c.final).join(', '),
      cartoesSemDono: semDono.map(c => ({ final: c.final, titular: c.titular,
                                          subtotalCentavos: c.subtotal }))
    };
  }

  const sheetFaturas = getAba(ABA_FATURAS);
  const sheetLanc    = getAba(ABA_LANCAMENTOS);

  const totalPrimo = cartoes
    .filter(c => mapa[String(c.final)].dono === 'primo')
    .reduce((s, c) => s + Math.round(c.subtotal), 0);

  // Substitui apenas a fatura do MESMO mes E MESMO produto.
  const dados = sheetFaturas.getDataRange().getValues();
  let notificadoEm = '', notificadoPara = '', pago = false, valorPago = 0, dataPagamento = '';
  for (let i = dados.length - 1; i >= 1; i--) {
    if (String(dados[i][1]) === String(mesAno) && String(dados[i][2]) === String(produto)) {
      // preserva o que ja aconteceu com essa fatura
      pago           = dados[i][8] === true;
      valorPago      = Number(dados[i][9]) || 0;
      dataPagamento  = paraTexto(dados[i][10]);
      notificadoEm   = paraTexto(dados[i][12]);
      notificadoPara = paraTexto(dados[i][13]);
      const idAntigo = dados[i][0];
      sheetFaturas.deleteRow(i + 1);
      apagarLancamentos(sheetLanc, idAntigo);
    }
  }

  const faturaId = 'FAT_' + String(mesAno).replace('/', '_') + '_' +
                   String(produto).replace(/[^A-Za-z0-9]/g, '') + '_' + Date.now();

  const linha = sheetFaturas.getLastRow() + 1;
  // vencimento e mesAno como texto, senao o Sheets converte em Date
  // e devolve dia/mes trocados conforme o locale.
  sheetFaturas.getRange(linha, 2, 1, 1).setNumberFormat('@');
  sheetFaturas.getRange(linha, 5, 1, 1).setNumberFormat('@');
  sheetFaturas.getRange(linha, 1, 1, COLS_FATURAS.length).setValues([[
    faturaId, String(mesAno), String(produto), bancoId || 'bradesco',
    String(vencimento), totalPrimo, Math.round(totalFaturaCentavos || 0), true,
    pago, valorPago, dataPagamento,
    new Date().toISOString(), notificadoEm, notificadoPara, arquivo || ''
  ]]);

  const novas = [];
  cartoes.forEach(cartao => {
    (cartao.lancamentos || []).forEach((l, idx) => {
      novas.push([
        'LNC_' + Date.now() + '_' + idx + '_' + Math.random().toString(36).substr(2, 4),
        faturaId, String(cartao.final), l.data || '', l.descricao || '',
        l.parcela || '', Math.round(l.valor), l.valor < 0 ? 'estorno' : 'compra'
      ]);
    });
  });
  // Uma escrita so. Antes era um appendRow por lancamento — 377
  // chamadas numa fatura desta, o que estourava o tempo do Apps Script.
  if (novas.length) {
    sheetLanc.getRange(sheetLanc.getLastRow() + 1, 1, novas.length, COLS_LANCAMENTOS.length)
             .setValues(novas);
  }

  return { ok: true, faturaId, totalPrimoCentavos: totalPrimo, lancamentos: novas.length };
}

function apagarLancamentos(sheetLanc, faturaId) {
  const dados = sheetLanc.getDataRange().getValues();
  for (let i = dados.length - 1; i >= 1; i--) {
    if (dados[i][1] === faturaId) sheetLanc.deleteRow(i + 1);
  }
}

function listarFaturas(body) {
  const auth = validarToken(body);
  if (!auth.ok) return auth;

  const sheet = getAba(ABA_FATURAS);
  const dados = sheet.getDataRange().getValues();
  const faturas = [];

  for (let i = 1; i < dados.length; i++) {
    const f = linhaParaFatura(dados[i]);
    if (f) faturas.push(f);
  }

  faturas.sort(ordenarPorVencimentoDesc);
  return { ok: true, faturas };
}

function linhaParaFatura(linha) {
  if (!linha[0]) return null;
  return {
    faturaId:            linha[0],
    mesAno:              paraTexto(linha[1]),
    produto:             linha[2],
    bancoId:             linha[3],
    vencimento:          paraTexto(linha[4]),
    totalPrimoCentavos:  Number(linha[5]) || 0,
    totalFaturaCentavos: Number(linha[6]) || 0,
    conferido:           linha[7] === true,
    pago:                linha[8] === true,
    valorPagoCentavos:   Number(linha[9]) || 0,
    dataPagamento:       paraTexto(linha[10]),
    criadoEm:            paraTexto(linha[11]),
    notificadoEm:        paraTexto(linha[12]),
    notificadoPara:      paraTexto(linha[13]),
    arquivo:             linha[14] || ''
  };
}

function ordenarPorVencimentoDesc(a, b) {
  return chaveVencimento(b) - chaveVencimento(a);
}

function chaveVencimento(f) {
  const m = String(f.vencimento || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
  const c = String(f.mesAno || '').match(/^(\d{2})\/(\d{4})$/);
  if (c) return new Date(Number(c[2]), Number(c[1]) - 1, 1).getTime();
  return 0;
}

function getFatura(body) {
  const auth = validarToken(body);
  if (!auth.ok) return auth;

  const { faturaId } = body;
  const dados = getAba(ABA_FATURAS).getDataRange().getValues();
  let fatura = null;
  for (let i = 1; i < dados.length; i++) {
    if (dados[i][0] === faturaId) { fatura = linhaParaFatura(dados[i]); break; }
  }
  if (!fatura) return { ok: false, erro: 'Fatura não encontrada' };

  const mapa = mapaDeCartoes();
  const lancDados = getAba(ABA_LANCAMENTOS).getDataRange().getValues();
  const porCartao = {};

  for (let i = 1; i < lancDados.length; i++) {
    const [id, fId, final, data, descricao, parcela, valor, tipo] = lancDados[i];
    if (fId !== faturaId) continue;
    const chave = String(final);
    if (!porCartao[chave]) {
      porCartao[chave] = {
        final: chave,
        dono: (mapa[chave] || {}).dono || 'desconhecido',
        apelido: (mapa[chave] || {}).apelido || '',
        lancamentos: [],
        subtotalCentavos: 0
      };
    }
    porCartao[chave].lancamentos.push({
      id, data: paraTexto(data), descricao, parcela: parcela || null,
      valorCentavos: Number(valor) || 0, tipo
    });
    porCartao[chave].subtotalCentavos += Number(valor) || 0;
  }

  fatura.cartoes = Object.keys(porCartao).map(k => porCartao[k]);
  return { ok: true, fatura };
}

// ─────────────────────────────────────────
//  RESUMO — quanto o primo deve, com saldo acumulado
// ─────────────────────────────────────────
function getResumo(body) {
  const auth = validarToken(body);
  if (!auth.ok) return auth;

  const lista = listarFaturas(body);
  if (!lista.ok) return lista;

  // agrupa por mes de competencia
  const porMes = {};
  lista.faturas.forEach(f => {
    if (!porMes[f.mesAno]) {
      porMes[f.mesAno] = { mesAno: f.mesAno, faturas: [], totalCentavos: 0,
                           pagoCentavos: 0, vencimento: f.vencimento };
    }
    const m = porMes[f.mesAno];
    m.faturas.push(f);
    m.totalCentavos += f.totalPrimoCentavos;
    m.pagoCentavos  += f.valorPagoCentavos;
    // o vencimento do mes e o mais proximo entre as faturas
    if (chaveVencimento(f) && chaveVencimento({ vencimento: m.vencimento }) &&
        chaveVencimento(f) < chaveVencimento({ vencimento: m.vencimento })) {
      m.vencimento = f.vencimento;
    }
  });

  const meses = Object.keys(porMes).map(k => porMes[k]);
  // ordem cronologica crescente para acumular o saldo
  meses.sort((a, b) => chaveCompetencia(a.mesAno) - chaveCompetencia(b.mesAno));

  let saldo = 0;
  meses.forEach(m => {
    saldo += m.totalCentavos - m.pagoCentavos;
    m.saldoAcumuladoCentavos = saldo;
  });

  const atual = meses.length ? meses[meses.length - 1] : null;

  return {
    ok: true,
    saldoAtualCentavos: saldo,
    mesAtual: atual,
    meses: meses.slice().reverse()
  };
}

function chaveCompetencia(mesAno) {
  const m = String(mesAno || '').match(/^(\d{1,2})\/(\d{4})$/);
  return m ? Number(m[2]) * 12 + Number(m[1]) : 0;
}

// Marca ou desmarca uma fatura como paga.
// Marcar grava valorPago = total da fatura, entao a contribuicao dela no
// saldo (total - pago) vira zero — inclusive quando o total e negativo.
// E assim que um mes de credito ja acertado por fora sai da conta.
function registrarPagamento(body) {
  const auth = validarToken(body);
  if (!auth.ok) return auth;

  const { faturaId, valorCentavos, desfazer } = body;
  const sheet = getAba(ABA_FATURAS);
  const dados = sheet.getDataRange().getValues();

  for (let i = 1; i < dados.length; i++) {
    if (dados[i][0] !== faturaId) continue;

    if (desfazer) {
      if (auth.perfil !== 'admin') return { ok: false, erro: 'Só o admin pode desfazer' };
      sheet.getRange(i + 1, 9).setValue(false);
      sheet.getRange(i + 1, 10).setValue(0);
      sheet.getRange(i + 1, 11).setValue('');
      return { ok: true, desfeito: true };
    }

    const total = Number(dados[i][5]) || 0;
    const valor = (valorCentavos === undefined || valorCentavos === null)
      ? total : Math.round(Number(valorCentavos));
    sheet.getRange(i + 1, 9).setValue(true);
    sheet.getRange(i + 1, 10).setValue(valor);
    sheet.getRange(i + 1, 11).setValue(new Date().toISOString());
    return { ok: true, valorPagoCentavos: valor };
  }
  return { ok: false, erro: 'Fatura não encontrada' };
}

// Quita de uma vez tudo que vence ATE a data informada (DD/MM/AAAA).
// Serve para o acerto historico: sobe os meses antigos, quita todos, e o
// saldo passa a contar so do periodo seguinte.
function quitarAte(body) {
  const auth = exigirAdmin(body);
  if (!auth.ok) return auth;

  const limite = chaveVencimento({ vencimento: String(body.ate || '') });
  if (!limite) return { ok: false, erro: 'Informe a data limite como DD/MM/AAAA' };

  const sheet = getAba(ABA_FATURAS);
  const dados = sheet.getDataRange().getValues();
  const agora = new Date().toISOString();
  const quitadas = [];

  for (let i = 1; i < dados.length; i++) {
    const f = linhaParaFatura(dados[i]);
    if (!f || f.pago) continue;
    if (chaveVencimento(f) > limite) continue;

    sheet.getRange(i + 1, 9).setValue(true);
    sheet.getRange(i + 1, 10).setValue(f.totalPrimoCentavos);
    sheet.getRange(i + 1, 11).setValue(agora);
    quitadas.push({ faturaId: f.faturaId, mesAno: f.mesAno, produto: f.produto,
                    totalPrimoCentavos: f.totalPrimoCentavos });
  }

  return { ok: true, quitadas };
}

function excluirFatura(body) {
  const auth = exigirAdmin(body);
  if (!auth.ok) return auth;

  const { faturaId } = body;
  const sheetFaturas = getAba(ABA_FATURAS);
  const dados = sheetFaturas.getDataRange().getValues();
  let achou = false;
  for (let i = dados.length - 1; i >= 1; i--) {
    if (dados[i][0] === faturaId) { sheetFaturas.deleteRow(i + 1); achou = true; }
  }
  if (!achou) return { ok: false, erro: 'Fatura não encontrada' };

  apagarLancamentos(getAba(ABA_LANCAMENTOS), faturaId);
  return { ok: true };
}

// ─────────────────────────────────────────
//  NOTIFICACAO POR EMAIL
// ─────────────────────────────────────────
function enviarNotificacaoFatura(body) {
  const auth = exigirAdmin(body);
  if (!auth.ok) return auth;

  const sheetFaturas = getAba(ABA_FATURAS);
  const dados = sheetFaturas.getDataRange().getValues();
  let linha = -1, fatura = null;
  for (let i = 1; i < dados.length; i++) {
    if (dados[i][0] === body.faturaId) { linha = i + 1; fatura = linhaParaFatura(dados[i]); break; }
  }
  if (!fatura) return { ok: false, erro: 'Fatura não encontrada' };
  if (fatura.notificadoEm) {
    return { ok: true, jaEnviado: true, notificadoEm: fatura.notificadoEm };
  }

  const resumo = getResumo(body);
  const saldo = resumo.ok ? resumo.saldoAtualCentavos : fatura.totalPrimoCentavos;

  const mesAno     = formatarMesAnoEmail(fatura.mesAno);
  const valor      = formatarMoedaCentavos(fatura.totalPrimoCentavos);
  const saldoTexto = formatarMoedaCentavos(saldo);
  const appUrl     = body.appUrl || '';
  const assunto    = `NegaPay: fatura de ${mesAno} disponível`;

  const htmlBody = montarEmailFatura({
    mesAno, valor, saldoTexto, produto: fatura.produto,
    vencimento: fatura.vencimento, appUrl,
    mostrarSaldo: saldo !== fatura.totalPrimoCentavos
  });

  const plainBody =
    `Oi, Getúlio!\n\n` +
    `A fatura de ${mesAno} (${fatura.produto}) já está no NegaPay.\n` +
    `Valor desta fatura: ${valor}\n` +
    `Vencimento: ${fatura.vencimento}\n` +
    (saldo !== fatura.totalPrimoCentavos ? `Saldo total em aberto: ${saldoTexto}\n` : '') +
    `\n${appUrl ? 'Acesse: ' + appUrl + '\n\n' : ''}` +
    `Abraço,\nPinho`;

  MailApp.sendEmail({
    to: EMAIL_PRIMO, cc: EMAIL_ADMIN, subject: assunto,
    body: plainBody, htmlBody, replyTo: EMAIL_ADMIN, name: 'NegaPay'
  });

  const agora = new Date().toISOString();
  sheetFaturas.getRange(linha, 13).setValue(agora);
  sheetFaturas.getRange(linha, 14).setValue(`${EMAIL_PRIMO}, ${EMAIL_ADMIN}`);

  return { ok: true, notificadoEm: agora };
}

function montarEmailFatura(d) {
  const botao = d.appUrl
    ? `<a href="${escaparHtml(d.appUrl)}" style="display:inline-block;background:#00BCD4;color:#ffffff;text-decoration:none;font-weight:800;padding:14px 22px;border-radius:12px;margin-top:18px">Abrir NegaPay</a>`
    : '';
  const blocoSaldo = d.mostrarSaldo
    ? `<div style="font-size:14px;color:#6B7280;margin-top:10px">Saldo total em aberto: <strong>${escaparHtml(d.saldoTexto)}</strong></div>`
    : '';

  return `
    <div style="margin:0;padding:0;background:#F5F7FA;font-family:Arial,sans-serif;color:#1A1D23">
      <div style="max-width:560px;margin:0 auto;padding:28px 16px">
        <div style="background:#ffffff;border-radius:22px;overflow:hidden;border:1px solid #E5E7EB;box-shadow:0 10px 30px rgba(0,0,0,0.08)">
          <div style="background:linear-gradient(135deg,#00E676,#00BCD4,#2196F3);padding:28px;color:#ffffff">
            <div style="font-size:14px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;opacity:0.9">NegaPay</div>
            <h1 style="margin:10px 0 0;font-size:28px;line-height:1.15">Fatura disponível no app</h1>
          </div>
          <div style="padding:28px">
            <p style="font-size:17px;line-height:1.6;margin:0 0 18px">Oi, Getúlio! Tudo certo?</p>
            <p style="font-size:16px;line-height:1.6;margin:0 0 22px">
              A fatura de <strong>${escaparHtml(d.mesAno)}</strong> do <strong>${escaparHtml(d.produto)}</strong> já está fechada e disponível no NegaPay.
            </p>
            <div style="background:#F0F4F8;border-radius:16px;padding:18px;margin:0 0 22px">
              <div style="font-size:13px;font-weight:800;color:#6B7280;text-transform:uppercase;margin-bottom:8px">Valor desta fatura</div>
              <div style="font-size:32px;font-weight:900;color:#1A1D23">${escaparHtml(d.valor)}</div>
              <div style="font-size:14px;color:#6B7280;margin-top:8px">Vencimento: <strong>${escaparHtml(d.vencimento)}</strong></div>
              ${blocoSaldo}
            </div>
            <p style="font-size:15px;line-height:1.6;margin:0;color:#6B7280">
              No app você vê os lançamentos, adiciona lembrete no calendário e marca como pago.
            </p>
            ${botao}
            <p style="font-size:14px;line-height:1.6;margin:26px 0 0;color:#6B7280">Abraço,<br><strong>Pinho</strong></p>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ─────────────────────────────────────────
//  SETUP — rode uma vez para criar as abas v2
// ─────────────────────────────────────────
function setupV2() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  criarAba(ss, ABA_FATURAS, COLS_FATURAS);
  criarAba(ss, ABA_LANCAMENTOS, COLS_LANCAMENTOS);
  criarAba(ss, ABA_CARTOES, COLS_CARTOES);
  Logger.log('Abas v2 prontas. As antigas continuam intactas.');
}

function criarAba(ss, nome, colunas) {
  let aba = ss.getSheetByName(nome);
  if (!aba) aba = ss.insertSheet(nome);
  aba.getRange(1, 1, 1, colunas.length).setValues([colunas]);
  aba.setFrozenRows(1);
  return aba;
}

// ─────────────────────────────────────────
//  UTILITARIOS
// ─────────────────────────────────────────
function getAba(nome) {
  const aba = SpreadsheetApp.openById(SHEET_ID).getSheetByName(nome);
  if (!aba) throw new Error('Aba "' + nome + '" não existe. Rode setupV2() uma vez.');
  return aba;
}

// O Sheets devolve Date para qualquer celula que pareca data.
// Aqui tudo que e data ja foi gravado como texto, entao so
// normalizamos o que escapou.
function paraTexto(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  if (Object.prototype.toString.call(valor) === '[object Date]' && !isNaN(valor)) {
    return Utilities.formatDate(valor, 'America/Sao_Paulo', 'dd/MM/yyyy');
  }
  return String(valor);
}

function resposta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
                       .setMimeType(ContentService.MimeType.JSON);
}

function gerarToken() {
  return Utilities.getUuid() + '-' + Date.now().toString(36);
}

function formatarMoedaCentavos(centavos) {
  const v = (Number(centavos || 0) / 100).toFixed(2).replace('.', ',');
  return 'R$ ' + v.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function formatarMesAnoEmail(mesAno) {
  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                 'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const m = String(mesAno || '').match(/^(\d{1,2})\/(\d{4})$/);
  if (!m) return String(mesAno || 'Fatura');
  return `${meses[Number(m[1]) - 1] || m[1]} ${m[2]}`;
}

function escaparHtml(valor) {
  return String(valor || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function hashSenha(senha) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, senha, Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}
