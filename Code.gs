// ============================================================
//  NegaPay — Apps Script Backend
//  Funções: autenticação, leitura/escrita de faturas, status
//  Planilha esperada: uma aba por coleção (veja setupSheet)
// ============================================================

const SHEET_ID = 'COLE_AQUI_O_ID_DA_SUA_PLANILHA'; // ← substitua após criar a planilha

// Nomes das abas
const ABA_USUARIOS  = 'usuarios';
const ABA_FATURAS   = 'faturas';
const ABA_LANCAMENTOS = 'lancamentos';

// ─────────────────────────────────────────
//  ENTRY POINT — recebe todas as requisições
// ─────────────────────────────────────────
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const acao = body.acao;

    switch (acao) {
      case 'login':           return resposta(login(body));
      case 'validarToken':    return resposta(validarToken(body));
      case 'salvarFatura':    return resposta(salvarFatura(body));
      case 'listarFaturas':   return resposta(listarFaturas(body));
      case 'getFatura':       return resposta(getFatura(body));
      case 'marcarPago':      return resposta(marcarPago(body));
      default:                return resposta({ ok: false, erro: 'Ação desconhecida' });
    }
  } catch (err) {
    return resposta({ ok: false, erro: err.message });
  }
}

function doGet(e) {
  // Permite checagem de saúde da API
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, servico: 'NegaPay API', versao: '1.0' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────
//  AUTENTICAÇÃO
// ─────────────────────────────────────────

/**
 * Valida usuário/senha e retorna token de sessão.
 * body: { acao, usuario, senha }
 */
function login(body) {
  const { usuario, senha } = body;
  if (!usuario || !senha) return { ok: false, erro: 'Campos obrigatórios ausentes' };

  const sheet = getAba(ABA_USUARIOS);
  const dados = sheet.getDataRange().getValues();

  // Linha 1 = cabeçalho: usuario | senhaHash | perfil | ativo
  for (let i = 1; i < dados.length; i++) {
    const [u, s, perfil, ativo] = dados[i];
    if (u === usuario && s === hashSenha(senha) && ativo === true) {
      const token = gerarToken();
      const expira = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 dias

      // Salva token na linha do usuário (colunas E e F)
      sheet.getRange(i + 1, 5).setValue(token);
      sheet.getRange(i + 1, 6).setValue(expira.toISOString());

      return { ok: true, token, perfil, nome: usuario, expira: expira.toISOString() };
    }
  }

  return { ok: false, erro: 'Usuário ou senha incorretos' };
}

/**
 * Valida se um token ainda é válido.
 * body: { acao, token }
 */
function validarToken(body) {
  const { token } = body;
  if (!token) return { ok: false, erro: 'Token ausente' };

  const sheet = getAba(ABA_USUARIOS);
  const dados = sheet.getDataRange().getValues();

  for (let i = 1; i < dados.length; i++) {
    const [usuario, , perfil, ativo, tkn, expira] = dados[i];
    if (tkn === token && ativo === true) {
      const agora = new Date();
      const expiraDate = new Date(expira);
      if (agora < expiraDate) {
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

/**
 * Salva uma fatura processada (chamado pelo painel admin após upload do PDF).
 * body: { acao, token, fatura: { mesAno, vencimento, cartoes: [...], totalGeral } }
 */
function salvarFatura(body) {
  const auth = validarToken(body);
  if (!auth.ok) return auth;
  if (auth.perfil !== 'admin') return { ok: false, erro: 'Sem permissão' };

  const { fatura } = body;
  const { mesAno, vencimento, cartoes, totalGeral } = fatura;

  const sheetFaturas = getAba(ABA_FATURAS);
  const sheetLanc    = getAba(ABA_LANCAMENTOS);

  // Verifica se já existe fatura para este mesAno e remove
  const faturasDados = sheetFaturas.getDataRange().getValues();
  for (let i = faturasDados.length - 1; i >= 1; i--) {
    if (faturasDados[i][0] === mesAno) {
      sheetFaturas.deleteRow(i + 1);
    }
  }

  // Gera ID único para a fatura
  const faturaId = 'FAT_' + mesAno.replace('/', '_') + '_' + Date.now();

  // Salva linha de resumo da fatura
  // Colunas: faturaId | mesAno | vencimento | totalGeral | pago | dataPagamento | criadoEm
  sheetFaturas.appendRow([
    faturaId,
    mesAno,
    vencimento,
    totalGeral,
    false,
    '',
    new Date().toISOString()
  ]);

  // Remove lançamentos antigos deste mesAno
  const lancDados = sheetLanc.getDataRange().getValues();
  for (let i = lancDados.length - 1; i >= 1; i--) {
    if (lancDados[i][1] === faturaId) {
      sheetLanc.deleteRow(i + 1);
    }
  }

  // Salva cada lançamento
  // Colunas: id | faturaId | cartaoFinal | data | descricao | valor | tipo
  cartoes.forEach(cartao => {
    cartao.lancamentos.forEach(lanc => {
      sheetLanc.appendRow([
        'LNC_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        faturaId,
        cartao.final,
        lanc.data,
        lanc.descricao,
        lanc.valor,
        lanc.valor < 0 ? 'estorno' : 'compra'
      ]);
    });
  });

  return { ok: true, faturaId };
}

/**
 * Lista todas as faturas (resumo), da mais recente para a mais antiga.
 * body: { acao, token }
 */
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

  // Ordena do mais recente pro mais antigo
  faturas.sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));

  return { ok: true, faturas };
}

/**
 * Retorna detalhes completos de uma fatura com seus lançamentos.
 * body: { acao, token, faturaId }
 */
function getFatura(body) {
  const auth = validarToken(body);
  if (!auth.ok) return auth;

  const { faturaId } = body;

  // Busca resumo
  const fatDados = getAba(ABA_FATURAS).getDataRange().getValues();
  let fatura = null;
  for (let i = 1; i < fatDados.length; i++) {
    if (fatDados[i][0] === faturaId) {
      fatura = {
        faturaId:       fatDados[i][0],
        mesAno:         fatDados[i][1],
        vencimento:     fatDados[i][2],
        totalGeral:     fatDados[i][3],
        pago:           fatDados[i][4],
        dataPagamento:  fatDados[i][5],
        criadoEm:       fatDados[i][6]
      };
      break;
    }
  }

  if (!fatura) return { ok: false, erro: 'Fatura não encontrada' };

  // Busca lançamentos agrupados por cartão
  const lancDados = getAba(ABA_LANCAMENTOS).getDataRange().getValues();
  const cartoesMap = {};

  for (let i = 1; i < lancDados.length; i++) {
    const [id, fId, cartaoFinal, data, descricao, valor, tipo] = lancDados[i];
    if (fId !== faturaId) continue;

    if (!cartoesMap[cartaoFinal]) cartoesMap[cartaoFinal] = { final: cartaoFinal, lancamentos: [], subtotal: 0 };
    cartoesMap[cartaoFinal].lancamentos.push({ id, data, descricao, valor, tipo });
    cartoesMap[cartaoFinal].subtotal += Number(valor);
  }

  fatura.cartoes = Object.values(cartoesMap);

  return { ok: true, fatura };
}

/**
 * Marca uma fatura como paga (chamado pelo painel do primo).
 * body: { acao, token, faturaId }
 */
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
//  SETUP — rode UMA VEZ para criar a planilha
// ─────────────────────────────────────────

/**
 * Execute esta função manualmente UMA VEZ no Apps Script
 * para criar todas as abas e usuários padrão.
 * Depois, anote o ID da planilha gerada e cole em SHEET_ID acima.
 */
function setupSheet() {
  const ss = SpreadsheetApp.create('NegaPay — Base de Dados');

  // Aba usuários
  const abaU = ss.getActiveSheet();
  abaU.setName(ABA_USUARIOS);
  abaU.appendRow(['usuario', 'senhaHash', 'perfil', 'ativo', 'token', 'tokenExpira']);

  // Admin: usuario "pinho", senha "negapay@admin" (troque antes de publicar!)
  abaU.appendRow(['pinho', hashSenha('negapay@admin'), 'admin', true, '', '']);

  // Primo: usuario "getlio", senha "negapay@primo" (troque antes de publicar!)
  abaU.appendRow(['getlio', hashSenha('negapay@primo'), 'primo', true, '', '']);

  // Aba faturas
  const abaF = ss.insertSheet(ABA_FATURAS);
  abaF.appendRow(['faturaId', 'mesAno', 'vencimento', 'totalGeral', 'pago', 'dataPagamento', 'criadoEm']);

  // Aba lançamentos
  const abaL = ss.insertSheet(ABA_LANCAMENTOS);
  abaL.appendRow(['id', 'faturaId', 'cartaoFinal', 'data', 'descricao', 'valor', 'tipo']);

  const url = ss.getUrl();
  const id  = ss.getId();

  Logger.log('✅ Planilha criada!');
  Logger.log('URL: ' + url);
  Logger.log('ID (cole em SHEET_ID): ' + id);
}

// ─────────────────────────────────────────
//  UTILITÁRIOS
// ─────────────────────────────────────────

function getAba(nome) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  return ss.getSheetByName(nome);
}

function resposta(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function gerarToken() {
  return Utilities.getUuid() + '-' + Date.now().toString(36);
}

/**
 * Hash simples via SHA-256 usando Utilities do Apps Script.
 * Não use para sistemas de alto risco — suficiente para uso familiar.
 */
function hashSenha(senha) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    senha,
    Utilities.Charset.UTF_8
  );
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}
