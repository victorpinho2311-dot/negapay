// ============================================================
//  NegaPay — Apps Script Backend v1.1
//  Correção: CORS via GET com parâmetros JSON encoded
// ============================================================

const SHEET_ID = '1qHp4OOiOYxz-JYEZF3gmXfUW3cVAiODD2nNy2fZM1jA';

const ABA_USUARIOS    = 'usuarios';
const ABA_FATURAS     = 'faturas';
const ABA_LANCAMENTOS = 'lancamentos';

// ─────────────────────────────────────────
//  ENTRY POINT — GET (evita CORS preflight)
// ─────────────────────────────────────────
function doGet(e) {
  try {
    const payload = e.parameter.payload;
    if (!payload) {
      return resposta({ ok: true, servico: 'NegaPay API', versao: '1.1' });
    }

    const body = JSON.parse(decodeURIComponent(payload));
    const acao = body.acao;
    let resultado;

    switch (acao) {
      case 'login':         resultado = login(body); break;
      case 'validarToken':  resultado = validarToken(body); break;
      case 'salvarFatura':  resultado = salvarFatura(body); break;
      case 'listarFaturas': resultado = listarFaturas(body); break;
      case 'getFatura':     resultado = getFatura(body); break;
      case 'marcarPago':    resultado = marcarPago(body); break;
      default:              resultado = { ok: false, erro: 'Ação desconhecida' };
    }

    return resposta(resultado);

  } catch (err) {
    return resposta({ ok: false, erro: err.message });
  }
}

// doPost mantido como fallback
function doPost(e) {
  return doGet({ parameter: { payload: encodeURIComponent(e.postData.contents) } });
}

// ─────────────────────────────────────────
//  AUTENTICAÇÃO
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
      } else {
        return { ok: false, erro: 'Token expirado' };
      }
    }
  }

  return { ok: false, erro: 'Token inválido' };
}

// ─────────────────────────────────────────
//  FATURAS
// ─────────────────────────────────────────
function salvarFatura(body) {
  const auth = validarToken(body);
  if (!auth.ok) return auth;
  if (auth.perfil !== 'admin') return { ok: false, erro: 'Sem permissão' };

  const { fatura } = body;
  const { mesAno, vencimento, cartoes, totalGeral } = fatura;

  const sheetFaturas = getAba(ABA_FATURAS);
  const sheetLanc    = getAba(ABA_LANCAMENTOS);

  // Remove fatura existente do mesmo mesAno
  const faturasDados = sheetFaturas.getDataRange().getValues();
  for (let i = faturasDados.length - 1; i >= 1; i--) {
    if (faturasDados[i][0] === mesAno) sheetFaturas.deleteRow(i + 1);
  }

  const faturaId = 'FAT_' + mesAno.replace('/', '_') + '_' + Date.now();

  sheetFaturas.appendRow([
    faturaId, mesAno, vencimento, totalGeral,
    false, '', new Date().toISOString()
  ]);

  // Remove lançamentos antigos
  const lancDados = sheetLanc.getDataRange().getValues();
  for (let i = lancDados.length - 1; i >= 1; i--) {
    if (lancDados[i][1] === faturaId) sheetLanc.deleteRow(i + 1);
  }

  cartoes.forEach(cartao => {
    cartao.lancamentos.forEach(lanc => {
      sheetLanc.appendRow([
        'LNC_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        faturaId, cartao.final, lanc.data, lanc.descricao, lanc.valor,
        lanc.valor < 0 ? 'estorno' : 'compra'
      ]);
    });
  });

  return { ok: true, faturaId };
}

function listarFaturas(body) {
  const auth = validarToken(body);
  if (!auth.ok) return auth;

  const dados = getAba(ABA_FATURAS).getDataRange().getValues();
  const faturas = [];

  for (let i = 1; i < dados.length; i++) {
    const [faturaId, mesAno, vencimento, totalGeral, pago, dataPagamento, criadoEm] = dados[i];
    if (!faturaId) continue;
    faturas.push({ faturaId, mesAno, vencimento, totalGeral, pago, dataPagamento, criadoEm });
  }

  faturas.sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));
  return { ok: true, faturas };
}

function getFatura(body) {
  const auth = validarToken(body);
  if (!auth.ok) return auth;

  const { faturaId } = body;
  const fatDados = getAba(ABA_FATURAS).getDataRange().getValues();
  let fatura = null;

  for (let i = 1; i < fatDados.length; i++) {
    if (fatDados[i][0] === faturaId) {
      fatura = {
        faturaId:      fatDados[i][0],
        mesAno:        fatDados[i][1],
        vencimento:    fatDados[i][2],
        totalGeral:    fatDados[i][3],
        pago:          fatDados[i][4],
        dataPagamento: fatDados[i][5],
        criadoEm:      fatDados[i][6]
      };
      break;
    }
  }

  if (!fatura) return { ok: false, erro: 'Fatura não encontrada' };

  const lancDados = getAba(ABA_LANCAMENTOS).getDataRange().getValues();
  const cartoesMap = {};

  for (let i = 1; i < lancDados.length; i++) {
    const [id, fId, cartaoFinal, data, descricao, valor, tipo] = lancDados[i];
    if (fId !== faturaId) continue;
    if (!cartoesMap[cartaoFinal]) {
      cartoesMap[cartaoFinal] = { final: cartaoFinal, lancamentos: [], subtotal: 0 };
    }
    cartoesMap[cartaoFinal].lancamentos.push({ id, data, descricao, valor, tipo });
    cartoesMap[cartaoFinal].subtotal += Number(valor);
  }

  fatura.cartoes = Object.values(cartoesMap);
  return { ok: true, fatura };
}

function marcarPago(body) {
  const auth = validarToken(body);
  if (!auth.ok) return auth;

  const { faturaId } = body;
  const sheet = getAba(ABA_FATURAS);
  const dados = sheet.getDataRange().getValues();

  for (let i = 1; i < dados.length; i++) {
    if (dados[i][0] === faturaId) {
      sheet.getRange(i + 1, 5).setValue(true);
      sheet.getRange(i + 1, 6).setValue(new Date().toISOString());
      return { ok: true };
    }
  }

  return { ok: false, erro: 'Fatura não encontrada' };
}

// ─────────────────────────────────────────
//  SETUP — rode UMA VEZ
// ─────────────────────────────────────────
function setupSheet() {
  const ss = SpreadsheetApp.create('NegaPay — Base de Dados');

  const abaU = ss.getActiveSheet();
  abaU.setName(ABA_USUARIOS);
  abaU.appendRow(['usuario', 'senhaHash', 'perfil', 'ativo', 'token', 'tokenExpira']);
  abaU.appendRow(['pinho',  hashSenha('negapay@admin'), 'admin', true, '', '']);
  abaU.appendRow(['getlio', hashSenha('negapay@primo'), 'primo', true, '', '']);

  const abaF = ss.insertSheet(ABA_FATURAS);
  abaF.appendRow(['faturaId', 'mesAno', 'vencimento', 'totalGeral', 'pago', 'dataPagamento', 'criadoEm']);

  const abaL = ss.insertSheet(ABA_LANCAMENTOS);
  abaL.appendRow(['id', 'faturaId', 'cartaoFinal', 'data', 'descricao', 'valor', 'tipo']);

  Logger.log('✅ Planilha criada!');
  Logger.log('URL: ' + ss.getUrl());
  Logger.log('ID (cole em SHEET_ID): ' + ss.getId());
}

// ─────────────────────────────────────────
//  UTILITÁRIOS
// ─────────────────────────────────────────
function getAba(nome) {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(nome);
}

function resposta(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function gerarToken() {
  return Utilities.getUuid() + '-' + Date.now().toString(36);
}

function hashSenha(senha) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    senha,
    Utilities.Charset.UTF_8
  );
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}
