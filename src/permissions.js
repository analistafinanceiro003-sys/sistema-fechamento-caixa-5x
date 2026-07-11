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
        { key: 'sub_mov_extrato',   label: 'Extrato de Movimentações', subTab: 'amov-extrato',      defaultEnabled: true },
        { key: 'sub_mov_repasses',  label: 'Repasses Recebidos',       subTab: 'amov-repasses',     defaultEnabled: true },
        { key: 'sub_mov_div',       label: 'Divergências',             subTab: 'amov-divergencias', defaultEnabled: true },
        { key: 'sub_mov_docs',      label: 'Documentos',               subTab: 'amov-documentos',   defaultEnabled: true },
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
    { key: 'closing',             label: 'Fechamento Diário', page: 'closing',             defaultEnabled: true,  submodules: [] },
    { key: 'operatorHistory',     label: 'Meu Histórico',     page: 'operatorHistory',     defaultEnabled: true,  submodules: [] },
    { key: 'operatorDocumentos',  label: 'Documentos',         page: 'operatorDocumentos',  defaultEnabled: true,  submodules: [] },
    { key: 'operatorRulesPage',   label: 'Regras da Loja',    page: 'operatorRulesPage',   defaultEnabled: false, submodules: [] },
  ],
};

/* Ícones SVG para cada página da sidebar */
const NAV_ICONS = {
  dashboard:        `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>`,
  cadastros:        `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  operacao:         `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  fechamentos:      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
  relatorios:       `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
  sistema:          `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  adminDashboard:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>`,
  adminFechamento:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  adminOperacao:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  adminMovimentacoes:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`,
  adminRelatorios:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
  closing:          `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  operatorHistory:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  operatorRulesPage:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
  operatorDocumentos:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
};

/* Navegação do Master — sempre completa */
const MASTER_NAV = [
  { page: 'dashboard',        label: 'Dashboard'    },
  { page: 'cadastros',        label: 'Cadastros'    },
  { page: 'operacao',         label: 'Operação'     },
  { page: 'fechamentos',      label: 'Fechamentos & Clientes' },
  { page: 'relatorios',       label: 'Relatórios'   },
  { page: 'sistema',          label: 'Sistema'      },
];

/* Grupo de páginas irmãs acessadas a partir do item "Fechamentos & Clientes":
   Fechamentos (visão global), Fechamento Manual (mesma tela do operador) e
   Op. Cliente (Regras/Lojas por empresa — mesma tela do módulo Operação do Admin).
   Cada uma continua sendo sua própria <section id="..."> porque é reaproveitada
   por outros perfis (operator/admin); aqui só trocamos entre elas via showPage. */
const MASTER_OPS_GROUP = [
  { page: 'fechamentos',   label: 'Fechamentos' },
  { page: 'closing',       label: 'Fechamento Manual' },
  { page: 'adminOperacao', label: 'Op. Cliente' },
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

/* Mescla config salva com defaults sem auto-liberar módulos novos para empresas existentes.
   Empresas sem config alguma recebem defaultEnabled; empresas com config existente recebem
   false para qualquer chave nova (não habilitam módulo sem aprovação explícita). */
function mergeModuleConfig(profile, stored) {
  const defaults = defaultModuleConfig(profile);
  const hasExistingKeys = stored && Object.keys(stored).some((k) => k !== 'status');
  if (!hasExistingKeys) {
    return { ...defaults };
  }
  const result = { status: stored.status || defaults.status };
  Object.keys(defaults).forEach((key) => {
    if (key === 'status') return;
    result[key] = key in stored ? stored[key] : defaults[key];
  });
  return result;
}

function getModuleConfig(companyId, profile) {
  if (!companyId || !window.state) return defaultModuleConfig(profile);
  state.modules[companyId] = state.modules[companyId] || {};
  state.modules[companyId][profile] = mergeModuleConfig(profile, state.modules[companyId][profile]);
  return state.modules[companyId][profile];
}

/* ============================================================
   VERIFICAÇÃO DE ACESSO
============================================================ */
function isPageAllowed(page) {
  if (role === 'master') return true;
  /* Analista: mesmo acesso do Master, exceto a página Sistema. */
  if (role === 'analyst') return page !== 'sistema';
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
  if (role === 'analyst') return 'dashboard';
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
/* Página cujo botão deve aparecer marcado como ativo na sidebar.
   Guardada à parte porque renderSidebarByPermissions() reconstrói o
   <nav> inteiro (nav.innerHTML = ...) toda vez que roda — inclusive
   dentro de applyModuleAccess(), chamado a cada showPage() — então
   qualquer classList.add('active') feito antes dela é perdido se não
   for reaplicado depois da reconstrução. */
let activeSidebarPage = null;

function renderSidebarByPermissions() {
  const nav = document.querySelector('.nav');
  if (!nav) return;

  const navBtn = (page, label) => {
    const icon = NAV_ICONS[page] ? `<span class="nav-icon">${NAV_ICONS[page]}</span>` : '';
    const active = page === activeSidebarPage ? ' active' : '';
    return `<button class="${active.trim()}" data-page="${page}" onclick="showPage('${page}',this)">${icon}<span class="nav-label">${label}</span></button>`;
  };

  if (role === 'master') {
    nav.innerHTML =
      `<div class="nav-title">Gestão 5X</div>` +
      MASTER_NAV.map(({ page, label }) => navBtn(page, label)).join('');
    return;
  }

  if (role === 'analyst') {
    nav.innerHTML =
      `<div class="nav-title">Analista</div>` +
      MASTER_NAV.filter((m) => m.page !== 'sistema').map(({ page, label }) => navBtn(page, label)).join('');
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
        html += navBtn(mod.page, esc(mod.label));
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
  if (role === 'master' || role === 'analyst') return;

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
  fechamentos: ['Fechamentos & Clientes', 'Movimentações globais, fechamento manual e operação por cliente.'],
  relatorios:  ['Relatórios', 'Exportações gerenciais e operacionais.'],
  sistema:     ['Sistema', 'Configurações, backup e logs de auditoria.'],
  adminDashboard:     ['Dashboard da Empresa', 'Métricas e resumo operacional.'],
  adminFechamento:    ['Fechamento', 'Registro e histórico de fechamentos.'],
  adminOperacao:      ['Operação', 'Regras, lojas e configurações.'],
  adminMovimentacoes: ['Movimentações', 'Entradas, saídas, repasses e divergências.'],
  adminRelatorios:    ['Relatórios', 'Exportações da empresa.'],
  closing:             ['Fechamento Diário', 'Registro de entradas, saídas e repasse.'],
  operatorHistory:     ['Meu Histórico', 'Seus fechamentos anteriores.'],
  operatorDocumentos:  ['Documentos', 'Envie fotos, comprovantes e arquivos para a pasta da sua loja.'],
  operatorRulesPage:   ['Regras da Loja', 'Regras operacionais para este caixa.'],
};

/* Insere/atualiza a faixa de troca entre Fechamentos / Fechamento Manual / Op. Cliente
   no topo da página ativa — exclusivo do Master, só aparece quando uma das 3 páginas do
   grupo está em exibição. */
function renderMasterOpsGroupNav(activeId) {
  document.querySelectorAll('.master-ops-group-nav').forEach((el) => el.remove());
  if ((role !== 'master' && role !== 'analyst') || !MASTER_OPS_GROUP.some((g) => g.page === activeId)) return;
  const section = $(activeId);
  if (!section) return;
  const bar = document.createElement('div');
  bar.className = 'inner-tabs master-ops-group-nav';
  bar.innerHTML = MASTER_OPS_GROUP.map(({ page, label }) => {
    const active = page === activeId ? ' active' : '';
    return `<button class="inner-tab-btn${active}" onclick="showPage('${page}')">${label}</button>`;
  }).join('');
  section.insertBefore(bar, section.firstChild);
}

function showPage(id) {
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
      id = allowed;
    }
  }

  all('.page').forEach((p) => p.classList.add('hidden'));
  $(id)?.classList.remove('hidden');
  renderMasterOpsGroupNav(id);

  /* Páginas do grupo Fechamentos/Fechamento Manual/Op. Cliente marcam o
     mesmo botão "Fechamentos & Clientes" como ativo na sidebar. */
  activeSidebarPage = MASTER_OPS_GROUP.some((g) => g.page === id) ? 'fechamentos' : id;

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
  /* :scope > evita afetar sub-abas aninhadas (ex.: Manual 5X dentro de Sistema) */
  page.querySelectorAll(':scope > .inner-tab-panel').forEach((p) => p.classList.add('hidden'));
  $(tabId)?.classList.remove('hidden');
  page.querySelectorAll(':scope > .inner-tabs > .inner-tab-btn').forEach((b) => b.classList.remove('active'));
  btn?.classList.add('active');
}

function setupMenu() {
  text('profileChip',
    role === 'master' ? 'Perfil: Gestão 5X'
    : role === 'analyst' ? 'Perfil: Analista'
    : role === 'admin' ? 'Perfil: Administrador Cliente'
    : 'Perfil: Operador'
  );
  text('userName', currentUser?.name || '-');
  text('userAccess',
    role === 'master' ? 'Todas as empresas'
    : role === 'analyst' ? (window.visibleCompanies ? `${visibleCompanies().length} empresa(s)` : '-')
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
    const app = document.querySelector('.app');
    if (!app) return;
    /* alterna entre compacto-hover e totalmente expandido */
    app.classList.toggle('sidebar-hover');
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

async function saveModules() {
  draftModules();
  const cid = val('moduleCompany');
  const profile = val('moduleProfile') || 'admin';
  if (window.saveModulePermissions && cid && window.state?.modules?.[cid]?.[profile]) {
    try {
      await saveModulePermissions(cid, profile, state.modules[cid][profile]);
    } catch (e) {
      return alert(`Erro ao salvar permissões no Supabase: ${e.message}`);
    }
  }
  if (window.save) save();
  if (window.renderAll) renderAll();
  toast('Módulos atualizados. As permissões entrarão em vigor imediatamente.');
}

/* Exportação global */
Object.assign(window, {
  MODULE_TREE, MASTER_NAV, MASTER_OPS_GROUP, PAGE_ALIAS_GROUPS, PAGE_TITLES, NAV_ICONS,
  defaultModuleConfig, syncModuleAliases, mergeModuleConfig, getModuleConfig,
  isPageAllowed, isSubTabAllowed, isCardAllowed,
  firstAllowedPage, firstAllowedSubTab,
  renderSidebarByPermissions, applyModuleAccess, renderMasterOpsGroupNav,
  showPage, showSubTab, setupMenu,
  toggleSidebar, closeSidebar,
  onParentModuleChange, draftModules, saveModules,
});
