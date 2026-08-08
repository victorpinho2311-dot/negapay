// ============================================================
//  NegaPay — Autenticação v1.1
//  Usa GET com payload encoded para evitar CORS preflight
// ============================================================

const Auth = (() => {

  const TOKEN_KEY  = 'negapay_token';
  const PERFIL_KEY = 'negapay_perfil';
  const NOME_KEY   = 'negapay_nome';
  const EXPIRA_KEY = 'negapay_expira';

  function salvarSessao({ token, perfil, nome, expira }) {
    localStorage.setItem(TOKEN_KEY,  token);
    localStorage.setItem(PERFIL_KEY, perfil);
    localStorage.setItem(NOME_KEY,   nome);
    localStorage.setItem(EXPIRA_KEY, expira);
  }

  function limparSessao() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(PERFIL_KEY);
    localStorage.removeItem(NOME_KEY);
    localStorage.removeItem(EXPIRA_KEY);
  }

  function getSessaoLocal() {
    const token  = localStorage.getItem(TOKEN_KEY);
    const perfil = localStorage.getItem(PERFIL_KEY);
    const nome   = localStorage.getItem(NOME_KEY);
    const expira = localStorage.getItem(EXPIRA_KEY);

    if (!token || !expira) return null;
    if (new Date() >= new Date(expira)) {
      limparSessao();
      return null;
    }
    return { token, perfil, nome };
  }

  async function login(usuario, senha) {
    const res = await API.post({ acao: 'login', usuario, senha });
    if (res.ok) salvarSessao(res);
    return res;
  }

  async function validarToken() {
    const sessao = getSessaoLocal();
    if (!sessao) return null;

    try {
      const res = await API.post({ acao: 'validarToken', token: sessao.token });
      if (res.ok) return { ...res, token: sessao.token };
      limparSessao();
      return null;
    } catch {
      return sessao;
    }
  }

  // Invalida o token no servidor antes de sair. Antes so limpava o
  // localStorage — o token continuava valido ate expirar.
  async function logout() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      try { await API.post({ acao: 'logout', token }); } catch (e) { /* sai mesmo assim */ }
    }
    limparSessao();
    window.location.reload();
  }

  function getToken()  { return localStorage.getItem(TOKEN_KEY);  }
  function getPerfil() { return localStorage.getItem(PERFIL_KEY); }

  return { login, validarToken, logout, getSessaoLocal, getToken, getPerfil };

})();

// ─────────────────────────────────────────
//  API — usa GET com payload para evitar CORS
// ─────────────────────────────────────────
const API = (() => {

  // Acima deste tamanho o Apps Script rejeita a URL. Uma fatura com
  // muitos lançamentos passava disso e o fetch falhava antes de sair —
  // aparecia para o usuário como "falha de conexão".
  const LIMITE_URL = 7000;

  async function post(body) {
    const url = window.NEGAPAY_CONFIG.apiUrl;

    // Injeta token automaticamente
    const token = localStorage.getItem('negapay_token');
    if (token && !body.token) body.token = token;

    const json = JSON.stringify(body);
    const fullUrl = `${url}?payload=${encodeURIComponent(json)}`;

    // GET com o payload na URL evita o preflight CORS que o Apps Script
    // não responde. Quando o corpo não cabe na URL, POST com
    // Content-Type text/plain também não dispara preflight (é um
    // "simple request"), então serve de saída sem quebrar o CORS.
    const res = fullUrl.length <= LIMITE_URL
      ? await fetch(fullUrl, { method: 'GET', redirect: 'follow' })
      : await fetch(url, {
          method: 'POST',
          redirect: 'follow',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: json
        });

    if (!res.ok) throw new Error('Erro na requisição: ' + res.status);

    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('Resposta inválida do servidor');
    }
  }

  return { post };

})();

if (typeof window !== "undefined") { window.Auth = Auth; window.API = API; }
