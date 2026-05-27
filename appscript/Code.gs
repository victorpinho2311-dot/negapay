// ============================================================
//  NegaPay — Apps Script Backend v1.3
//  Adicionado: excluirFatura e notificação por email
// ============================================================

const SHEET_ID = '1qHp4OOiOYxz-JYEZF3gmXfUW3cVAiODD2nNy2fZM1jA';
const EMAIL_PRIMO = 'getulio.farias@outlook.com';
const EMAIL_ADMIN = 'victor-pinho@hotmail.com';

const ABA_USUARIOS    = 'usuarios';
const ABA_FATURAS     = 'faturas';
const ABA_LANCAMENTOS = 'lancamentos';

const COL_FATURA_NOTIFICADO_EM   = 8;
const COL_FATURA_NOTIFICADO_PARA = 9;

function doGet(e) {
  try {
    const payload = e.parameter.payload;
    if (!payload) {
      return resposta({ ok: true, servico: 'NegaPay API', versao: '1.4' });
    }

    const body = JSON.parse(decodeURIComponent(payload));
    const acao = body.acao;
    let resultado;

    switch (acao) {
      case 'login':          resultado = login(body); break;
      case 'validarToken':   resultado = validarToken(body); break;
      case 'salvarFatura':   resultado = salvarFatura(body); break;
      case 'listarFaturas':  resultado = listarFaturas(body); break;
      case 'getFatura':      resultado = getFatura(body); break;
      case 'marcarPago':     resultado = marcarPago(body); break;
      case 'excluirFatura':  resultado = excluirFatura(body); break;
      case 'enviarNotificacaoFatura': resultado = enviarNotificacaoFatura(body); break;
      default:               resultado = { ok: false, erro: 'Ação desconhecida' };
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
  garantirColunasFaturas(sheetFaturas);

  const faturasDados = sheetFaturas.getDataRange().getValues();
  for (let i = faturasDados.length - 1; i >= 1; i--) {
    if (faturasDados[i][0] === mesAno) sheetFaturas.deleteRow(i + 1);
  }

  const faturaId = 'FAT_' + mesAno.replace('/', '_') + '_' + Date.now();

  sheetFaturas.appendRow([
    faturaId, mesAno, vencimento, totalGeral,
    false, '', new Date().toISOString(), '', ''
  ]);

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

  const sheet = getAba(ABA_FATURAS);
  garantirColunasFaturas(sheet);

  const dados = sheet.getDataRange().getValues();
  const faturas = [];

  for (let i = 1; i < dados.length; i++) {
    const [faturaId, mesAno, vencimento, totalGeral, pago, dataPagamento, criadoEm, notificadoEm, notificadoPara] = dados[i];
    if (!faturaId) continue;
    faturas.push({ faturaId, mesAno, vencimento, totalGeral, pago, dataPagamento, criadoEm, notificadoEm, notificadoPara });
  }

  faturas.sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));
  return { ok: true, faturas };
}

function getFatura(body) {
  const auth = validarToken(body);
  if (!auth.ok) return auth;

  const { faturaId } = body;
  const sheetFaturas = getAba(ABA_FATURAS);
  garantirColunasFaturas(sheetFaturas);

  const fatDados = sheetFaturas.getDataRange().getValues();
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
        criadoEm:      fatDados[i][6],
        notificadoEm:  fatDados[i][7],
        notificadoPara: fatDados[i][8]
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
  garantirColunasFaturas(sheet);
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

function excluirFatura(body) {
  const auth = validarToken(body);
  if (!auth.ok) return auth;
  if (auth.perfil !== 'admin') return { ok: false, erro: 'Sem permissão' };

  const { faturaId } = body;

  // Remove da aba faturas
  const sheetFaturas = getAba(ABA_FATURAS);
  garantirColunasFaturas(sheetFaturas);
  const fatDados = sheetFaturas.getDataRange().getValues();
  for (let i = fatDados.length - 1; i >= 1; i--) {
    if (fatDados[i][0] === faturaId) sheetFaturas.deleteRow(i + 1);
  }

  // Remove todos os lançamentos
  const sheetLanc = getAba(ABA_LANCAMENTOS);
  const lancDados = sheetLanc.getDataRange().getValues();
  for (let i = lancDados.length - 1; i >= 1; i--) {
    if (lancDados[i][1] === faturaId) sheetLanc.deleteRow(i + 1);
  }

  return { ok: true };
}

function enviarNotificacaoFatura(body) {
  const auth = validarToken(body);
  if (!auth.ok) return auth;
  if (auth.perfil !== 'admin') return { ok: false, erro: 'Sem permissão' };
  if (!EMAIL_PRIMO || EMAIL_PRIMO.includes('@exemplo.com')) {
    return { ok: false, erro: 'Configure o EMAIL_PRIMO no Code.gs antes de enviar.' };
  }

  const sheetFaturas = getAba(ABA_FATURAS);
  garantirColunasFaturas(sheetFaturas);
  const faturaRow = encontrarLinhaFatura(sheetFaturas, body.faturaId);
  if (!faturaRow) return { ok: false, erro: 'Fatura não encontrada' };

  const notificadoEmAtual = sheetFaturas.getRange(faturaRow, COL_FATURA_NOTIFICADO_EM).getValue();
  if (notificadoEmAtual) {
    return { ok: true, jaEnviado: true, notificadoEm: notificadoEmAtual };
  }

  const faturaRes = getFatura(body);
  if (!faturaRes.ok) return faturaRes;

  const fatura = faturaRes.fatura;
  const appUrl = body.appUrl || '';
  const mesAno = formatarMesAnoEmail(fatura.mesAno);
  const valor = formatarMoedaEmail(fatura.totalGeral);
  const vencimento = formatarDataEmail(fatura.vencimento);
  const assunto = `NegaPay: fatura de ${mesAno} disponível`;
  const htmlBody = montarEmailFatura({ mesAno, valor, vencimento, appUrl });
  const plainBody =
    `Oi, Getlio!\n\n` +
    `Sua fatura de ${mesAno} já está disponível no NegaPay.\n` +
    `Valor: ${valor}\n` +
    `Vencimento: ${vencimento}\n\n` +
    `${appUrl ? 'Acesse: ' + appUrl + '\n\n' : 'Abra o app NegaPay para conferir os detalhes.\n\n'}` +
    `Abraço,\nPinho`;

  MailApp.sendEmail({
    to: EMAIL_PRIMO,
    cc: EMAIL_ADMIN,
    subject: assunto,
    body: plainBody,
    htmlBody,
    replyTo: EMAIL_ADMIN,
    name: 'NegaPay'
  });

  const notificadoEm = new Date().toISOString();
  sheetFaturas.getRange(faturaRow, COL_FATURA_NOTIFICADO_EM).setValue(notificadoEm);
  sheetFaturas.getRange(faturaRow, COL_FATURA_NOTIFICADO_PARA).setValue(`${EMAIL_PRIMO}, ${EMAIL_ADMIN}`);

  return { ok: true, notificadoEm };
}

function montarEmailFatura({ mesAno, valor, vencimento, appUrl }) {
  const botao = appUrl
    ? `<a href="${escaparHtml(appUrl)}" style="display:inline-block;background:#00BCD4;color:#ffffff;text-decoration:none;font-weight:800;padding:14px 22px;border-radius:12px;margin-top:18px">Abrir NegaPay</a>`
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
            <p style="font-size:17px;line-height:1.6;margin:0 0 18px">Oi, Getlio! Tudo certo?</p>
            <p style="font-size:16px;line-height:1.6;margin:0 0 22px">
              A fatura de <strong>${escaparHtml(mesAno)}</strong> já está fechada e disponível no NegaPay para você conferir com calma.
            </p>
            <div style="background:#F0F4F8;border-radius:16px;padding:18px;margin:0 0 22px">
              <div style="font-size:13px;font-weight:800;color:#6B7280;text-transform:uppercase;margin-bottom:8px">Total a pagar</div>
              <div style="font-size:32px;font-weight:900;color:#1A1D23">${escaparHtml(valor)}</div>
              <div style="font-size:14px;color:#6B7280;margin-top:8px">Vencimento: <strong>${escaparHtml(vencimento)}</strong></div>
            </div>
            <p style="font-size:15px;line-height:1.6;margin:0;color:#6B7280">
              No app você vê os lançamentos, adiciona lembrete no calendário e marca como pago quando fizer o pagamento.
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
  abaF.appendRow(['faturaId', 'mesAno', 'vencimento', 'totalGeral', 'pago', 'dataPagamento', 'criadoEm', 'notificadoEm', 'notificadoPara']);

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

function garantirColunasFaturas(sheet) {
  const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), COL_FATURA_NOTIFICADO_PARA)).getValues()[0];
  if (headers[COL_FATURA_NOTIFICADO_EM - 1] !== 'notificadoEm') {
    sheet.getRange(1, COL_FATURA_NOTIFICADO_EM).setValue('notificadoEm');
  }
  if (headers[COL_FATURA_NOTIFICADO_PARA - 1] !== 'notificadoPara') {
    sheet.getRange(1, COL_FATURA_NOTIFICADO_PARA).setValue('notificadoPara');
  }
}

function encontrarLinhaFatura(sheet, faturaId) {
  if (!faturaId) return null;
  const dados = sheet.getDataRange().getValues();
  for (let i = 1; i < dados.length; i++) {
    if (dados[i][0] === faturaId) return i + 1;
  }
  return null;
}

function resposta(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function gerarToken() {
  return Utilities.getUuid() + '-' + Date.now().toString(36);
}

function formatarMoedaEmail(valor) {
  return 'R$ ' + Number(valor).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatarMesAnoEmail(mesAno) {
  if (!mesAno) return 'Fatura';
  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  if (String(mesAno).match(/^\d{4}-/) || String(mesAno).includes('T')) {
    const d = new Date(mesAno);
    return `${meses[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }
  const partes = String(mesAno).split('/');
  const mes = parseInt(partes[0], 10);
  return `${meses[mes - 1] || partes[0]} ${partes[1] || ''}`.trim();
}

function formatarDataEmail(data) {
  if (!data) return '';
  const texto = String(data);
  if (texto.match(/^\d{4}-/) || texto.includes('T')) {
    const d = new Date(data);
    if (!isNaN(d)) {
      return String(d.getUTCDate()).padStart(2, '0') + '/' +
        String(d.getUTCMonth() + 1).padStart(2, '0') + '/' +
        d.getUTCFullYear();
    }
  }
  return texto;
}

function escaparHtml(valor) {
  return String(valor || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hashSenha(senha) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    senha,
    Utilities.Charset.UTF_8
  );
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}
