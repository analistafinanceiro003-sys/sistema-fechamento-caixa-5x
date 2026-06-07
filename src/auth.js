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

/* --- Entrada principal — perfil detectado automaticamente --- */
async function enterApp() {
  const loginVal = val('loginUser').trim().toLowerCase();
  const passVal  = val('loginPass').trim();
  const errEl    = $('loginError');

  if (!loginVal || !passVal) {
    if (errEl) { errEl.textContent = 'Informe e-mail e senha.'; errEl.classList.add('show'); }
    return;
  }

  let user = null;

  /* 1. Tenta Supabase Auth — perfil identificado pelo banco */
  if (sb) {
    const prof = await trySupabaseLogin(loginVal, passVal);
    if (prof) {
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

  /* 2. Fallback local — testa todos os perfis em ordem */
  if (!user && window.DEV_LOCAL_MODE) {
    for (const tryRole of ['master', 'admin', 'operator']) {
      const localUser = tryLocalLogin(loginVal, passVal, tryRole);
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
        break;
      }
    }
  }

  if (!user) {
    if (errEl) { errEl.textContent = 'E-mail ou senha incorretos.'; errEl.classList.add('show'); }
    return;
  }

  if (errEl) errEl.classList.remove('show');

  role = user.role;
  currentUser = user;
  document.body.classList.toggle('role-operator', role === 'operator');
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
  stopRealtimeSync();
  if (sb) {
    try { await sb.auth.signOut(); } catch {}
  }
  currentUser = null;
  role = 'master';
  /* Limpa estado em memória para que o próximo login carregue dados frescos */
  if (window.state !== undefined) window.state = null;
  /* Permite re-bind de eventos no próximo login */
  window.__closingEventsBound = false;
  document.body.classList.remove('role-operator');
  $('app').style.display = 'none';
  $('loginScreen').style.display = 'grid';
  closeSidebar();
  setVal('loginPass', '');
}

/* --- Alterar senha (usuário autenticado) --- */
async function changePassword() {
  const modal = $('changePasswordModal');
  if (modal) { modal.style.display = 'flex'; return; }
}

async function submitChangePassword() {
  const newPass = val('newPasswordInput');
  const confirm = val('confirmPasswordInput');
  if (!newPass || newPass.length < 6) return alert('A nova senha precisa ter pelo menos 6 caracteres.');
  if (newPass !== confirm) return alert('As senhas não coincidem.');
  if (!sb) return alert('Supabase não disponível.');
  const btn = $('submitChangePassBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }
  try {
    const { error } = await sb.auth.updateUser({ password: newPass });
    if (error) throw error;
    if (window.toast) toast('Senha alterada com sucesso!', 'success');
    else alert('Senha alterada com sucesso!');
    closeChangePasswordModal();
  } catch (e) {
    alert('Erro ao alterar senha: ' + (e.message || 'tente novamente.'));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar nova senha'; }
  }
}

function closeChangePasswordModal() {
  const modal = $('changePasswordModal');
  if (modal) modal.style.display = 'none';
  setVal('newPasswordInput', '');
  setVal('confirmPasswordInput', '');
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

async function forgotPassword() {
  const email = val('loginUser').trim();
  if (!email || !email.includes('@')) return alert('Informe seu e-mail no campo acima antes de prosseguir.');
  if (!sb) return alert('Supabase não disponível. Solicite redefinição ao administrador.');
  try {
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) throw error;
    alert('Link de redefinição enviado para ' + email + '. Verifique sua caixa de entrada.');
  } catch (e) {
    alert('Não foi possível enviar o link: ' + (e.message || 'tente novamente.'));
  }
}

function openSupport() {
  window.open('https://wa.me/5500000000000', '_blank');
}

Object.assign(window, {
  role: null, currentUser: null,
  enterApp, logout, checkActiveSession,
  togglePassword, toggleRemember, forgotPassword, openSupport,
  resetSessionTimer,
  changePassword, submitChangePassword, closeChangePasswordModal,
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
