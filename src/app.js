/*
  Central de Caixa 5X — versão refatorada para VS Code
  Objetivo: substituir o JS monolítico/duplicado por um núcleo único, legível e estável.
  Regras preservadas:
  - Master vê tudo.
  - ADM Cliente vê apenas a empresa vinculada e os módulos liberados pela Gestão 5X.
  - Operador vê apenas a loja vinculada e os módulos liberados pela Gestão 5X.
  - Fechamento 5X: saldo inicial + entradas - saídas = saldo em caixa antes do repasse.
  - Saldo final após repasse = saldo em caixa - repasse.
  - Divergência = saldo final após repasse - fundo padrão da loja.
*/

'use strict';

/* =========================
   CONFIGURAÇÃO
========================= */
const SUPABASE_URL = 'https://dqpcrodjrvygvhkvlfed.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxcGNyb2RqcnZ5Z3Zoa3ZsZmVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5ODUxNTAsImV4cCI6MjA5NTU2MTE1MH0.68v9pkMVl3fBdMyDbDtf-OBW_hGm3e1eYSI67MasMCA';
const STORAGE_KEY = 'caixa5x_refatorado_v1';

const sb = window.supabase?.createClient ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

let state = null;
let role = 'master';
let currentUser = null;
let closingAttachments = [];
let saveTimer = null;
let realtimeChannel = null;
let lastOwnSave = 0;
let isBooting = true;

const DEMO = {
  master: { user: 'gestao5x@gestao5x.com.br', pass: '123456' },
  admin: { user: 'admin@cliente.com', pass: '123456' },
  operator: { user: 'operador@cliente.com', pass: '123456' },
};

const CENTRAL_TABS = {
  'central-cadastro': 'Cadastro',
  'central-implantacao': 'Implantação',
  'central-operacao': 'Operação',
  'central-resumo': 'Resumo',
};

const PAGE_TITLES = {
  central: ['Central Gestão 5X', 'Implantação, cadastros, regras e governança operacional.'],
  companies: ['Empresas', 'Cadastro e controle dos clientes.'],
  stores: ['Lojas e Caixas', 'Estrutura de fechamento por loja, caixa ou turno.'],
  users: ['Usuários e Acessos', 'Administradores e operadores vinculados.'],
  rules: ['Regras Operacionais', 'Padrões que reduzem erro e divergência no fechamento.'],
  movements: ['Movimentações', 'Base de fechamentos salvos.'],
  masterMovementsExtract: ['Extrato de Movimentações', 'Entradas, saídas e repasses em visão gerencial.'],
  divergences: ['Divergências', 'Leitura operacional das diferenças de caixa.'],
  reports: ['Relatórios', 'Exportações gerenciais e operacionais.'],
  modules: ['Módulos por Cliente', 'Liberação de acesso gerencial por empresa.'],
  settings: ['Configurações', 'Opções, cadastros e manutenção gerencial.'],
  maintenance: ['Backup e Manutenção', 'Segurança e manutenção da base.'],
  adminOverview: ['Visão da Empresa', 'Resumo executivo da operação do cliente.'],
  adminStores: ['Lojas', 'Lojas e caixas da empresa.'],
  adminRules: ['Regras', 'Padrões operacionais cadastrados pela Gestão 5X.'],
  adminClosing: ['Cadastro de Fechamento', 'Acesso opcional ao fechamento diário.'],
  adminMovements: ['Movimentações', 'Extrato operacional por loja.'],
  adminDivergences: ['Divergências', 'Revisão de diferenças de caixa.'],
  adminReports: ['Relatórios', 'Relatórios da empresa.'],
  closing: ['Fechamento Diário', 'Registro diário de entradas, saídas, repasse e divergência.'],
  operatorHistory: ['Meu Histórico', 'Fechamentos realizados pelo operador.'],
};

const MODULES = {
  admin: [
    ['adminOverview', 'Visão da Empresa', 'Dashboard das lojas e indicadores principais.'],
    ['adminStores', 'Lojas', 'Consulta das lojas vinculadas à empresa.'],
    ['adminRules', 'Regras', 'Regras operacionais da empresa.'],
    ['adminClosing', 'Cadastro de Fechamento', 'Permite que o ADM Cliente registre fechamento.'],
    ['adminMovements', 'Movimentações', 'Consulta de entradas, saídas e repasses.'],
    ['adminDivergences', 'Divergências', 'Consulta e revisão de divergências.'],
    ['adminReports', 'Relatórios', 'Exportações da empresa.'],
    ['reportMovements', 'Relatório de Movimentações', 'Card de relatório dentro da aba Relatórios.'],
    ['reportDivergences', 'Relatório de Divergências', 'Card de divergências dentro da aba Relatórios.'],
  ],
  operator: [
    ['closing', 'Fechamento Diário', 'Lançamento diário do caixa.'],
    ['operatorHistory', 'Meu Histórico', 'Histórico do operador.'],
  ],
};

const PAGE_ALIAS_GROUPS = [
  ['adminClosing', 'closing'],
  ['adminStores', 'stores'],
  ['adminRules', 'rules'],
  ['adminMovements', 'movements'],
  ['adminDivergences', 'divergences'],
  ['adminReports', 'reports'],
];

/* =========================
   UTILITÁRIOS
========================= */
const $ = (id) => document.getElementById(id);
const all = (sel, root = document) => [...root.querySelectorAll(sel)];
const val = (id) => $(id)?.value ?? '';
const setVal = (id, value) => { const el = $(id); if (el) el.value = value ?? ''; };
const html = (id, value) => { const el = $(id); if (el) el.innerHTML = value ?? ''; };
const text = (id, value) => { const el = $(id); if (el) el.textContent = value ?? ''; };
const clear = (id) => setVal(id, '');
const num = (id) => Number(String(val(id)).replace(',', '.')) || 0;
const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const todayISO = () => new Date().toISOString().slice(0, 10);
const todayBR = () => new Date().toLocaleDateString('pt-BR');
const uid = (prefix) => `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const parseBR = (date) => {
  if (!date) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const [d, m, y] = String(date).split('/');
  return y && m && d ? `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` : '';
};
const toBRFromISO = (date) => date ? new Date(`${date}T00:00:00`).toLocaleDateString('pt-BR') : todayBR();
const emptyRow = (cols, msg = 'Nenhum registro encontrado.') => `<tr><td colspan="${cols}" class="subtle">${msg}</td></tr>`;
const tag = (value) => {
  const s = String(value || '-');
  const cls = /crítica|inativo|reprovado/i.test(s) ? 'danger' : /divergência|pendente|implantação|pausada/i.test(s) ? 'warning' : /ativo|concluído|sem divergência|tolerância/i.test(s) ? 'success' : 'info';
  return `<span class="status ${cls}">${esc(s)}</span>`;
};

function flash(message = 'Salvo') {
  text('autosaveStatus', message);
  setTimeout(() => text('autosaveStatus', 'Autosave ativo'), 1400);
}

function downloadFile(filename, content, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvCell(v) {
  const s = String(v ?? '').replace(/"/g, '""');
  return `"${s}"`;
}
function csv(headers, rows) {
  const lines = [headers.map(csvCell).join(';')];
  rows.forEach((r) => lines.push(headers.map((h) => csvCell(r[h])).join(';')));
  return `\ufeff${lines.join('\n')}`;
}

/* =========================
   ESTADO
========================= */
function defaultSelectOptions() {
  return {
    segments: ['Restaurante / Hamburgueria', 'Padaria', 'Varejo', 'Serviços', 'Indústria', 'Outro'],
    plans: ['Operacional', 'Controladoria', 'Premium 5X'],
    companyStatus: ['Implantação', 'Ativa', 'Pausada', 'Inativa'],
    cashTypes: ['Caixa diário', 'Caixa por turno', 'Caixa central', 'Caixa delivery'],
    operationModes: ['Diário', 'Por turno', 'Por operador'],
    ruleTypes: ['Saída permitida', 'Repasse', 'Conferência', 'Divergência', 'Checklist'],
    shifts: ['Dia completo', 'Manhã', 'Tarde', 'Noite'],
    implantSteps: ['1. Cadastro da empresa', '2. Cadastro de lojas/caixas', '3. Cadastro de operadores', '4. Regras de caixa', '5. Treinamento', '6. Início monitorado'],
    implantStatus: ['Pendente', 'Em andamento', 'Concluído'],
    expenseCategories: ['Ajuda de custo', 'Taxa de entrega', 'Compra de mercadoria', 'Outras saídas'],
  };
}

function defaultModuleConfig(profile) {
  const base = { status: 'Ativo' };
  (MODULES[profile] || []).forEach(([key]) => { base[key] = true; });
  if (profile === 'admin') base.adminClosing = false;
  return base;
}

function defaultState() {
  return {
    companies: [{ id: 'demo', name: 'Cliente Demonstração', legal: 'Cliente Demonstração LTDA', cnpj: '00.000.000/0001-00', segment: 'Restaurante / Hamburgueria', plan: 'Premium 5X', status: 'Ativa', notes: 'Base demonstrativa' }],
    stores: [{ id: 'demo_store', companyId: 'demo', name: 'Loja 01', code: 'LJ01', cashType: 'Caixa diário', standardFund: 100, status: 'Ativa' }],
    users: [
      { id: 'u_admin', companyId: 'demo', storeId: null, name: 'ADM Cliente', login: 'admin@cliente.com', pass: '123456', role: 'admin', status: 'Ativo' },
      { id: 'u_op', companyId: 'demo', storeId: 'demo_store', name: 'Operador', login: 'operador@cliente.com', pass: '123456', role: 'operator', status: 'Ativo' },
    ],
    rules: [
      { id: 'r1', companyId: 'demo', type: 'Saída permitida', text: 'Saídas do caixa somente para ajuda de custo, taxa de entrega e compra emergencial de mercadoria.' },
      { id: 'r2', companyId: 'demo', type: 'Repasse', text: 'Todo valor entregue ao responsável deve ser informado no campo Repasse / entregue.' },
    ],
    closings: [],
    implant: [],
    operationConfigs: { demo: { tolerance: 5, criticalDivergence: 50, mode: 'Diário', receiver: 'Responsável financeiro', allowed: 'Ajuda de custo, taxa de entrega e compra emergencial.', message: 'Registrar saídas com descrição clara.' } },
    modules: { demo: { admin: { ...defaultModuleConfig('admin'), adminClosing: false }, operator: defaultModuleConfig('operator') } },
    selectOptions: defaultSelectOptions(),
    audit: [],
  };
}

function normalizeState() {
  state = state && typeof state === 'object' ? state : defaultState();
  ['companies', 'stores', 'users', 'rules', 'closings', 'implant', 'audit'].forEach((k) => { if (!Array.isArray(state[k])) state[k] = []; });
  state.operationConfigs = state.operationConfigs && typeof state.operationConfigs === 'object' ? state.operationConfigs : {};
  state.modules = state.modules && typeof state.modules === 'object' ? state.modules : {};
  state.selectOptions = { ...defaultSelectOptions(), ...(state.selectOptions || {}) };

  state.stores.forEach((s) => { s.standardFund = Number(s.standardFund || 0); });
  state.companies.forEach((c) => {
    if (!state.operationConfigs[c.id]) state.operationConfigs[c.id] = { tolerance: 5, criticalDivergence: 50, mode: 'Diário', receiver: '', allowed: '', message: '' };
    if (!state.modules[c.id]) state.modules[c.id] = {};
    state.modules[c.id].admin = { ...defaultModuleConfig('admin'), ...(state.modules[c.id].admin || {}) };
    state.modules[c.id].operator = { ...defaultModuleConfig('operator'), ...(state.modules[c.id].operator || {}) };
    syncModuleAliases(state.modules[c.id].admin);
    syncModuleAliases(state.modules[c.id].operator);
  });
}

async function load() {
  try {
    if (sb) {
      const { data, error } = await sb.from('app_state').select('data').eq('id', 'global').maybeSingle();
      if (error) throw error;
      if (data?.data && Object.keys(data.data).length) state = data.data;
    }
    if (!state) state = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || defaultState();
  } catch (error) {
    console.warn('Usando localStorage:', error);
    state = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || defaultState();
  }
  normalizeState();
}

function save() {
  normalizeState();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  lastOwnSave = Date.now();
  if (sb) {
    sb.from('app_state').upsert({ id: 'global', data: state, updated_at: new Date().toISOString() }).catch((e) => console.warn('Supabase save:', e));
  }
  flash('Salvo');
}

function autosave() {
  if (isBooting) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 500);
}

function addAudit(action, detail = '') {
  state.audit.push({ id: uid('audit'), date: new Date().toISOString(), user: currentUser?.name || 'Sistema', role, action, detail });
}

/* =========================
   SUPABASE REALTIME
========================= */
function setupRealtimeSync() {
  if (!sb || realtimeChannel) return;
  realtimeChannel = sb.channel('caixa5x-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_state' }, (payload) => {
      if (Date.now() - lastOwnSave < 1500) return;
      if (payload.new?.data) {
        state = payload.new.data;
        normalizeState();
        renderAll();
        flash('Atualizado');
      }
    })
    .subscribe((status) => text('realtimeStatus', status === 'SUBSCRIBED' ? '● Ao vivo' : '○ Local'));
}
function stopRealtimeSync() {
  if (sb && realtimeChannel) sb.removeChannel(realtimeChannel);
  realtimeChannel = null;
}
async function manualRefresh() {
  await load();
  renderAll();
  flash('Dados atualizados');
}

/* =========================
   ACESSO E PERMISSÕES
========================= */
function getModuleConfig(companyId, profile = role) {
  if (!companyId) return defaultModuleConfig(profile);
  state.modules[companyId] = state.modules[companyId] || {};
  state.modules[companyId][profile] = { ...defaultModuleConfig(profile), ...(state.modules[companyId][profile] || {}) };
  syncModuleAliases(state.modules[companyId][profile]);
  return state.modules[companyId][profile];
}

function aliasKeys(page) {
  const group = PAGE_ALIAS_GROUPS.find((g) => g.includes(page));
  return group || [page];
}
function syncModuleAliases(cfg) {
  PAGE_ALIAS_GROUPS.forEach((group) => {
    const blocked = group.some((k) => cfg[k] === false);
    const allowed = group.some((k) => cfg[k] === true);
    if (blocked) group.forEach((k) => { if (k in cfg) cfg[k] = false; });
    else if (allowed) group.forEach((k) => { if (k in cfg) cfg[k] = true; });
  });
  return cfg;
}
function isPageAllowed(page) {
  if (role === 'master') return true;
  const cfg = getModuleConfig(currentUser?.companyId, role);
  if ((cfg.status || 'Ativo') === 'Bloqueado') return false;
  return !aliasKeys(page).some((k) => cfg[k] === false);
}
function firstAllowedPage() {
  const pages = role === 'admin'
    ? ['adminOverview', 'adminStores', 'adminRules', 'adminClosing', 'adminMovements', 'adminDivergences', 'adminReports']
    : ['closing', 'operatorHistory'];
  return pages.find(isPageAllowed);
}

function enterApp() {
  const selectedRole = val('profile') || 'master';
  const login = val('loginUser').trim().toLowerCase();
  const pass = val('loginPass').trim();
  let user = null;

  if (DEMO[selectedRole] && login === DEMO[selectedRole].user && pass === DEMO[selectedRole].pass) {
    user = { id: `demo_${selectedRole}`, role: selectedRole, companyId: selectedRole === 'master' ? null : 'demo', storeId: selectedRole === 'operator' ? 'demo_store' : null, name: selectedRole === 'master' ? 'Gestão 5X Master' : selectedRole === 'admin' ? 'ADM Cliente' : 'Operador' };
  } else {
    user = state.users.find((u) => String(u.login).toLowerCase() === login && String(u.pass) === pass && u.role === selectedRole && u.status !== 'Inativo');
  }

  if (!user) {
    $('loginError')?.classList.add('show');
    return;
  }

  $('loginError')?.classList.remove('show');
  role = selectedRole;
  currentUser = user;
  if ($('rememberBox')?.checked) localStorage.setItem('caixa5x_remember', login);

  $('loginScreen').style.display = 'none';
  $('app').style.display = 'grid';
  const mobileBtn = $('mobileMenuBtn');
  if (mobileBtn) mobileBtn.style.display = 'flex';

  setupMenu();
  setupRealtimeSync();
  renderAll();

  const page = role === 'master' ? 'central' : firstAllowedPage();
  if (!page) {
    alert('Nenhum módulo liberado para este perfil.');
    logout();
    return;
  }
  showPage(page, document.querySelector(`.nav button[data-role="${role}"]`));
}

function logout() {
  stopRealtimeSync();
  currentUser = null;
  $('app').style.display = 'none';
  $('loginScreen').style.display = 'grid';
  const mobileBtn = $('mobileMenuBtn');
  if (mobileBtn) mobileBtn.style.display = 'none';
  closeSidebar();
}

function setupMenu() {
  all('[data-role]').forEach((el) => { el.style.display = el.dataset.role === role ? 'block' : 'none'; });
  text('profileChip', role === 'master' ? 'Perfil: Gestão 5X' : role === 'admin' ? 'Perfil: Administrador Cliente' : 'Perfil: Operador');
  text('userName', currentUser?.name || '-');
  text('userAccess', role === 'master' ? 'Todas as empresas' : role === 'admin' ? companyName(currentUser?.companyId) : storeName(currentUser?.storeId));
  applyModuleAccess();
}
function applyModuleAccess() {
  if (role === 'master') return;
  all(`.nav button[data-role="${role}"]`).forEach((btn) => {
    const match = (btn.getAttribute('onclick') || '').match(/showPage\('([^']+)'/);
    const page = match?.[1];
    btn.style.display = page && isPageAllowed(page) ? 'block' : 'none';
  });
  ['clientReportMovements', 'clientReportDivergences'].forEach((id) => {
    const el = $(id); if (!el) return;
    const key = id === 'clientReportMovements' ? 'reportMovements' : 'reportDivergences';
    const cfg = getModuleConfig(currentUser?.companyId, 'admin');
    el.style.display = cfg[key] === false ? 'none' : '';
  });
}

function showPage(id, btn) {
  if (role !== 'master' && !isPageAllowed(id)) {
    const page = firstAllowedPage();
    if (!page) return alert('Acesso bloqueado pela Gestão 5X.');
    return showPage(page);
  }
  all('.page').forEach((p) => p.classList.add('hidden'));
  $(id)?.classList.remove('hidden');
  all('.nav button').forEach((b) => b.classList.remove('active'));
  btn?.classList.add('active');
  const [title, subtitle] = PAGE_TITLES[id] || [id, ''];
  text('pageTitle', title); text('pageSub', subtitle); text('sideSub', subtitle);
  closeSidebar();
  renderAll();
}
function toggleSidebar() { document.querySelector('.sidebar')?.classList.toggle('open'); $('sidebarOverlay')?.classList.toggle('visible'); }
function closeSidebar() { document.querySelector('.sidebar')?.classList.remove('open'); $('sidebarOverlay')?.classList.remove('visible'); }
function switchCentral(tabId) {
  all('.central-tab').forEach((t) => t.classList.add('hidden'));
  $(tabId)?.classList.remove('hidden');
  all('.tab-btn').forEach((b) => b.classList.remove('active'));
  const btn = all('.tab-btn').find((b) => (b.getAttribute('onclick') || '').includes(tabId));
  btn?.classList.add('active');
}
function togglePassword() { const e = $('loginPass'); if (e) e.type = e.type === 'password' ? 'text' : 'password'; }
function toggleRemember() { if ($('rememberBox')?.checked) localStorage.setItem('caixa5x_remember', val('loginUser')); else localStorage.removeItem('caixa5x_remember'); }
function forgotPassword() { alert('Solicite o reset de senha para a Gestão 5X.'); }
function openSupport() { window.open('https://wa.me/', '_blank'); }

/* =========================
   NOMES E ESCOPO
========================= */
function companyName(id) { return state.companies.find((c) => c.id === id)?.name || '-'; }
function storeName(id) { return state.stores.find((s) => s.id === id)?.name || '-'; }
function visibleCompanies() { return role === 'master' ? state.companies : state.companies.filter((c) => c.id === currentUser?.companyId); }
function visibleStores() {
  if (role === 'master') return state.stores;
  if (role === 'admin') return state.stores.filter((s) => s.companyId === currentUser?.companyId);
  return state.stores.filter((s) => s.id === currentUser?.storeId);
}
function cfg(companyId) { return { tolerance: 5, criticalDivergence: 50, mode: 'Diário', receiver: '', allowed: '', message: '', ...(state.operationConfigs[companyId] || {}) }; }

/* =========================
   UI DINÂMICA/COMPATIBILIDADE
========================= */
function ensureDynamicUI() {
  // Fundo padrão no cadastro completo
  if (!$('setupStoreFund')) {
    const setupCashType = $('setupCashType')?.closest('.field');
    setupCashType?.insertAdjacentHTML('afterend', `<div class="field"><label>Fundo padrão da loja</label><input id="setupStoreFund" type="number" step="0.01" value="100"></div>`);
  }
  // Fundo padrão no cadastro de lojas
  if (!$('storeStandardFund')) {
    const storeStatus = $('storeStatus')?.closest('.field');
    storeStatus?.insertAdjacentHTML('afterend', `<div class="field"><label>Fundo padrão</label><input id="storeStandardFund" type="number" step="0.01" value="100"></div>`);
  }
  // Divergência crítica
  if (!$('operationCriticalDivergence')) {
    const tol = $('operationTolerance')?.closest('.field');
    tol?.insertAdjacentHTML('afterend', `<div class="field"><label>Divergência crítica</label><input id="operationCriticalDivergence" type="number" step="0.01" value="50"></div>`);
  }
  // Cabeçalho lojas com fundo padrão
  const storesHead = document.querySelector('#stores table thead tr');
  if (storesHead && !storesHead.dataset.fund5x) {
    storesHead.innerHTML = '<th>Empresa</th><th>Loja</th><th>Código</th><th>Tipo</th><th>Fundo padrão</th><th>Status</th>';
    storesHead.dataset.fund5x = '1';
  }
  renderCashCounter();
  ensureExpenseCategories();
}
function ensureExpenseCategories(root = document) {
  all('#expenses .launch-row', root).forEach((row) => {
    if (row.querySelector('.expense-category')) return;
    const valueField = row.querySelector('.expense')?.closest('.field');
    const opts = (state.selectOptions.expenseCategories || []).map((v) => `<option>${esc(v)}</option>`).join('');
    valueField?.insertAdjacentHTML('beforebegin', `<div class="field"><label>Categoria</label><select class="expense-category">${opts}</select></div>`);
  });
}
function renderCashCounter() {
  const box = $('cashCounterGrid');
  if (!box || box.dataset.ready) return;
  const denoms = [['0.01', 'Moeda 0,01'], ['0.05', 'Moeda 0,05'], ['0.10', 'Moeda 0,10'], ['0.25', 'Moeda 0,25'], ['0.50', 'Moeda 0,50'], ['1', 'Moeda 1,00'], ['2', 'Cédula 2'], ['5', 'Cédula 5'], ['10', 'Cédula 10'], ['20', 'Cédula 20'], ['50', 'Cédula 50'], ['100', 'Cédula 100'], ['200', 'Cédula 200']];
  box.innerHTML = denoms.map(([v, l]) => `<div class="cash-count-item"><label>${l}</label><input class="cash-count" type="number" min="0" step="1" value="0" data-value="${v}" oninput="syncCoinCountTotal();calc()"></div>`).join('');
  box.dataset.ready = '1';
}

/* =========================
   SELECTS
========================= */
function setOptions(id, rows, placeholder = 'Selecione') {
  const el = $(id); if (!el) return;
  const current = el.value;
  el.innerHTML = `<option value="">${placeholder}</option>` + rows.map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join('');
  if ([...el.options].some((o) => o.value === current)) el.value = current;
}
function fillSelects() {
  const companies = visibleCompanies().map((c) => [c.id, c.name]);
  ['storeCompany', 'opCompany', 'ruleCompany', 'implantCompany', 'operationCompany', 'ruleFilterCompany', 'moduleCompany', 'reportCompany', 'masterExtractCompany', 'masterMovementCompanyFilter', 'masterDivergenceCompanyFilter', 'userManageCompany', 'usersCompanyFilter'].forEach((id) => setOptions(id, companies));

  if (role === 'master') {
    if (!$('userManageCompany')?.value && state.companies[0]) setVal('userManageCompany', state.companies[0].id);
  }

  fillStoreSelect();
  fillClosingStoreSelect();
  fillReportStore();
  fillMasterExtractStore();
  fillMasterMovementStore();
  fillMasterDivergenceStore();
  fillUserManageSelect();
  fillClientReportStore();
}
function fillStoreSelect() {
  const cid = val('opCompany');
  setOptions('opStore', state.stores.filter((s) => !cid || s.companyId === cid).map((s) => [s.id, s.name]));
}
function fillClosingStoreSelect() {
  const stores = visibleStores().filter((s) => s.status !== 'Inativa');
  const cur = val('closingStore');
  const el = $('closingStore'); if (!el) return;
  el.innerHTML = stores.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  if (cur && stores.some((s) => s.id === cur)) el.value = cur;
  if (!el.value && stores[0]) el.value = stores[0].id;
  fillClosingResponsible5X();
}
function fillClosingResponsible5X() {
  const storeId = val('closingStore');
  const store = state.stores.find((s) => s.id === storeId);
  const users = state.users.filter((u) => u.companyId === store?.companyId && (!u.storeId || u.storeId === storeId) && u.status !== 'Inativo');
  const el = $('closingResponsible'); if (!el) return;
  const cur = el.value;
  el.innerHTML = '<option value="">Selecione o responsável</option>' + users.map((u) => `<option>${esc(u.name)}</option>`).join('');
  if (cur && [...el.options].some((o) => o.value === cur)) el.value = cur;
}
function storeOptionsForCompany(companyId) { return state.stores.filter((s) => !companyId || s.companyId === companyId).map((s) => [s.id, s.name]); }
function fillReportStore() { setOptions('reportStore', storeOptionsForCompany(val('reportCompany')), 'Todas'); }
function fillClientReportStore() { setOptions('clientReportStore', storeOptionsForCompany(currentUser?.companyId), 'Todas'); }
function fillMasterExtractStore() { setOptions('masterExtractStore', storeOptionsForCompany(val('masterExtractCompany')), 'Todas'); }
function fillMasterMovementStore() { setOptions('masterMovementStoreFilter', storeOptionsForCompany(val('masterMovementCompanyFilter')), 'Todas'); }
function fillMasterDivergenceStore() { setOptions('masterDivergenceStoreFilter', storeOptionsForCompany(val('masterDivergenceCompanyFilter')), 'Todas'); }
function fillUserManageSelect() {
  const cid = val('userManageCompany');
  setOptions('userManageSelect', state.users.filter((u) => !cid || u.companyId === cid).map((u) => [u.id, `${u.name} — ${u.login}`]));
}
function fillEditUserStore() {
  const uidVal = val('userManageSelect');
  const user = state.users.find((u) => u.id === uidVal);
  const roleEdit = val('editUserRole');
  setOptions('editUserStore', roleEdit === 'operator' ? storeOptionsForCompany(user?.companyId || val('userManageCompany')) : [], 'Sem loja');
}
function toggleUserStore() {
  const isAdmin = val('newUserRole') === 'admin';
  const opStore = $('opStore')?.closest('.field');
  if (opStore) opStore.style.display = isAdmin ? 'none' : '';
}

/* =========================
   CADASTROS
========================= */
function saveClientSetup() {
  const name = val('setupCompanyName').trim();
  if (!name) return alert('Informe o nome fantasia da empresa.');
  const companyId = uid('c');
  const storeId = uid('s');
  state.companies.push({ id: companyId, name, legal: val('setupCompanyLegal'), cnpj: val('setupCompanyCnpj'), segment: val('setupSegment'), plan: val('setupPlan'), status: val('setupStatus') || 'Implantação', notes: val('setupNotes') });
  state.stores.push({ id: storeId, companyId, name: val('setupStoreName') || 'Loja 01', code: val('setupStoreCode') || 'LJ01', cashType: val('setupCashType') || 'Caixa diário', standardFund: num('setupStoreFund') || 0, status: 'Ativa' });
  if (val('setupAdminLogin')) state.users.push({ id: uid('u'), companyId, storeId: null, name: val('setupAdminName') || 'ADM Cliente', login: val('setupAdminLogin'), pass: val('setupAdminPass') || '123456', role: 'admin', status: 'Ativo' });
  if (val('setupOperatorLogin')) state.users.push({ id: uid('u'), companyId, storeId, name: val('setupOperatorName') || 'Operador', login: val('setupOperatorLogin'), pass: '123456', role: 'operator', status: 'Ativo' });
  state.operationConfigs[companyId] = { tolerance: 5, criticalDivergence: 50, mode: 'Diário', receiver: '', allowed: '', message: '' };
  state.modules[companyId] = { admin: { ...defaultModuleConfig('admin'), adminClosing: false }, operator: defaultModuleConfig('operator') };
  addAudit('Cadastro de cliente', name);
  clearClientSetup(); save(); renderAll(); alert('Cliente cadastrado com empresa, loja e acessos iniciais.');
}
function clearClientSetup() { ['setupCompanyName', 'setupCompanyLegal', 'setupCompanyCnpj', 'setupAdminName', 'setupAdminLogin', 'setupOperatorName', 'setupOperatorLogin', 'setupStoreName', 'setupStoreCode', 'setupNotes'].forEach(clear); setVal('setupAdminPass', '123456'); setVal('setupStoreFund', 100); }
function createStore() {
  const cid = val('storeCompany'); const name = val('storeName').trim();
  if (!cid) return alert('Selecione a empresa.');
  if (!name) return alert('Informe o nome da loja.');
  const code = val('storeCode').trim();
  const exists = state.stores.some((s) => s.companyId === cid && (s.name.toLowerCase() === name.toLowerCase() || (code && String(s.code).toLowerCase() === code.toLowerCase())));
  if (exists) return alert('Já existe uma loja com este nome ou código nesta empresa.');
  state.stores.push({ id: uid('s'), companyId: cid, name, code, cashType: val('storeCashType') || 'Caixa diário', standardFund: num('storeStandardFund') || 0, status: val('storeStatus') || 'Ativa' });
  ['storeName', 'storeCode'].forEach(clear); setVal('storeStandardFund', 100);
  addAudit('Cadastro de loja', name); save(); renderAll();
}
function createUserFromMaster() {
  const cid = val('opCompany'), roleNew = val('newUserRole') || 'operator';
  if (!cid) return alert('Selecione a empresa.');
  if (!val('opName') || !val('opLogin')) return alert('Informe nome e login.');
  if (state.users.some((u) => String(u.login).toLowerCase() === val('opLogin').toLowerCase())) return alert('Já existe usuário com este login.');
  const storeId = roleNew === 'operator' ? val('opStore') : null;
  if (roleNew === 'operator' && !storeId) return alert('Selecione a loja do operador.');
  state.users.push({ id: uid('u'), companyId: cid, storeId, name: val('opName'), login: val('opLogin'), pass: val('opPass') || '123456', role: roleNew, status: 'Ativo' });
  ['opName', 'opLogin'].forEach(clear); setVal('opPass', '123456');
  addAudit('Cadastro de usuário', val('opLogin')); save(); renderAll();
}
function loadUserToEdit() {
  const u = state.users.find((x) => x.id === val('userManageSelect'));
  if (!u) return;
  setVal('editUserName', u.name); setVal('editUserLogin', u.login); setVal('editUserRole', u.role); setVal('editUserStatus', u.status || 'Ativo'); setVal('editUserPass', '');
  fillEditUserStore(); setVal('editUserStore', u.storeId || '');
}
function saveUserEdit() {
  const u = state.users.find((x) => x.id === val('userManageSelect'));
  if (!u) return alert('Selecione um usuário.');
  u.name = val('editUserName'); u.login = val('editUserLogin'); u.role = val('editUserRole'); u.status = val('editUserStatus') || 'Ativo'; u.storeId = u.role === 'operator' ? val('editUserStore') : null;
  if (val('editUserPass')) u.pass = val('editUserPass');
  addAudit('Edição de usuário', u.login); save(); renderAll(); alert('Usuário atualizado.');
}
function resetSelectedUserPassword() { const u = state.users.find((x) => x.id === val('userManageSelect')); if (!u) return alert('Selecione um usuário.'); u.pass = '123456'; addAudit('Reset de senha', u.login); save(); alert('Senha resetada para 123456.'); }
function deleteSelectedUser() { const id = val('userManageSelect'); if (!id) return alert('Selecione um usuário.'); if (!confirm('Excluir este usuário?')) return; state.users = state.users.filter((u) => u.id !== id); save(); renderAll(); }
function createRule() { const cid = val('ruleCompany'); if (!cid || !val('ruleText')) return alert('Selecione a empresa e informe a regra.'); state.rules.push({ id: uid('r'), companyId: cid, type: val('ruleType'), text: val('ruleText') }); clear('ruleText'); addAudit('Cadastro de regra', companyName(cid)); save(); renderAll(); }
function saveImplantStep() { const cid = val('implantCompany'); if (!cid) return alert('Selecione a empresa.'); state.implant.push({ id: uid('i'), companyId: cid, step: val('implantStep'), status: val('implantStatus'), note: val('implantNote'), date: todayBR() }); clear('implantNote'); save(); renderAll(); }
function saveOperationConfig() { const cid = val('operationCompany'); if (!cid) return alert('Selecione a empresa.'); state.operationConfigs[cid] = { tolerance: num('operationTolerance'), criticalDivergence: num('operationCriticalDivergence'), mode: val('operationMode'), receiver: val('operationReceiver'), allowed: val('operationAllowed'), message: val('operationMessage') }; addAudit('Configuração operacional', companyName(cid)); save(); renderAll(); }
function toggleCompany(id) { const c = state.companies.find((x) => x.id === id); if (!c) return; c.status = c.status === 'Inativa' ? 'Ativa' : 'Inativa'; save(); renderAll(); }

/* =========================
   FECHAMENTO
========================= */
function addEntry() {
  $('entries')?.insertAdjacentHTML('beforeend', `<div class="launch-row"><div class="field"><label>Descrição</label><input class="entry-desc" value="Entrada em Dinheiro"></div><div class="field"><label>Valor de entrada</label><input class="entry" oninput="calc()" type="number" value="0"></div><button class="btn" onclick="removeLaunchRow(this)">×</button></div>`);
}
function addExpense() {
  const opts = (state.selectOptions.expenseCategories || []).map((v) => `<option>${esc(v)}</option>`).join('');
  $('expenses')?.insertAdjacentHTML('beforeend', `<div class="launch-row"><div class="field"><label>Descrição da saída</label><input class="expense-desc" placeholder="Ex: ajuda de custo motoboy"></div><div class="field"><label>Categoria</label><select class="expense-category">${opts}</select></div><div class="field"><label>Valor da saída</label><input class="expense" oninput="calc()" type="number" value="0"></div><button class="btn" onclick="removeLaunchRow(this)">×</button></div>`);
}
function removeLaunchRow(btn) { btn.closest('.launch-row')?.remove(); calc(); }
function totalEntries() { return all('.entry').reduce((a, e) => a + (Number(e.value) || 0), 0); }
function totalExpenses() { return all('.expense').reduce((a, e) => a + (Number(e.value) || 0), 0); }
function selectedStore() { return state.stores.find((s) => s.id === val('closingStore')) || visibleStores()[0]; }
function expectedCash() { return num('initial') + totalEntries() - totalExpenses(); }
function finalAfterTransfer() { return expectedCash() - num('transfer'); }
function diffValue() { const s = selectedStore(); return finalAfterTransfer() - Number(s?.standardFund || 0); }
function closingStatus(diff, companyId) {
  const c = cfg(companyId); const abs = Math.abs(diff);
  if (c.criticalDivergence && abs >= Math.abs(Number(c.criticalDivergence))) return 'Divergência crítica';
  if (abs <= Math.abs(Number(c.tolerance || 0))) return 'Dentro da tolerância';
  return 'Divergência operacional';
}
function cashCounterTotal() { return all('.cash-count').reduce((a, e) => a + (Number(e.value) || 0) * (Number(e.dataset.value) || 0), 0); }
function coinCounterTotal() { return all('.cash-count').filter((e) => Number(e.dataset.value) <= 1).reduce((a, e) => a + (Number(e.value) || 0) * (Number(e.dataset.value) || 0), 0); }
function syncCoinCountTotal() {
  const total = cashCounterTotal(); const coins = coinCounterTotal();
  text('cashCounterTotal', money(total));
  if (document.activeElement?.classList?.contains('cash-count')) setVal('coinsTotal', coins.toFixed(2));
}
function calc() {
  ensureDynamicUI();
  const store = selectedStore();
  const diff = diffValue();
  const status = closingStatus(diff, store?.companyId);
  text('coinsTotalView', money(num('coinsTotal'))); text('totalEntries', money(totalEntries())); text('totalExpenses', money(totalExpenses())); text('expectedCash', money(expectedCash())); text('cashBalance', money(finalAfterTransfer())); text('standardFundView', money(store?.standardFund || 0)); text('diffValue', money(diff));
  const statusEl = $('closingStatusView');
  if (statusEl) { statusEl.className = `status ${status === 'Dentro da tolerância' ? 'success' : status === 'Divergência crítica' ? 'danger' : 'warning'}`; statusEl.textContent = status; }
  const c = cfg(store?.companyId);
  const msg = status === 'Dentro da tolerância'
    ? `Conferência dentro da tolerância permitida de ${money(c.tolerance)}.`
    : status === 'Divergência crítica'
      ? `Divergência crítica: revisar contagem, saídas, repasse e fundo padrão. Limite crítico: ${money(c.criticalDivergence)}.`
      : `Divergência operacional acima da tolerância de ${money(c.tolerance)}.`;
  text('closingInsight', `${msg} Cálculo: saldo final após repasse (${money(finalAfterTransfer())}) - fundo padrão (${money(store?.standardFund || 0)}) = ${money(diff)}.`);
}
function saveClosing() {
  const store = selectedStore();
  if (!store) return alert('Selecione uma loja cadastrada.');
  if (role === 'operator' && currentUser?.storeId && store.id !== currentUser.storeId) return alert('Este operador só pode lançar fechamento da loja vinculada.');
  if (role === 'admin' && store.companyId !== currentUser?.companyId) return alert('Esta loja não pertence ao seu acesso.');

  const entries = all('#entries .launch-row').map((row) => ({ description: row.querySelector('.entry-desc')?.value || 'Entrada', value: Number(row.querySelector('.entry')?.value || 0) })).filter((x) => x.value || x.description);
  const expenses = all('#expenses .launch-row').map((row) => ({ description: row.querySelector('.expense-desc')?.value || 'Saída', category: row.querySelector('.expense-category')?.value || '', value: Number(row.querySelector('.expense')?.value || 0) })).filter((x) => x.value || x.description);
  const expected = expectedCash(); const finalCash = finalAfterTransfer(); const diff = diffValue();

  state.closings.push({
    id: uid('cl'), companyId: store.companyId, storeId: store.id,
    date: toBRFromISO(val('closingDate') || todayISO()), responsible: val('closingResponsible') || currentUser?.name || '', operator: currentUser?.name || '',
    initial: num('initial'), coinsTotal: num('coinsTotal'), cashCounterTotal: cashCounterTotal(), entries: totalEntries(), entryItems: entries,
    expenses: totalExpenses(), expenseItems: expenses, transfer: num('transfer'), expected, finalAfterTransfer: finalCash, cashBalance: finalCash,
    standardFund: Number(store.standardFund || 0), diff, balance: diff, notes: val('closingNotes'), attachments: closingAttachments.slice(),
    reviewStatus: Math.abs(diff) > 0 ? 'Pendente de revisão' : 'Sem divergência', status: closingStatus(diff, store.companyId), createdAt: new Date().toISOString(),
  });
  addAudit('Fechamento salvo', `${companyName(store.companyId)} / ${store.name}`);
  closingAttachments = []; clearAttachmentsUI();
  ['initial', 'coinsTotal', 'transfer', 'closingNotes'].forEach((id) => setVal(id, id === 'closingNotes' ? '' : 0));
  all('.entry').forEach((e) => { e.value = 0; }); all('.expense').forEach((e) => { e.value = 0; }); all('.cash-count').forEach((e) => { e.value = 0; });
  save(); renderAll(); calc(); alert('Fechamento salvo com conferência 5X.');
}
function handleAttachments(files) {
  closingAttachments.push(...[...files].map((f) => ({ name: f.name, size: f.size, type: f.type, lastModified: f.lastModified })));
  renderAttachments();
}
function renderAttachments() { html('attachmentList', closingAttachments.length ? closingAttachments.map((f) => `<div>${esc(f.name)} <span class="subtle">${Math.round(f.size / 1024)} KB</span></div>`).join('') : 'Nenhum anexo selecionado.'); }
function clearAttachmentsUI() { const a = $('closingAttachments'); const c = $('closingCamera'); if (a) a.value = ''; if (c) c.value = ''; renderAttachments(); }

/* =========================
   FILTROS E LINHAS
========================= */
function filteredClosings({ scope = 'master' } = {}) {
  let rows = [...state.closings];
  if (scope === 'admin') rows = rows.filter((c) => c.companyId === currentUser?.companyId);
  if (scope === 'operator') rows = rows.filter((c) => c.storeId === currentUser?.storeId || c.operator === currentUser?.name);
  if (role === 'admin' && scope === 'master') rows = rows.filter((c) => c.companyId === currentUser?.companyId);
  if (role === 'operator' && scope === 'master') rows = rows.filter((c) => c.storeId === currentUser?.storeId);
  return rows;
}
function masterFilteredClosings() {
  let rows = filteredClosings();
  const cid = val('masterMovementCompanyFilter'); const sid = val('masterMovementStoreFilter');
  if (cid) rows = rows.filter((c) => c.companyId === cid); if (sid) rows = rows.filter((c) => c.storeId === sid);
  return rows;
}
function divergenceFilteredClosings() {
  let rows = filteredClosings();
  const cid = val('masterDivergenceCompanyFilter'); const sid = val('masterDivergenceStoreFilter');
  if (cid) rows = rows.filter((c) => c.companyId === cid); if (sid) rows = rows.filter((c) => c.storeId === sid);
  return rows.filter((c) => Math.abs(Number(c.diff || 0)) > 0);
}
function reportFilteredClosings(admin = false) {
  let rows = admin ? filteredClosings({ scope: 'admin' }) : filteredClosings();
  const cid = admin ? currentUser?.companyId : val('reportCompany'); const sid = admin ? val('clientReportStore') : val('reportStore');
  const start = parseBR(admin ? val('clientReportStart') : val('reportStart')); const end = parseBR(admin ? val('clientReportEnd') : val('reportEnd'));
  if (cid) rows = rows.filter((c) => c.companyId === cid); if (sid) rows = rows.filter((c) => c.storeId === sid);
  if (start) rows = rows.filter((c) => parseBR(c.date) >= start); if (end) rows = rows.filter((c) => parseBR(c.date) <= end);
  return rows;
}
function allMovementRows(rows = state.closings) {
  return rows.flatMap((c) => {
    const base = { companyId: c.companyId, storeId: c.storeId, Empresa: companyName(c.companyId), Data: c.date, Loja: storeName(c.storeId), Responsável: c.responsible || c.operator || '' };
    const entries = (c.entryItems?.length ? c.entryItems : [{ description: 'Entrada em Dinheiro', value: c.entries }]).filter((i) => Number(i.value)).map((i) => ({ ...base, Tipo: 'Entrada', Descrição: i.description, Categoria: '', Valor: Number(i.value) }));
    const exits = (c.expenseItems || []).filter((i) => Number(i.value)).map((i) => ({ ...base, Tipo: 'Saída', Descrição: i.description, Categoria: i.category || '', Valor: -Math.abs(Number(i.value)) }));
    const transfer = Number(c.transfer) ? [{ ...base, Tipo: 'Repasse / Transferência', Descrição: 'Repasse ao caixa central', Categoria: '', Valor: -Math.abs(Number(c.transfer)) }] : [];
    return [...entries, ...exits, ...transfer];
  });
}
function diffRead(c) { const d = Number(c.diff || 0); if (d > 0) return 'Saldo final acima do fundo padrão da loja.'; if (d < 0) return 'Saldo final abaixo do fundo padrão da loja.'; return 'Sem divergência.'; }
function diffAction(c) { const abs = Math.abs(Number(c.diff || 0)); const cgf = cfg(c.companyId); if (cgf.criticalDivergence && abs >= Math.abs(Number(cgf.criticalDivergence))) return 'Tratar como divergência crítica e revisar contagem, saídas, repasse e fundo padrão.'; if (abs > Math.abs(Number(cgf.tolerance || 0))) return 'Registrar como divergência operacional e validar com o responsável.'; return 'Registrar como dentro da tolerância permitida.'; }

/* =========================
   RENDERIZAÇÃO
========================= */
function renderAll() {
  if (!state) return;
  ensureDynamicUI();
  fillSelects();
  applyModuleAccess();
  renderMetrics(); renderTables(); renderRulesByCompany(); renderCentral(); renderModuleManager(); renderUsersByCompany(); renderSettings(); renderMasterMovementsExtract(); renderAdminViews(); renderOperatorViews(); renderAttachments(); calc();
}
function renderMetrics() {
  text('mCompanies', state.companies.filter((c) => c.status !== 'Inativa').length); text('mStores', state.stores.length); text('mClosings', state.closings.length); text('mDiff', money(state.closings.reduce((a, c) => a + Math.abs(Number(c.diff || 0)), 0)));
  const adminRows = filteredClosings({ scope: 'admin' });
  text('aStores', state.stores.filter((s) => s.companyId === currentUser?.companyId).length); text('aClosings', adminRows.length); text('aUsers', state.users.filter((u) => u.companyId === currentUser?.companyId).length); text('aDiff', money(adminRows.reduce((a, c) => a + Math.abs(Number(c.diff || 0)), 0)));
}
function renderTables() {
  html('companiesBody', state.companies.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.legal)}</td><td>${esc(c.cnpj)}</td><td>${esc(c.segment)}</td><td>${tag(c.status)}</td><td>${esc(c.plan)}</td><td>${state.stores.filter((s) => s.companyId === c.id).length}</td><td>${state.users.filter((u) => u.companyId === c.id).length}</td><td><button class="btn btn-danger" onclick="toggleCompany('${c.id}')">${c.status === 'Inativa' ? 'Ativar' : 'Inativar'}</button></td></tr>`).join('') || emptyRow(9));
  html('storesBody', visibleStores().map((s) => `<tr><td>${esc(companyName(s.companyId))}</td><td>${esc(s.name)}</td><td>${esc(s.code)}</td><td>${esc(s.cashType)}</td><td><input type="number" step="0.01" value="${Number(s.standardFund || 0)}" onchange="updateStoreFund('${s.id}',this.value)" style="max-width:130px"></td><td>${tag(s.status)}</td></tr>`).join('') || emptyRow(6));
  renderUsersByCompany();
  html('rulesBody', state.rules.map((r) => `<tr><td>${esc(companyName(r.companyId))}</td><td>${esc(r.type)}</td><td>${esc(r.text)}</td></tr>`).join('') || emptyRow(3));
  html('implantBody', state.implant.map((i) => `<tr><td>${esc(companyName(i.companyId))}</td><td>${esc(i.step)}</td><td>${tag(i.status)}</td><td>${esc(i.note)}</td><td>${esc(i.date)}</td></tr>`).join('') || emptyRow(5));
  html('movementsBody', masterFilteredClosings().map((c) => `<tr><td>${esc(companyName(c.companyId))}</td><td>${esc(storeName(c.storeId))}</td><td>${esc(c.date)}</td><td>${esc(c.responsible)}</td><td>${money(c.initial)}</td><td>${money(c.entries)}</td><td>${money(c.expenses)}</td><td>${money(c.expected)}</td><td>${money(c.transfer)}</td><td>${money(c.cashBalance ?? c.finalAfterTransfer)}</td><td>${tag(c.status)}</td></tr>`).join('') || emptyRow(11));
  const divRows = divergenceFilteredClosings();
  html('divergencesBody', divRows.map((c) => `<tr><td>${esc(companyName(c.companyId))}</td><td>${esc(storeName(c.storeId))}</td><td>${esc(c.date)}</td><td>${money(c.diff)}</td><td>${esc(diffRead(c))}</td><td>${esc(diffAction(c))}</td></tr>`).join('') || emptyRow(6));
  html('divergenceSummary', `<div class="kpi-alert"><strong>${divRows.length} divergência(s)</strong><p class="subtle">Valor absoluto total: ${money(divRows.reduce((a, c) => a + Math.abs(Number(c.diff || 0)), 0))}</p></div>`);
}
function updateStoreFund(id, value) { const s = state.stores.find((x) => x.id === id); if (!s) return; s.standardFund = Number(value) || 0; save(); renderAll(); }
function renderCentral() {
  const steps = ['Empresa', 'Lojas/Caixas', 'Usuários', 'Regras', 'Treinamento', 'Início monitorado', 'Conferência', 'Operação ativa'];
  const done = new Set(state.implant.filter((i) => i.status === 'Concluído').map((i) => String(i.step).replace(/^\d+\.\s*/, '')));
  html('setupWizard', steps.map((s, i) => `<div class="step ${done.has(s) ? 'done' : i < 3 ? 'doing' : 'pending'}"><small>Etapa ${i + 1}</small><strong>${esc(s)}</strong></div>`).join(''));
  html('operationConfigList', Object.entries(state.operationConfigs).map(([cid, c]) => `<div class="kpi-alert" style="margin-bottom:10px"><strong>${esc(companyName(cid))}</strong><p class="subtle">Modo: ${esc(c.mode)} | Tolerância: ${money(c.tolerance)} | Crítica: ${money(c.criticalDivergence)} | Repasse: ${esc(c.receiver || '-')}</p></div>`).join('') || '<p class="subtle">Nenhuma configuração salva.</p>');
  html('executiveSummary', `<p><strong>${state.companies.length}</strong> empresa(s), <strong>${state.stores.length}</strong> loja(s), <strong>${state.closings.length}</strong> fechamento(s).</p>`);
  const risks = state.closings.filter((c) => c.status === 'Divergência crítica').slice(-5);
  html('riskAlerts', risks.length ? risks.map((c) => `<div class="rule"><span class="dot"></span><span>${esc(companyName(c.companyId))} / ${esc(storeName(c.storeId))}: ${money(c.diff)}</span></div>`).join('') : '<p class="subtle">Nenhum alerta crítico no momento.</p>');
}
function renderRulesByCompany() {
  const filter = val('ruleFilterCompany');
  const companies = state.companies.filter((c) => !filter || c.id === filter);
  html('companyRuleTabs', companies.map((c) => `<button class="btn" onclick="document.getElementById('ruleFilterCompany').value='${c.id}';renderRulesByCompany()">${esc(c.name)}</button>`).join(''));
  html('rulesByCompany', companies.map((c) => {
    const rows = state.rules.filter((r) => r.companyId === c.id);
    return `<div class="rule-company-card"><h4>${esc(c.name)}</h4>${rows.length ? rows.map((r) => `<div class="rule-row-mini"><strong>${esc(r.type)}:</strong> ${esc(r.text)}</div>`).join('') : '<p class="subtle">Nenhuma regra cadastrada.</p>'}</div>`;
  }).join('') || '<p class="subtle">Nenhuma empresa cadastrada.</p>');
}
function renderUsersByCompany() {
  const filter = val('usersCompanyFilter');
  const rows = state.users.filter((u) => !filter || u.companyId === filter);
  html('usersBody', rows.map((u) => `<tr><td>${esc(companyName(u.companyId))}</td><td>${esc(storeName(u.storeId))}</td><td>${esc(u.name)}</td><td>${esc(u.login)}</td><td>${u.role === 'admin' ? 'Administrador Cliente' : 'Operador'}</td><td>${tag(u.status || 'Ativo')}</td><td><button class="btn" onclick="document.getElementById('userManageCompany').value='${u.companyId}';fillUserManageSelect();document.getElementById('userManageSelect').value='${u.id}';loadUserToEdit()">Editar</button></td></tr>`).join('') || emptyRow(7));
}
function renderAdminViews() {
  const stores = state.stores.filter((s) => s.companyId === currentUser?.companyId);
  html('adminStoresBody', stores.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.code)}</td><td>${esc(s.cashType)}</td><td>${money(s.standardFund)}</td><td>${tag(s.status)}</td></tr>`).join('') || emptyRow(5));
  html('adminRulesList', state.rules.filter((r) => r.companyId === currentUser?.companyId).map((r) => `<div class="rule"><span class="dot"></span><span><strong>${esc(r.type)}:</strong> ${esc(r.text)}</span></div>`).join('') || '<p class="subtle">Nenhuma regra cadastrada.</p>');
  const rows = filteredClosings({ scope: 'admin' });
  html('adminMovementsBody', rows.slice(-8).reverse().map((c) => `<tr><td>${esc(c.date)}</td><td>${esc(storeName(c.storeId))}</td><td>${money(c.entries)}</td><td>${money(c.diff)}</td><td>${tag(c.status)}</td></tr>`).join('') || emptyRow(5));
  html('adminStoreDashboard', stores.map((s) => {
    const cls = rows.filter((c) => c.storeId === s.id);
    return `<div class="store-card"><h4>${esc(s.name)}</h4><p>Entradas: <strong>${money(cls.reduce((a, c) => a + Number(c.entries || 0), 0))}</strong></p><p>Saídas: <strong>${money(cls.reduce((a, c) => a + Number(c.expenses || 0), 0))}</strong></p><p>Repasse: <strong>${money(cls.reduce((a, c) => a + Number(c.transfer || 0), 0))}</strong></p><p>Divergência: <strong>${money(cls.reduce((a, c) => a + Number(c.diff || 0), 0))}</strong></p></div>`;
  }).join('') || '<p class="subtle">Nenhuma loja cadastrada.</p>');
  const movementRows = allMovementRows(rows).filter((r) => !val('adminMovementStoreFilter') || r.storeId === val('adminMovementStoreFilter'));
  setOptions('adminMovementStoreFilter', stores.map((s) => [s.id, s.name]), 'Todas');
  html('adminMovementsDetailBody', movementRows.map((r) => `<tr><td>${esc(r.Data)}</td><td>${esc(r.Loja)}</td><td>${esc(r.Tipo)}</td><td>${esc(r.Descrição)}</td><td>${money(r.Valor)}</td><td>${esc(r.Responsável)}</td></tr>`).join('') || emptyRow(6));
  setOptions('adminDivergenceStoreFilter', stores.map((s) => [s.id, s.name]), 'Todas');
  const divRows = rows.filter((c) => Math.abs(Number(c.diff || 0)) > 0 && (!val('adminDivergenceStoreFilter') || c.storeId === val('adminDivergenceStoreFilter')));
  html('adminDivergencesReviewBody', divRows.map((c) => `<tr><td>${esc(c.date)}</td><td>${esc(storeName(c.storeId))}</td><td>${esc(c.responsible)}</td><td>${money(c.cashBalance)}</td><td>${tag(c.reviewStatus)}</td><td>${esc(diffAction(c))}</td></tr>`).join('') || emptyRow(6));
}
function renderOperatorViews() {
  const rows = filteredClosings({ scope: 'operator' });
  html('operatorHistoryBody', rows.slice().reverse().map((c) => `<tr><td>${esc(c.date)}</td><td>${esc(storeName(c.storeId))}</td><td>${money(c.entries)}</td><td>${money(c.expenses)}</td><td>${money(c.transfer)}</td><td>${money(c.diff)}</td><td>${tag(c.status)}</td></tr>`).join('') || emptyRow(7));
  const store = selectedStore();
  const rules = state.rules.filter((r) => r.companyId === store?.companyId);
  const c = cfg(store?.companyId);
  html('operatorRules', `${rules.map((r) => `<div class="rule"><span class="dot"></span><span><strong>${esc(r.type)}:</strong> ${esc(r.text)}</span></div>`).join('')}${c.message ? `<div class="rule"><span class="dot"></span><span>${esc(c.message)}</span></div>` : ''}` || '<p class="subtle">Nenhuma regra cadastrada.</p>');
}
function renderMasterMovementsExtract() {
  let rows = allMovementRows(filteredClosings());
  const cid = val('masterExtractCompany'); const sid = val('masterExtractStore'); const type = val('masterExtractType');
  if (cid) rows = rows.filter((r) => r.companyId === cid); if (sid) rows = rows.filter((r) => r.storeId === sid); if (type) rows = rows.filter((r) => r.Tipo === type);
  html('masterMovementsExtractBody', rows.map((r) => `<tr><td>${esc(r.Empresa)}</td><td>${esc(r.Data)}</td><td>${esc(r.Loja)}</td><td>${esc(r.Tipo)}</td><td>${esc(r.Descrição)}</td><td>${money(r.Valor)}</td><td>${esc(r.Responsável)}</td></tr>`).join('') || emptyRow(7));
}
function renderModuleManager() {
  const cid = val('moduleCompany'); const profile = val('moduleProfile') || 'admin'; const box = $('moduleManager');
  if (!box) return;
  if (!cid) { box.innerHTML = '<p class="subtle">Selecione uma empresa para configurar os módulos.</p>'; return; }
  const config = getModuleConfig(cid, profile);
  setVal('moduleAccessStatus', config.status || 'Ativo');
  box.innerHTML = (MODULES[profile] || []).map(([key, label, desc]) => `<div class="module-row"><div><strong>${esc(label)}</strong><p class="subtle">${esc(desc)}</p></div><select data-module-key="${key}" onchange="draftModules()"><option value="true" ${config[key] !== false ? 'selected' : ''}>Liberado</option><option value="false" ${config[key] === false ? 'selected' : ''}>Bloqueado</option></select></div>`).join('');
}
function draftModules() {
  const cid = val('moduleCompany'); if (!cid) return;
  const profile = val('moduleProfile') || 'admin'; const config = getModuleConfig(cid, profile);
  config.status = val('moduleAccessStatus') || 'Ativo';
  all('#moduleManager [data-module-key]').forEach((s) => { config[s.dataset.moduleKey] = s.value === 'true'; });
  syncModuleAliases(config); autosave(); applyModuleAccess();
}
function saveModules() { draftModules(); save(); renderAll(); alert('Módulos atualizados. A liberação/bloqueio será respeitada no próximo acesso e também na navegação atual.'); }
function renderSettings() {
  html('settingsCompaniesBody', state.companies.map((c) => `<tr><td>${esc(c.name)}</td><td>${tag(c.status)}</td><td><button class="btn btn-danger" onclick="deleteCompany('${c.id}')">Excluir</button></td></tr>`).join('') || emptyRow(3));
  html('settingsStoresBody', state.stores.map((s) => `<tr><td>${esc(companyName(s.companyId))}</td><td>${esc(s.name)}</td><td><button class="btn btn-danger" onclick="deleteStore('${s.id}')">Excluir</button></td></tr>`).join('') || emptyRow(3));
  html('settingsUsersBody', state.users.map((u) => `<tr><td>${esc(u.name)}<br><span class="subtle">${esc(u.login)}</span></td><td>${u.role === 'admin' ? 'ADM Cliente' : 'Operador'}</td><td><button class="btn btn-danger" onclick="deleteUser('${u.id}')">Excluir</button></td></tr>`).join('') || emptyRow(3));
  html('settingsRulesBody', state.rules.map((r) => `<tr><td>${esc(companyName(r.companyId))}</td><td>${esc(r.type)}</td><td><button class="btn btn-danger" onclick="deleteRule('${r.id}')">Excluir</button></td></tr>`).join('') || emptyRow(3));
  renderOptionGroups();
}
function deleteCompany(id) { if (!confirm('Excluir empresa e todos os dados vinculados?')) return; state.companies = state.companies.filter((c) => c.id !== id); state.stores = state.stores.filter((s) => s.companyId !== id); state.users = state.users.filter((u) => u.companyId !== id); state.rules = state.rules.filter((r) => r.companyId !== id); state.closings = state.closings.filter((c) => c.companyId !== id); delete state.operationConfigs[id]; delete state.modules[id]; save(); renderAll(); }
function deleteStore(id) { if (!confirm('Excluir loja e fechamentos vinculados?')) return; state.stores = state.stores.filter((s) => s.id !== id); state.closings = state.closings.filter((c) => c.storeId !== id); state.users.forEach((u) => { if (u.storeId === id) u.storeId = null; }); save(); renderAll(); }
function deleteUser(id) { if (!confirm('Excluir usuário?')) return; state.users = state.users.filter((u) => u.id !== id); save(); renderAll(); }
function deleteRule(id) { if (!confirm('Excluir regra?')) return; state.rules = state.rules.filter((r) => r.id !== id); save(); renderAll(); }

/* =========================
   CONFIGURAÇÕES DE OPÇÕES
========================= */
function optionLabels() { return { segments: 'Segmentos', plans: 'Planos', companyStatus: 'Status da empresa', cashTypes: 'Tipos de caixa', operationModes: 'Modos de fechamento', ruleTypes: 'Tipos de regra', shifts: 'Turnos', implantSteps: 'Etapas de implantação', implantStatus: 'Status de implantação', expenseCategories: 'Categorias de saída' }; }
function addSelectOption() { const key = val('optionCategory'); const value = val('optionNewValue').trim(); if (!key || !value) return alert('Selecione o campo e informe a opção.'); state.selectOptions[key] = state.selectOptions[key] || []; if (!state.selectOptions[key].includes(value)) state.selectOptions[key].push(value); clear('optionNewValue'); save(); renderAll(); }
function removeSelectOption(key, value) { state.selectOptions[key] = (state.selectOptions[key] || []).filter((v) => v !== value); save(); renderAll(); }
function resetSelectOptions() { if (!confirm('Restaurar opções padrão?')) return; state.selectOptions = defaultSelectOptions(); save(); renderAll(); }
function renderOptionGroups() {
  const labels = optionLabels();
  html('optionGroups', Object.keys(labels).map((key) => `<div class="option-group"><div class="option-group-head"><strong>${labels[key]}</strong><span class="pill">${(state.selectOptions[key] || []).length} opção(ões)</span></div><div class="option-items">${(state.selectOptions[key] || []).map((v) => `<span class="option-pill">${esc(v)}<button onclick="removeSelectOption('${key}', '${esc(v)}')">×</button></span>`).join('') || '<span class="subtle">Nenhuma opção.</span>'}</div></div>`).join(''));
}

/* =========================
   EXPORTAÇÕES
========================= */
function closingRows(rows) { return rows.map((c) => ({ Empresa: companyName(c.companyId), Loja: storeName(c.storeId), Data: c.date, Responsável: c.responsible, 'Saldo Inicial': c.initial, Entradas: c.entries, Saídas: c.expenses, Repasse: c.transfer, 'Saldo Final Após Repasse': c.cashBalance, 'Fundo Padrão': c.standardFund, Divergência: c.diff, Status: c.status, Observações: c.notes })); }
function exportCSV() { const rows = closingRows(reportFilteredClosings()); downloadFile('fechamentos_5x.csv', csv(Object.keys(rows[0] || { Empresa: '', Loja: '', Data: '' }), rows), 'text/csv;charset=utf-8'); }
function exportDivergencesCSV() { const rows = closingRows(reportFilteredClosings().filter((c) => Math.abs(Number(c.diff || 0)) > 0)); downloadFile('divergencias_5x.csv', csv(Object.keys(rows[0] || { Empresa: '', Loja: '', Data: '' }), rows), 'text/csv;charset=utf-8'); }
function exportTransfersCSV() { const rows = reportFilteredClosings().filter((c) => Number(c.transfer)).map((c) => ({ Empresa: companyName(c.companyId), Loja: storeName(c.storeId), Data: c.date, Responsável: c.responsible, Repasse: c.transfer, Status: c.status })); downloadFile('repasses_5x.csv', csv(Object.keys(rows[0] || { Empresa: '', Loja: '', Data: '' }), rows), 'text/csv;charset=utf-8'); }
function exportExpensesCSV() { const rows = allMovementRows(reportFilteredClosings()).filter((r) => r.Tipo === 'Saída'); downloadFile('saidas_5x.csv', csv(['Empresa', 'Data', 'Loja', 'Tipo', 'Descrição', 'Categoria', 'Valor', 'Responsável'], rows), 'text/csv;charset=utf-8'); }
function exportAuditCSV() { const rows = state.audit.map((a) => ({ Data: a.date, Usuário: a.user, Perfil: a.role, Ação: a.action, Detalhe: a.detail })); downloadFile('auditoria_5x.csv', csv(Object.keys(rows[0] || { Data: '', Usuário: '', Ação: '' }), rows), 'text/csv;charset=utf-8'); }
function exportClientMovementsCSV() { const rows = allMovementRows(reportFilteredClosings(true)); downloadFile('movimentacoes_cliente_5x.csv', csv(['Empresa', 'Data', 'Loja', 'Tipo', 'Descrição', 'Categoria', 'Valor', 'Responsável'], rows), 'text/csv;charset=utf-8'); }
function exportClientDivergencesCSV() { const rows = closingRows(reportFilteredClosings(true).filter((c) => Math.abs(Number(c.diff || 0)) > 0)); downloadFile('divergencias_cliente_5x.csv', csv(Object.keys(rows[0] || { Empresa: '', Loja: '', Data: '' }), rows), 'text/csv;charset=utf-8'); }
function exportContaAzulCSV() {
  const rows = allMovementRows(reportFilteredClosings()).map((r) => ({ 'Data de Competência': r.Data, 'Data de Vencimento': r.Data, 'Data de Pagamento': r.Data, Descrição: r.Descrição, Categoria: r.Tipo === 'Entrada' ? 'Receita de Venda - Dinheiro' : r.Tipo === 'Saída' ? (r.Categoria || 'Saída de Caixa') : 'Transferência entre contas', Valor: r.Valor, 'Cliente/Fornecedor': '', 'CNPJ/CPF': '', 'Centro de Custo': r.Loja, Observações: `Importado Central de Caixa 5X - ${r.Empresa}` }));
  downloadFile('modelo_conta_azul_caixa_5x.csv', csv(Object.keys(rows[0] || { 'Data de Competência': '', Descrição: '', Valor: '' }), rows), 'text/csv;charset=utf-8');
}
function exportBackup() { downloadFile(`backup_caixa5x_${todayISO()}.json`, JSON.stringify(state, null, 2), 'application/json;charset=utf-8'); }
function importBackup() { const f = $('backupFile')?.files?.[0]; if (!f) return alert('Selecione um arquivo JSON.'); const reader = new FileReader(); reader.onload = () => { try { state = JSON.parse(reader.result); normalizeState(); save(); renderAll(); alert('Backup restaurado.'); } catch { alert('Arquivo inválido.'); } }; reader.readAsText(f); }
function resetSystem() { if (!confirm('Resetar todo o sistema?')) return; state = defaultState(); save(); renderAll(); }

/* =========================
   INICIALIZAÇÃO
========================= */
function bindGlobalEvents() {
  document.addEventListener('input', (e) => {
    if (e.target.closest('#loginScreen')) return;
    if (e.target.matches('input, textarea, select')) autosave();
  });
  document.addEventListener('change', (e) => {
    if (e.target.closest('#loginScreen')) return;
    if (e.target.matches('[data-module-key], #moduleAccessStatus')) draftModules();
  });
}

async function init() {
  text('autosaveStatus', 'Carregando...');
  await load();
  ensureDynamicUI();
  bindGlobalEvents();
  setVal('loginUser', localStorage.getItem('caixa5x_remember') || 'gestao5x@gestao5x.com.br');
  setVal('loginPass', '123456');
  setVal('closingDate', todayISO());
  fillSelects(); renderAll();
  text('autosaveStatus', sb ? 'Supabase conectado' : 'Modo local');
  setTimeout(() => text('autosaveStatus', 'Autosave ativo'), 1200);
  isBooting = false;
}

document.addEventListener('DOMContentLoaded', init);

/* Exposição explícita para onclick inline do HTML */
Object.assign(window, {
  enterApp, logout, showPage, toggleSidebar, closeSidebar, switchCentral, togglePassword, toggleRemember, forgotPassword, openSupport, manualRefresh,
  save, saveClientSetup, clearClientSetup, createStore, createUserFromMaster, toggleUserStore, fillStoreSelect, fillUserManageSelect, loadUserToEdit, fillEditUserStore, saveUserEdit, resetSelectedUserPassword, deleteSelectedUser,
  createRule, renderRulesByCompany, saveImplantStep, saveOperationConfig, renderAll, renderMasterMovementsExtract, renderUsersByCompany,
  fillMasterDivergenceStore, fillMasterExtractStore, fillMasterMovementStore, fillReportStore, renderModuleManager, saveModules, draftModules,
  addEntry, addExpense, removeLaunchRow, calc, syncCoinCountTotal, fillClosingResponsible5X, saveClosing, handleAttachments,
  exportCSV, exportDivergencesCSV, exportTransfersCSV, exportExpensesCSV, exportAuditCSV, exportClientMovementsCSV, exportClientDivergencesCSV, exportContaAzulCSV, exportBackup, importBackup, resetSystem,
  addSelectOption, removeSelectOption, resetSelectOptions, updateStoreFund, deleteCompany, deleteStore, deleteUser, deleteRule,
});
