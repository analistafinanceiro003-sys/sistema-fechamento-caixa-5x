'use strict';
/* ============================================================
   AUTENTICAÇÃO — Caixa 5X
   Suporte a Supabase Auth (se configurado) com fallback
   para autenticação local contra state.users.
   Senhas nunca são exibidas na interface.
============================================================ */

let role = 'master';
let currentUser = null;
let sessionTimer = null;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutos

/* --- Timeout de sessão --- */
function resetSessionTimer() {
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => {
    if (currentUser) {
      flash('Sessão expirada por inatividade.');
      logout();
    }
  }, SESSION_TIMEOUT_MS);
}

/* --- Login via Supabase Auth --- */
async function trySupabaseLogin(email, password) {
  if (!sb) return null;
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error || !data?.user) return null;
    const { data: prof } = await sb
      .from('profiles')
      .select('*')
      .eq('user_id', data.user.id)
      .maybeSingle();
    return prof || null;
  } catch { return null; }
}

/* --- Credencial local de desenvolvimento (modo sem Supabase) ---
   Não é exibida na interface. Remova em produção após configurar Supabase Auth. */

/* --- Login local (contra state.users + credencial master local) --- */
function tryLocalLogin(login, password, selectedRole) {
  if (!window.DEV_LOCAL_MODE) return null;
  /* Admin / Operator: busca em state.users */
  if (!window.state) return null;
  const u = state.users.find((u) =>
    String(u.login).toLowerCase() === login &&
    String(u.pass) === password &&
    u.role === selectedRole &&
    u.status !== 'Inativo'
  );
  return u || null;
}

/* --- Entrada principal --- */
async function enterApp() {
  const selectedRole = val('profile') || 'master';
  const loginVal = val('loginUser').trim().toLowerCase();
  const passVal  = val('loginPass').trim();
  const errEl    = $('loginError');

  if (!loginVal || !passVal) {
    if (errEl) { errEl.textContent = 'Informe e-mail e senha.'; errEl.classList.add('show'); }
    return;
  }

  let user = null;

  /* 1. Tenta Supabase Auth */
  if (sb) {
    const prof = await trySupabaseLogin(loginVal, passVal);
    if (prof) {
      if (prof.role !== selectedRole) {
        if (errEl) {
          errEl.textContent = `Perfil incorreto. Este usuário é "${prof.role}", não "${selectedRole}".`;
          errEl.classList.add('show');
        }
        return;
      }
      if (prof.status === 'Inativo') {
        if (errEl) { errEl.textContent = 'Usuário inativo. Contate a Gestão 5X.'; errEl.classList.add('show'); }
        return;
      }
      user = {
        id: prof.id,
        authId: prof.user_id,
        name: prof.name,
        email: prof.email,
        role: prof.role,
        companyId: prof.company_id,
        storeId: prof.store_id,
        status: prof.status,
      };
    }
  }

  /* 2. Fallback local apenas em desenvolvimento sem Supabase real */
  if (!user && window.DEV_LOCAL_MODE) {
    const localUser = tryLocalLogin(loginVal, passVal, selectedRole);
    if (localUser) {
      user = {
        id: localUser.id,
        authId: null,
        name: localUser.name,
        email: localUser.login,
        role: localUser.role,
        companyId: localUser.companyId,
        storeId: localUser.storeId,
        status: localUser.status || 'Ativo',
      };
    }
  }

  if (!user) {
    if (errEl) { errEl.textContent = 'Login inválido para o perfil selecionado.'; errEl.classList.add('show'); }
    return;
  }

  if (errEl) errEl.classList.remove('show');

  role = user.role;
  currentUser = user;
  if (sb && user.authId && window.load) {
    await load();
  }

  if ($('rememberBox')?.dataset.checked === 'true') {
    localStorage.setItem('caixa5x_remember', loginVal);
  }

  $('loginScreen').style.display = 'none';
  $('app').style.display = 'grid';
  /* toggle inline no header — sem mobileMenuBtn */

  resetSessionTimer();
  setupMenu();
  setupRealtimeSync();
  renderAll();

  const page = role === 'master' ? 'dashboard' : firstAllowedPage();
  if (!page) {
    alert('Nenhum módulo liberado para este perfil. Contate a Gestão 5X.');
    logout();
    return;
  }
  showPage(page, document.querySelector(`.nav button[data-page="${page}"]`));
}

/* --- Logout --- */
async function logout() {
  clearTimeout(sessionTimer);
  if (sb) {
    try { await sb.auth.signOut(); } catch {}
  }
  stopRealtimeSync();
  currentUser = null;
  role = 'master';
  $('app').style.display = 'none';
  $('loginScreen').style.display = 'grid';
  closeSidebar();
  /* Limpa senha do campo mas mantém e-mail se "lembrar" */
  setVal('loginPass', '');
}

/* --- Verificação de sessão ativa (Supabase Auth) --- */
async function checkActiveSession() {
  if (!sb) return null;
  try {
    const { data } = await sb.auth.getSession();
    const session = data?.session;
    if (!session) return null;
    const { data: prof } = await sb
      .from('profiles')
      .select('*')
      .eq('user_id', session.user.id)
      .maybeSingle();
    return prof || null;
  } catch { return null; }
}

/* --- Funções UI de login --- */
function togglePassword() {
  const e = $('loginPass');
  if (e) e.type = e.type === 'password' ? 'text' : 'password';
}

function toggleRemember() {
  const box = $('rememberBox');
  if (!box) return;
  const checked = box.dataset.checked !== 'true';
  box.dataset.checked = checked;
  box.classList.toggle('checked', checked);
  if (!checked) localStorage.removeItem('caixa5x_remember');
}

function forgotPassword() {
  alert('Para redefinir sua senha, acesse o painel do Supabase ou solicite reset ao administrador do sistema.');
}

function openSupport() {
  window.open('https://wa.me/', '_blank');
}

Object.assign(window, {
  role: null, currentUser: null,
  enterApp, logout, checkActiveSession,
  togglePassword, toggleRemember, forgotPassword, openSupport,
  resetSessionTimer,
});

Object.defineProperty(window, 'role', {
  get: () => role,
  set: (v) => { role = v; },
  configurable: true,
});
Object.defineProperty(window, 'currentUser', {
  get: () => currentUser,
  set: (v) => { currentUser = v; },
  configurable: true,
});
