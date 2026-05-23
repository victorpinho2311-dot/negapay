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

  function logout() {
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

  async function post(body) {
    const url = window.NEGAPAY_CONFIG.apiUrl;

    // Injeta token automaticamente
    const token = localStorage.getItem('negapay_token');
    if (token && !body.token) body.token = token;

    // Codifica o body como parâmetro GET para evitar CORS preflight
    const payload = encodeURIComponent(JSON.stringify(body));
    const fullUrl = `${url}?payload=${payload}`;

    const res = await fetch(fullUrl, {
      method: 'GET',
      redirect: 'follow'
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
