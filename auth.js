// ============================================================
//  NegaPay — Autenticação
//  Gerencia login, token local e sessão persistente.
// ============================================================

const Auth = (() => {

  const TOKEN_KEY  = 'negapay_token';
  const PERFIL_KEY = 'negapay_perfil';
  const NOME_KEY   = 'negapay_nome';
  const EXPIRA_KEY = 'negapay_expira';

  // ── Salva sessão localmente ──────────────────────────────
  function salvarSessao({ token, perfil, nome, expira }) {
    localStorage.setItem(TOKEN_KEY,  token);
    localStorage.setItem(PERFIL_KEY, perfil);
    localStorage.setItem(NOME_KEY,   nome);
    localStorage.setItem(EXPIRA_KEY, expira);
  }

  // ── Limpa sessão (logout) ────────────────────────────────
  function limparSessao() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(PERFIL_KEY);
    localStorage.removeItem(NOME_KEY);
    localStorage.removeItem(EXPIRA_KEY);
  }

  // ── Retorna sessão local sem validar no servidor ─────────
  function getSessaoLocal() {
    const token  = localStorage.getItem(TOKEN_KEY);
    const perfil = localStorage.getItem(PERFIL_KEY);
    const nome   = localStorage.getItem(NOME_KEY);
    const expira = localStorage.getItem(EXPIRA_KEY);

    if (!token || !expira) return null;

    // Verifica expiração local
    if (new Date() >= new Date(expira)) {
      limparSessao();
      return null;
    }

    return { token, perfil, nome };
  }

  // ── Login com usuário e senha ────────────────────────────
  async function login(usuario, senha) {
    const res = await API.post({
      acao: 'login',
      usuario,
      senha
    });

    if (res.ok) {
      salvarSessao(res);
    }

    return res;
  }

  // ── Valida token no servidor (usado na inicialização) ────
  async function validarToken() {
    const sessao = getSessaoLocal();
    if (!sessao) return null;

    try {
      const res = await API.post({
        acao: 'validarToken',
        token: sessao.token
      });

      if (res.ok) return { ...res, token: sessao.token };

      limparSessao();
      return null;
    } catch {
      // Sem internet: confia na sessão local se ainda válida
      return sessao;
    }
  }

  // ── Logout ───────────────────────────────────────────────
  function logout() {
    limparSessao();
    window.location.reload();
  }

  // ── Retorna token atual ──────────────────────────────────
  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  // ── Retorna perfil atual ─────────────────────────────────
  function getPerfil() {
    return localStorage.getItem(PERFIL_KEY);
  }

  return { login, validarToken, logout, getSessaoLocal, getToken, getPerfil };

})();

// ─────────────────────────────────────────
//  API — camada de comunicação com Apps Script
// ─────────────────────────────────────────
const API = (() => {

  async function post(body) {
    const url = window.NEGAPAY_CONFIG.apiUrl;

    // Injeta token automaticamente se disponível
    const token = Auth.getToken ? Auth.getToken() : null;
    if (token && !body.token) body.token = token;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error('Erro na requisição: ' + res.status);
    return res.json();
  }

  return { post };

})();
