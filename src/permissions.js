'use strict';
/* ============================================================
   PERMISSÕES E NAVEGAÇÃO — Caixa 5X v2
   - Hierarquia: módulo principal → submódulos
   - Sidebar gerada dinamicamente por permissões
   - Dupla proteção: visual (sidebar/subtabs) + funcional (showPage/showSubTab)
============================================================ */

/* ============================================================
   ÁRVORE DE MÓDULOS — Admin e Operador
   Cada módulo tem:
     key        → chave no state.modules (para bloquear/liberar)
     page       → ID da <section> que abre
     label      → texto exibido na sidebar e no gerenciador
     defaultEnabled → padrão ao criar empresa nova
     submodules → sub-abas ou cards controlados individualmente
       key      → chave no state.modules
       label    → texto no gerenciador de módulos
       subTab   → ID da inner-tab-panel (para abas) ou null
       card     → ID do elemento card (para cards de relatório) ou null
       defaultEnabled → padrão
============================================================ */
const MODULE_TREE = {
  admin: [
    {
      key: 'adminDashboard', label: 'Dashboard da Empresa', page: 'adminDashboard',
      defaultEnabled: true,
      submodules: [],
    },
    {
      key: 'adminFechamento', label: 'Fechamento', page: 'adminFechamento',
      defaultEnabled: true,
      submodules: [
        { key: 'sub_fech_form', label: 'Cadastrar Fechamento', subTab: 'afech-form',      defaultEnabled: false },
        { key: 'sub_fech_hist', label: 'Histórico',            subTab: 'afech-historico', defaultEnabled: true  },
      ],
    },
    {
      key: 'adminOperacao', label: 'Operação', page: 'adminOperacao',
      defaultEnabled: true,
      submodules: [
        { key: 'sub_op_regras', label: 'Regras Operacionais', subTab: 'aop-regras', defaultEnabled: true },
        { key: 'sub_op_lojas',  label: 'Lojas',               subTab: 'aop-lojas',  defaultEnabled: true },
      ],
    },
    {
      key: 'adminMovimentacoes', label: 'Movimentações', page: 'adminMovimentacoes',
      defaultEnabled: true,
      submodules: [
        { key: 'sub_mov_extrato', label: 'Extrato de Movimentações', subTab: 'amov-extrato',     defaultEnabled: true },
        { key: 'sub_mov_div',     label: 'Divergências',              subTab: 'amov-divergencias', defaultEnabled: true },
      ],
    },
    {
      key: 'adminRelatorios', label: 'Relatórios', page: 'adminRelatorios',
      defaultEnabled: true,
      submodules: [
        { key: 'sub_rel_fech', label: 'Fechamento por Loja',      card: 'rpt_fech', defaultEnabled: true  },
        { key: 'sub_rel_cons', label: 'Consolidado por Empresa',  card: 'rpt_cons', defaultEnabled: true  },
        { key: 'sub_rel_rep',  label: 'Repasses',                 card: 'rpt_rep',  defaultEnabled: true  },
        { key: 'sub_rel_sai',  label: 'Saídas',                   card: 'rpt_sai',  defaultEnabled: true  },
        { key: 'sub_rel_div',  label: 'Divergências',             card: 'rpt_div',  defaultEnabled: true  },
        { key: 'sub_rel_azul', label: 'Conta Azul',               card: 'rpt_azul', defaultEnabled: false },
        { key: 'sub_rel_aud',  label: 'Auditoria Operacional',    card: 'rpt_aud',  defaultEnabled: false },
      ],
    },
  ],
  operator: [
    { key: 'closing',          label: 'Fechamento Diário', page: 'closing',           defaultEnabled: true,  submodules: [] },
    { key: 'operatorHistory',  label: 'Meu Histórico',     page: 'operatorHistory',   defaultEnabled: true,  submodules: [] },
    { key: 'operatorRulesPage',label: 'Regras da Loja',    page: 'operatorRulesPage', defaultEnabled: false, submodules: [] },
  ],
};

/* Navegação do Master — sempre completa */
const MASTER_NAV = [
  { page: 'dashboard',   label: 'Dashboard'   },
  { page: 'cadastros',   label: 'Cadastros'   },
  { page: 'operacao',    label: 'Operação'    },
  { page: 'fechamentos', label: 'Fechamentos' },
  { page: 'relatorios',  label: 'Relatórios'  },
  { page: 'sistema',     label: 'Sistema'     },
];

/* Alias herdado — mantido para compatibilidade com state.modules antigos */
const PAGE_ALIAS_GROUPS = [];

/* ============================================================
   CONFIG DE MÓDULOS
============================================================ */
function defaultModuleConfig(profile) {
  const base = { status: 'Ativo' };
  const tree = MODULE_TREE[profile] || [];
  tree.forEach((mod) => {
    base[mod.key] = mod.defaultEnabled !== false;
    (mod.submodules || []).forEach((sub) => {
      base[sub.key] = sub.defaultEnabled !== false;
    });
  });
  return base;
}

/* Sem-op: mantido para não quebrar chamadas em db.js */
function syncModuleAliases(cfg) { return cfg; }

function getModuleConfig(companyId, profile) {
  if (!companyId || !window.state) return defaultModuleConfig(profile);
  state.modules[companyId] = state.modules[companyId] || {};
  state.modules[companyId][profile] = {
    ...defaultModuleConfig(profile),
    ...(state.modules[companyId][profile] || {}),
  };
  return state.modules[companyId][profile];
}

/* ============================================================
   VERIFICAÇÃO DE ACESSO
============================================================ */
function isPageAllowed(page) {
  if (role === 'master') return true;
  if (!currentUser) return false;
  const cfg = getModuleConfig(currentUser.companyId, role);
  if ((cfg.status || 'Ativo') === 'Bloqueado') return false;
  const tree = MODULE_TREE[role] || [];
  const mod = tree.find((m) => m.page === page || m.key === page);
  if (!mod) return cfg[page] !== false;
  return cfg[mod.key] !== false;
}

/* Valida acesso a uma sub-aba (por ID do panel) */
function isSubTabAllowed(pageId, tabId) {
  if (role === 'master') return true;
  if (!currentUser) return false;
  if (!isPageAllowed(pageId)) return false;
  const cfg = getModuleConfig(currentUser.companyId, role);
  const tree = MODULE_TREE[role] || [];
  const mod = tree.find((m) => m.page === pageId);
  if (!mod || !mod.submodules.length) return true;
  const sub = mod.submodules.find((s) => s.subTab === tabId);
  if (!sub) return true;
  return cfg[sub.key] !== false;
}

/* Valida acesso a um card de relatório (por ID do card) */
function isCardAllowed(pageId, cardId) {
  if (role === 'master') return true;
  if (!currentUser) return false;
  const cfg = getModuleConfig(currentUser.companyId, role);
  const tree = MODULE_TREE[role] || [];
  const mod = tree.find((m) => m.page === pageId);
  if (!mod) return true;
  const sub = mod.submodules.find((s) => s.card === cardId);
  if (!sub) return true;
  return cfg[sub.key] !== false;
}

function firstAllowedPage() {
  const tree = MODULE_TREE[role] || [];
  const cfg = role !== 'master' ? getModuleConfig(currentUser?.companyId, role) : {};
  if ((cfg.status || 'Ativo') === 'Bloqueado') return null;
  const found = tree.find((m) => cfg[m.key] !== false);
  return found ? found.page : null;
}

/* Retorna a primeira sub-aba permitida de uma página */
function firstAllowedSubTab(pageId) {
  if (role === 'master') return null;
  const cfg = getModuleConfig(currentUser?.companyId, role);
  const tree = MODULE_TREE[role] || [];
  const mod = tree.find((m) => m.page === pageId);
  if (!mod || !mod.submodules.length) return null;
  const sub = mod.submodules.find((s) => s.subTab && cfg[s.key] !== false);
  return sub ? sub.subTab : null;
}

/* ============================================================
   SIDEBAR DINÂMICA
============================================================ */
function renderSidebarByPermissions() {
  const nav = document.querySelector('.nav');
  if (!nav) return;

  if (role === 'master') {
    nav.innerHTML =
      `<div class="nav-title">Gestão 5X</div>` +
      MASTER_NAV.map(({ page, label }) =>
        `<button data-page="${page}" onclick="showPage('${page}',this)">${label}</button>`
      ).join('');
    return;
  }

  const tree = MODULE_TREE[role] || [];
  const cfg = getModuleConfig(currentUser?.companyId, role);
  const isBloqueado = (cfg.status || 'Ativo') === 'Bloqueado';
  const title = role === 'admin' ? 'Cliente' : 'Operador';

  let html = `<div class="nav-title">${title}</div>`;
  let anyVisible = false;

  if (!isBloqueado) {
    tree.forEach((mod) => {
      if (cfg[mod.key] !== false) {
        html += `<button data-page="${mod.page}" onclick="showPage('${mod.page}',this)">${esc(mod.label)}</button>`;
        anyVisible = true;
      }
    });
  }

  if (!anyVisible) {
    html += `<p style="padding:12px;color:#94a3b8;font-size:13px">Nenhum módulo liberado.</p>`;
  }

  nav.innerHTML = html;
}

/* Aplica visibilidade de sub-abas e cards conforme permissões */
function applyModuleAccess() {
  renderSidebarByPermissions();
  if (role === 'master') return;

  /* Ocultar sub-abas sem permissão */
  document.querySelectorAll('.inner-tab-btn[data-subtab]').forEach((btn) => {
    const pageSection = btn.closest('.page');
    if (!pageSection) return;
    const pageId = pageSection.id;
    const tabId  = btn.dataset.subtab;
    btn.style.display = isSubTabAllowed(pageId, tabId) ? '' : 'none';
  });

  /* Ocultar cards de relatório sem permissão */
  document.querySelectorAll('[data-submod-card]').forEach((el) => {
    const pageSection = el.closest('.page');
    const pageId = pageSection?.id;
    const cardSubmodKey = el.dataset.submodCard;
    if (!pageId || !cardSubmodKey) return;
    const cfg = getModuleConfig(currentUser?.companyId, role);
    el.style.display = cfg[cardSubmodKey] !== false ? '' : 'none';
  });
}

/* ============================================================
   NAVEGAÇÃO SEGURA
============================================================ */
const PAGE_TITLES = {
  dashboard:   ['Dashboard Gestão 5X', 'Visão executiva de todas as empresas.'],
  cadastros:   ['Cadastros', 'Empresas, lojas, usuários e implantação.'],
  operacao:    ['Operação', 'Regras, configurações e módulos por empresa.'],
  fechamentos: ['Fechamentos', 'Movimentações, extrato e divergências.'],
  relatorios:  ['Relatórios', 'Exportações gerenciais e operacionais.'],
  sistema:     ['Sistema', 'Configurações, backup e logs de auditoria.'],
  adminDashboard:     ['Dashboard da Empresa', 'Métricas e resumo operacional.'],
  adminFechamento:    ['Fechamento', 'Registro e histórico de fechamentos.'],
  adminOperacao:      ['Operação', 'Regras, lojas e configurações.'],
  adminMovimentacoes: ['Movimentações', 'Entradas, saídas, repasses e divergências.'],
  adminRelatorios:    ['Relatórios', 'Exportações da empresa.'],
  closing:          ['Fechamento Diário', 'Registro de entradas, saídas e repasse.'],
  operatorHistory:  ['Meu Histórico', 'Seus fechamentos anteriores.'],
  operatorRulesPage:['Regras da Loja', 'Regras operacionais para este caixa.'],
};

function showPage(id, btn) {
  /* Proteção dupla — bloqueia mesmo chamada via console */
  if (role !== 'master') {
    if (!currentUser) { if (window.logout) logout(); return; }
    if (!isPageAllowed(id)) {
      const allowed = firstAllowedPage();
      if (!allowed) {
        alert('Você não possui permissão para acessar este módulo.');
        if (window.logout) logout();
        return;
      }
      id = allowed; btn = null;
    }
  }

  all('.page').forEach((p) => p.classList.add('hidden'));
  $(id)?.classList.remove('hidden');

  document.querySelectorAll('.nav button').forEach((b) => b.classList.remove('active'));
  if (btn) {
    btn.classList.add('active');
  } else {
    document.querySelector(`.nav button[data-page="${id}"]`)?.classList.add('active');
  }

  const [title, subtitle] = PAGE_TITLES[id] || [id, ''];
  text('pageTitle', title);
  text('pageSub', subtitle);
  text('sideSub', subtitle);

  /* Aplicar visibilidade de sub-abas */
  applyModuleAccess();

  /* Navegar para a primeira sub-aba permitida */
  if (role !== 'master') {
    const firstTab = firstAllowedSubTab(id);
    if (firstTab) {
      const pageEl = $(id);
      const tabBtn = pageEl?.querySelector(`.inner-tab-btn[data-subtab="${firstTab}"]`);
      if (tabBtn) showSubTab(id, firstTab, tabBtn);
    }
  }

  if (window.closeSidebar) closeSidebar();
  if (window.resetSessionTimer) resetSessionTimer();
  if (window.renderAll) renderAll();
}

/* Sub-aba com proteção dupla — registra referência para utils.js usar */
function showSubTab(pageId, tabId, btn) {
  window._safeShowSubTab = showSubTab; // permite utils.js delegar para cá
  if (role !== 'master' && !isSubTabAllowed(pageId, tabId)) {
    alert('Você não possui permissão para acessar este módulo.');
    return;
  }
  const page = $(pageId);
  if (!page) return;
  page.querySelectorAll('.inner-tab-panel').forEach((p) => p.classList.add('hidden'));
  $(tabId)?.classList.remove('hidden');
  page.querySelectorAll('.inner-tab-btn').forEach((b) => b.classList.remove('active'));
  btn?.classList.add('active');
}

function setupMenu() {
  text('profileChip',
    role === 'master' ? 'Perfil: Gestão 5X'
    : role === 'admin' ? 'Perfil: Administrador Cliente'
    : 'Perfil: Operador'
  );
  text('userName', currentUser?.name || '-');
  text('userAccess',
    role === 'master' ? 'Todas as empresas'
    : role === 'admin' ? (window.companyName ? companyName(currentUser?.companyId) : '-')
    : (window.storeName ? storeName(currentUser?.storeId) : '-')
  );
  renderSidebarByPermissions();
}

function toggleSidebar() {
  if (window.innerWidth <= 1100) {
    document.querySelector('.sidebar')?.classList.toggle('open');
    $('sidebarOverlay')?.classList.toggle('visible');
  } else {
    document.querySelector('.app')?.classList.toggle('sidebar-collapsed');
  }
}

function closeSidebar() {
  document.querySelector('.sidebar')?.classList.remove('open');
  $('sidebarOverlay')?.classList.remove('visible');
}

/* Gerenciador de módulos — lógica pai/filho */
function onParentModuleChange(checkbox) {
  const enabled = checkbox.checked;
  const group = checkbox.closest('.module-group');
  const children = group?.querySelector('.module-children');
  if (children) {
    children.style.display = enabled ? '' : 'none';
    if (!enabled) {
      children.querySelectorAll('input[type="checkbox"]').forEach((ch) => {
        ch.checked = false;
      });
    }
  }
  draftModules();
}

function draftModules() {
  const cid = val('moduleCompany');
  if (!cid) return;
  const profile = val('moduleProfile') || 'admin';
  const config = getModuleConfig(cid, profile);
  config.status = val('moduleAccessStatus') || 'Ativo';

  /* Lê todos os checkboxes de módulo */
  document.querySelectorAll('#moduleManager [data-module-key]').forEach((inp) => {
    config[inp.dataset.moduleKey] = inp.checked;
  });

  /* Consistência pai → filho: pai desmarcado derruba filhos */
  const tree = MODULE_TREE[profile] || [];
  tree.forEach((mod) => {
    if (!config[mod.key]) {
      (mod.submodules || []).forEach((sub) => { config[sub.key] = false; });
    }
    /* Filho marcado → pai marcado automaticamente */
    const anyChild = (mod.submodules || []).some((sub) => config[sub.key]);
    if (anyChild) config[mod.key] = true;
  });

  if (window.autosave) autosave();
  applyModuleAccess();
}

function saveModules() {
  draftModules();
  const cid = val('moduleCompany');
  const profile = val('moduleProfile') || 'admin';
  if (window.saveModulePermissions && cid && window.state?.modules?.[cid]?.[profile]) {
    saveModulePermissions(cid, profile, state.modules[cid][profile]).catch((e) => alert(`Erro ao salvar permissões no Supabase: ${e.message}`));
  }
  if (window.save) save();
  if (window.renderAll) renderAll();
  alert('Módulos atualizados. As permissões entrarão em vigor imediatamente.');
}

/* Exportação global */
Object.assign(window, {
  MODULE_TREE, MASTER_NAV, PAGE_ALIAS_GROUPS, PAGE_TITLES,
  defaultModuleConfig, syncModuleAliases, getModuleConfig,
  isPageAllowed, isSubTabAllowed, isCardAllowed,
  firstAllowedPage, firstAllowedSubTab,
  renderSidebarByPermissions, applyModuleAccess,
  showPage, showSubTab, setupMenu,
  toggleSidebar, closeSidebar,
  onParentModuleChange, draftModules, saveModules,
});
