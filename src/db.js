'use strict';
/* ============================================================
   BANCO DE DADOS / ESTADO — Caixa 5X
   Carregamento, persistência e CRUD contra localStorage + Supabase.
============================================================ */

let state = null;
let saveTimer = null;
let realtimeChannel = null;
let lastOwnSave = 0;
let isBooting = true;
const DEV_LOCAL_MODE = false;
const USE_LOCAL_FALLBACK = DEV_LOCAL_MODE;
const NORMALIZED_TABLES = [
  'companies','stores','profiles','module_permissions','operation_rules','operation_configs',
  'closings','closing_entries','closing_expenses','closing_attachments',
  'cash_opening_adjustments','divergence_reviews','audit_logs','select_options',
  'implant_steps',
];

const IMPLANT_STEP_LIST = [
  { key: 'step_1', name: '1. Cadastro da empresa' },
  { key: 'step_2', name: '2. Cadastro de lojas/caixas' },
  { key: 'step_3', name: '3. Cadastro de operadores' },
  { key: 'step_4', name: '4. Regras de caixa' },
  { key: 'step_5', name: '5. Treinamento' },
  { key: 'step_6', name: '6. Início monitorado' },
];

/* --- Opções padrão de seleção --- */
function defaultSelectOptions() {
  return {
    segments: ['Restaurante / Hamburgueria','Padaria','Varejo','Serviços','Indústria','Outro'],
    plans: ['Operacional','Controladoria','Premium 5X'],
    companyStatus: ['Implantação','Ativa','Pausada','Inativa'],
    cashTypes: ['Caixa diário','Caixa por turno','Caixa central','Caixa delivery'],
    operationModes: ['Diário','Por turno','Por operador'],
    ruleTypes: ['Saída permitida','Repasse','Conferência','Divergência','Checklist'],
    shifts: ['Manhã','Tarde','Noite','Integral','Outro'],
    implantSteps: ['1. Cadastro da empresa','2. Cadastro de lojas/caixas','3. Cadastro de operadores','4. Regras de caixa','5. Treinamento','6. Início monitorado'],
    implantStatus: ['Pendente','Em andamento','Concluído'],
    expenseCategories: ['Ajuda de custo','Taxa de entrega','Compra de mercadoria','Outras saídas'],
    fornecedores: [],
    entryCategories: ['Venda em Dinheiro','Recebimento de Cliente','Outras entradas'],
    clientes: [],
  };
}

/* Categorias cujas opções são específicas por empresa (cada cliente tem sua própria lista).
   As demais categorias do seletor continuam globais para todo o sistema. */
const COMPANY_SCOPED_OPTION_CATEGORIES = ['expenseCategories', 'fornecedores', 'entryCategories', 'clientes'];

function defaultState() {
  return {
    companies: [{ id: 'demo', name: 'Cliente Demonstração', legal: 'Cliente Demonstração LTDA', cnpj: '00.000.000/0001-00', segment: 'Restaurante / Hamburgueria', plan: 'Premium 5X', status: 'Ativa', notes: 'Base demonstrativa' }],
    stores: [{ id: 'demo_store', companyId: 'demo', name: 'Loja 01', code: 'LJ01', cashType: 'Caixa diário', standardFund: 100, status: 'Ativa' }],
    users: [
      { id: 'u_admin', companyId: 'demo', storeId: null,         name: 'ADM Cliente',  login: 'admin@cliente.com',    pass: '', role: 'admin',    status: 'Ativo' },
      { id: 'u_op',    companyId: 'demo', storeId: 'demo_store', name: 'Operador',     login: 'operador@cliente.com', pass: '', role: 'operator', status: 'Ativo' },
    ],
    rules: [],
    closings: [],
    cashOpeningAdjustments: [],
    divergenceReviews: [],
    implant: [],
    implantSteps: {},
    operationConfigs: {},
    modules: {},
    selectOptions: defaultSelectOptions(),
    companySelectOptions: {},
    audit: [],
    transferReceipts: [],
    storeDocuments: [],
    rectificationRequests: [],
  };
}

/* ----------------------------------------------------------------
   REPASSES RECEBIDOS
   Primário: Supabase tabela `transfer_receipts`
   Fallback:  localStorage (DEV_LOCAL_MODE ou sem sessão ativa)
   SQL necessário no Supabase:
     CREATE TABLE transfer_receipts (
       id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
       closing_id   UUID        NOT NULL,
       company_id   UUID,
       store_id     UUID,
       amount       NUMERIC(10,2) DEFAULT 0,
       confirmed_by TEXT,
       notes        TEXT,
       confirmed_at TIMESTAMPTZ DEFAULT now(),
       created_at   TIMESTAMPTZ DEFAULT now()
     );
     ALTER TABLE transfer_receipts ENABLE ROW LEVEL SECURITY;
     CREATE POLICY "allow_all_authenticated" ON transfer_receipts
       FOR ALL USING (auth.role() = 'authenticated');
---------------------------------------------------------------- */
const RECEIPTS_LS_KEY = 'caixa5x_transfer_receipts_v1';

function mapTransferReceipt(row) {
  return {
    id:          row.id,
    closingId:   row.closing_id,
    companyId:   row.company_id,
    storeId:     row.store_id,
    amount:      Number(row.amount || 0),
    confirmedBy: row.confirmed_by || '',
    notes:       row.notes || '',
    confirmedAt: row.confirmed_at || row.created_at,
  };
}

function getTransferReceipts() {
  return state?.transferReceipts || [];
}

function _lsGetReceipts() {
  try { return JSON.parse(localStorage.getItem(RECEIPTS_LS_KEY) || '[]'); } catch { return []; }
}
function _lsSaveReceipts(list) {
  localStorage.setItem(RECEIPTS_LS_KEY, JSON.stringify(list));
}

async function createTransferReceiptRecord(receipt) {
  const row = await supabaseWrite('transfer_receipts', 'insert', cleanPayload({
    id:           isUuid(receipt.id) ? receipt.id : undefined,
    closing_id:   receipt.closingId,
    company_id:   receipt.companyId,
    store_id:     receipt.storeId,
    amount:       receipt.amount,
    confirmed_by: receipt.confirmedBy,
    notes:        receipt.notes || null,
  }));
  return row ? mapTransferReceipt(row) : receipt;
}

async function confirmTransferReceipt(closingId) {
  const c = (state.closings || []).find((x) => x.id === closingId);
  if (!c) return;
  if ((state.transferReceipts || []).find((r) => r.closingId === closingId)) return;

  const receipt = {
    id:          uid('tr'),
    closingId,
    companyId:   c.companyId,
    storeId:     c.storeId,
    amount:      Number(c.transfer || 0),
    confirmedBy: currentUser?.name || 'ADM',
    notes:       '',
    confirmedAt: new Date().toISOString(),
  };

  if (sb && !USE_LOCAL_FALLBACK && hasSupabaseSession()) {
    try {
      const saved = await createTransferReceiptRecord(receipt);
      if (saved?.id) receipt.id = saved.id;
    } catch (e) {
      return alert(`Erro ao confirmar repasse no Supabase: ${e.message}`);
    }
  } else if (!DEV_LOCAL_MODE) {
    return alert('Supabase obrigatório em produção para confirmar repasse.');
  }
  /* Em todos os casos: atualiza o estado em memória e persiste via save() */
  state.transferReceipts = state.transferReceipts || [];
  state.transferReceipts.push(receipt);
  addAudit('Repasse confirmado', `${storeName(c.storeId)} — ${money(c.transfer)} em ${c.date}`);
  save();
  renderAll();
}

async function cancelTransferReceipt(closingId) {
  const receipt = (state.transferReceipts || []).find((r) => r.closingId === closingId);
  if (!receipt) return;
  const c = (state.closings || []).find((x) => x.id === closingId);
  const lojaStr  = storeName(receipt.storeId);
  const valorStr = money(receipt.amount);
  if (!confirm(`Desconfirmar o repasse de ${valorStr} da loja "${lojaStr}"?\n\nO status voltará para "Pendente confirmação".`)) return;
  if (sb && !USE_LOCAL_FALLBACK && hasSupabaseSession()) {
    try {
      const { error } = await sb.from('transfer_receipts').delete().eq('id', receipt.id);
      if (error) throw error;
    } catch (e) {
      return alert(`Erro ao desconfirmar repasse: ${e.message}`);
    }
  } else if (!DEV_LOCAL_MODE) {
    return alert('Supabase obrigatório em produção para desconfirmar repasse.');
  }
  state.transferReceipts = (state.transferReceipts || []).filter((r) => r.id !== receipt.id);
  addAudit('Repasse desconfirmado (Master)', `${lojaStr} — ${valorStr}${c ? ' em ' + c.date : ''}`);
  save();
  renderAll();
  toast('Repasse desconfirmado. Status voltou para pendente.');
}

function normalizeState() {
  state = (state && typeof state === 'object') ? state : defaultState();
  ['companies','stores','users','rules','closings','cashOpeningAdjustments','divergenceReviews','implant','audit','transferReceipts','storeDocuments','rectificationRequests'].forEach((k) => {
    if (!Array.isArray(state[k])) state[k] = [];
  });
  /* Migração: importa recibos salvos na chave antiga (localStorage separado) */
  if (!state.transferReceipts.length) {
    const legacy = _lsGetReceipts();
    if (legacy.length) state.transferReceipts = legacy;
  }
  state.operationConfigs = (state.operationConfigs && typeof state.operationConfigs === 'object') ? state.operationConfigs : {};
  state.modules = (state.modules && typeof state.modules === 'object') ? state.modules : {};
  state.implantSteps = (state.implantSteps && typeof state.implantSteps === 'object' && !Array.isArray(state.implantSteps)) ? state.implantSteps : {};
  state.selectOptions = { ...defaultSelectOptions(), ...(state.selectOptions || {}) };
  state.companySelectOptions = (state.companySelectOptions && typeof state.companySelectOptions === 'object') ? state.companySelectOptions : {};
  state.stores.forEach((s) => { s.standardFund = Number(s.standardFund || 0); });
  state.companies.forEach((c) => {
    if (!state.operationConfigs[c.id]) {
      state.operationConfigs[c.id] = { tolerance: 5, criticalDivergence: 20, transferTolerance: 0, mode: 'Diário', receiver: '', allowed: '', message: '' };
    }
    if (!state.modules[c.id]) state.modules[c.id] = {};
    state.modules[c.id].admin    = mergeModuleConfig('admin',    state.modules[c.id].admin);
    state.modules[c.id].operator = mergeModuleConfig('operator', state.modules[c.id].operator);
    syncModuleAliases(state.modules[c.id].admin);
    syncModuleAliases(state.modules[c.id].operator);
  });
}

function hasSupabaseSession() {
  return !!window.currentUser?.authId;
}

function toMaybeDateBR(date) {
  return date ? toBRFromISO(parseBR(date)) : '';
}

function mapCompany(row) {
  return {
    id: row.id,
    name: row.name,
    legal: row.legal_name || '',
    cnpj: row.cnpj || '',
    segment: row.segment || '',
    plan: row.plan || '',
    status: row.status || 'Ativa',
    notes: row.notes || '',
  };
}

function mapStore(row) {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    code: row.code || '',
    cashType: row.cash_type || '',
    standardFund: Number(row.standard_fund || 0),
    tolerance: row.tolerance,
    criticalDivergence: row.critical_divergence,
    status: row.status || 'Ativa',
  };
}

function mapProfile(row) {
  return {
    id: row.id,
    authId: row.user_id,
    companyId: row.company_id,
    storeId: row.store_id,
    name: row.name,
    login: row.email,
    pass: '',
    role: row.role,
    status: row.status || 'Ativo',
  };
}

function mapOperationConfig(row) {
  return {
    tolerance: Number(row.tolerance || 5),
    criticalDivergence: Number(row.critical_divergence || 20),
    transferTolerance: Number(row.transfer_tolerance || 0),
    mode: row.operation_mode || 'Diário',
    receiver: row.transfer_receiver || '',
    allowed: row.allowed_expenses || '',
    message: row.operator_message || '',
  };
}

function mapClosing(row, entries = [], expenses = [], attachments = []) {
  return {
    id: row.id,
    companyId: row.company_id,
    storeId: row.store_id,
    operatorUserId: row.operator_user_id,
    /* operator mantido para compatibilidade com filtro de histórico do operador */
    operator: row.responsible_name || '',
    date: toMaybeDateBR(row.closing_date),
    shift: row.shift || 'Integral',
    responsible: row.responsible_name || '',
    initial: Number(row.initial_balance || 0),
    entries: Number(row.total_entries || 0),
    entryItems: entries.map((e) => ({ id: e.id, description: e.description, category: e.category || '', client: e.client || '', value: Number(e.amount || 0) })),
    expenses: Number(row.total_expenses || 0),
    expenseItems: expenses.map((e) => ({ id: e.id, description: e.description, category: e.category || '', supplier: e.supplier || '', value: Number(e.amount || 0) })),
    transfer: Number(row.transfer_amount || 0),
    expected: Number(row.expected_cash || 0),
    finalAfterTransfer: Number(row.final_after_transfer || 0),
    cashBalance: Number(row.final_after_transfer || 0),
    standardFund: Number(row.standard_fund_snapshot || 0),
    toleranceSnapshot: Number(row.tolerance_snapshot || 5),
    criticalDivergenceSnapshot: Number(row.critical_divergence_snapshot || 20),
    previousClosingId: row.previous_closing_id,
    previousFinalAfterTransfer: Number(row.previous_final_after_transfer || 0),
    openingDivergence: Number(row.opening_divergence || 0),
    diff: Number(row.fund_divergence || 0),
    fundDivergence: Number(row.fund_divergence || 0),
    notes: row.notes || '',
    attachments: attachments.map((a) => {
      const path = a.file_path || extractStoragePath(a.file_url || '', 'closing-attachments');
      return { id: a.id, name: a.file_name, path, url: a.file_url, type: a.file_type, size: a.file_size, uploadedBy: a.uploaded_by };
    }),
    reviewStatus: row.review_status || 'Pendente',
    status: row.status || '',
    type: row.type || 'Original',
    originalClosingId: row.original_closing_id,
    createdAt: row.created_at,
  };
}

function groupBy(items, key) {
  return (items || []).reduce((acc, item) => {
    const value = item[key];
    acc[value] = acc[value] || [];
    acc[value].push(item);
    return acc;
  }, {});
}

async function selectTable(table, columns = '*') {
  const { data, error } = await sb.from(table).select(columns);
  if (error) throw error;
  return data || [];
}

function applyModuleRows(rows = []) {
  state.modules = {};
  rows.forEach((row) => {
    state.modules[row.company_id] = state.modules[row.company_id] || {};
    state.modules[row.company_id][row.role] = state.modules[row.company_id][row.role] || {};
    state.modules[row.company_id][row.role][row.submodule_key || row.page_key] = !!row.is_enabled;
  });
}

function applySelectOptionRows(rows = []) {
  const defaults = defaultSelectOptions();
  const categoriesInDB = new Set();
  const options = {};
  const companyOptions = {};
  rows.forEach((row) => {
    if (!row.category || !row.value) return;
    if (row.company_id) {
      companyOptions[row.company_id] = companyOptions[row.company_id] || {};
      companyOptions[row.company_id][row.category] = companyOptions[row.company_id][row.category] || [];
      if (!companyOptions[row.company_id][row.category].includes(row.value)) {
        companyOptions[row.company_id][row.category].push(row.value);
      }
      return;
    }
    categoriesInDB.add(row.category);
    options[row.category] = options[row.category] || [];
    if (!options[row.category].includes(row.value)) options[row.category].push(row.value);
  });
  /* Usa defaults apenas para categorias sem nenhum dado no Supabase.
     Categorias com dados no Supabase usam exclusivamente o que está no DB,
     evitando que opções deletadas voltem ao recarregar. */
  Object.keys(defaults).forEach((cat) => {
    if (!categoriesInDB.has(cat)) options[cat] = defaults[cat];
  });
  state.selectOptions = options;
  state.companySelectOptions = companyOptions;
}

function buildImplantStepsState(rows = []) {
  const result = {};
  rows.forEach((row) => {
    if (!result[row.company_id]) result[row.company_id] = {};
    result[row.company_id][row.step_key] = {
      status: row.status || 'Pendente',
      note: row.note || '',
      date: row.updated_at ? row.updated_at.substring(0, 10) : '',
    };
  });
  return result;
}

async function loadFromNormalizedSupabase() {
  const [
    companies, stores, profiles, modulePermissions, rules, operationConfigs,
    closings, entries, expenses, attachments, openingAdjustments, reviews, audit, selectOptions,
    transferReceiptsRows, implantStepsRows, storeDocumentsRows,
  ] = await Promise.all([
    selectTable('companies'),
    selectTable('stores'),
    selectTable('profiles'),
    selectTable('module_permissions'),
    selectTable('operation_rules'),
    selectTable('operation_configs'),
    selectTable('closings'),
    selectTable('closing_entries'),
    selectTable('closing_expenses'),
    selectTable('closing_attachments'),
    selectTable('cash_opening_adjustments'),
    selectTable('divergence_reviews'),
    selectTable('audit_logs'),
    selectTable('select_options'),
    /* tabela criada via SQL no Supabase — ver comentário em confirmTransferReceipt */
    selectTable('transfer_receipts').catch(() => []),
    /* tabela implant_steps — execute o bloco em supabase/schema.sql para ativar */
    selectTable('implant_steps').catch(() => []),
    /* tabela store_documents — execute o bloco em supabase/schema.sql para ativar */
    selectTable('store_documents').catch(() => []),
  ]);

  const entriesByClosing = groupBy(entries, 'closing_id');
  const expensesByClosing = groupBy(expenses, 'closing_id');
  const attachmentsByClosing = groupBy(attachments, 'closing_id');

  state = {
    companies: companies.map(mapCompany),
    stores: stores.map(mapStore),
    users: profiles.map(mapProfile),
    rules: rules.map((r) => ({ id: r.id, companyId: r.company_id, storeId: r.store_id, type: r.type, text: r.rule_text, status: r.status })),
    closings: closings.map((c) => mapClosing(c, entriesByClosing[c.id], expensesByClosing[c.id], attachmentsByClosing[c.id])),
    cashOpeningAdjustments: openingAdjustments.map((a) => ({
      id: a.id, companyId: a.company_id, storeId: a.store_id, authorizedBy: a.authorized_by,
      startDate: a.start_date, shift: a.shift || 'Integral', amount: Number(a.amount || 0),
      reason: a.reason, notes: a.notes || '', createdAt: a.created_at,
    })),
    divergenceReviews: reviews.map((r) => ({
      id: r.id, closingId: r.closing_id, companyId: r.company_id, storeId: r.store_id,
      divergenceType: r.divergence_type, divergenceAmount: Number(r.divergence_amount || 0),
      reviewStatus: r.review_status || 'Pendente', adminComment: r.admin_comment || '',
      reviewedBy: r.reviewed_by, reviewedAt: r.reviewed_at, createdAt: r.created_at, updatedAt: r.updated_at,
    })),
    implant: [],
    implantSteps: buildImplantStepsState(implantStepsRows),
    operationConfigs: operationConfigs.reduce((acc, row) => ({ ...acc, [row.company_id]: mapOperationConfig(row) }), {}),
    modules: {},
    selectOptions: defaultSelectOptions(),
    audit: audit.map((a) => ({
      id: a.id, date: a.created_at, user: a.user_id || 'Sistema', role: '', action: a.action, detail: a.entity || '', metadata: a.metadata,
    })),
    transferReceipts: transferReceiptsRows.map(mapTransferReceipt),
    storeDocuments: storeDocumentsRows.map(mapStoreDocument),
  };
  applyModuleRows(modulePermissions);
  applySelectOptionRows(selectOptions);
  normalizeState();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function load() {
  try {
    if (sb && !USE_LOCAL_FALLBACK && hasSupabaseSession()) {
      await loadFromNormalizedSupabase();
      return;
    }
    if (!state) {
      state = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    }
    /* Se o estado carregado não tem usuários (ex: primeira carga com defaultState vazio),
       tenta recuperar do localStorage antigo que pode ter usuários reais. */
    if (!state?.users?.length) {
      const legacy = JSON.parse(localStorage.getItem('caixa5x_refatorado_v1') || 'null');
      if (Array.isArray(legacy?.users) && legacy.users.length) {
        state = legacy;
        console.info('Dados recuperados do localStorage anterior (caixa5x_refatorado_v1).');
      }
    }
    if (!state) {
      state = defaultState();
    }
  } catch {
    state = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || defaultState();
  }
  normalizeState();
}

function save() {
  normalizeState();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  lastOwnSave = Date.now();
  if (sb && !USE_LOCAL_FALLBACK && hasSupabaseSession()) {
    console.info('Supabase normalizado ativo: persistência por tabelas normalizadas.');
  }
  flash('Salvo');
}

function autosave() {
  if (isBooting) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 600);
}

function addAudit(action, detail = '') {
  if (!state) return;
  const item = {
    id: uid('audit'),
    date: new Date().toISOString(),
    user: currentUser?.name || 'Sistema',
    role,
    action,
    detail,
  };
  state.audit.push(item);
  if (sb && !USE_LOCAL_FALLBACK && hasSupabaseSession()) {
    logAudit(action, 'ui_action', null, { detail }).catch((e) => console.warn('audit_logs:', e));
  }
}

/* --- Realtime --- */
function setupRealtimeSync() {
  if (!sb || realtimeChannel) return;
  realtimeChannel = sb.channel('caixa5x-sync-v2')
    .on('postgres_changes', { event: '*', schema: 'public' }, async (payload) => {
      if (!NORMALIZED_TABLES.includes(payload.table)) return;
      if (Date.now() - lastOwnSave < 2000) return;
      await load();
      renderAll();
      flash('Atualizado');
    })
    .subscribe((status) => {
      text('realtimeStatus', status === 'SUBSCRIBED' ? '● Ao vivo' : '○ Local');
    });
}

function stopRealtimeSync() {
  if (sb && realtimeChannel) {
    try { realtimeChannel.unsubscribe(); } catch {}
    sb.removeChannel(realtimeChannel);
  }
  realtimeChannel = null;
}

async function manualRefresh() {
  await load();
  renderAll();
  flash('Dados atualizados');
}

/* --- Helpers de escopo --- */
function companyName(id) { return state?.companies.find((c) => c.id === id)?.name || '-'; }
function storeName(id) { return state?.stores.find((s) => s.id === id)?.name || '-'; }
function visibleCompanies() {
  if (role === 'master') return state.companies;
  return state.companies.filter((c) => c.id === currentUser?.companyId);
}
function visibleStores() {
  if (role === 'master') return state.stores;
  if (role === 'admin') return state.stores.filter((s) => s.companyId === currentUser?.companyId);
  return state.stores.filter((s) => s.id === currentUser?.storeId);
}
function cfg(companyId) {
  return {
    tolerance: 5, mode: 'Diário',
    receiver: '', allowed: '', message: '',
    rectificationDeadlineDays: 0,
    ...(state?.operationConfigs?.[companyId] || {}),
  };
}

function saveRectificationRequest(req) {
  if (!Array.isArray(state.rectificationRequests)) state.rectificationRequests = [];
  const idx = state.rectificationRequests.findIndex((r) => r.id === req.id);
  if (idx >= 0) state.rectificationRequests[idx] = req;
  else state.rectificationRequests.push(req);
  save();
  renderAll();
}

/* --- CRUD — Empresas --- */
function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function cleanPayload(payload) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

async function supabaseWrite(table, action, payload, match = null) {
  if (!sb || USE_LOCAL_FALLBACK || !hasSupabaseSession()) return null;
  let query;
  if (action === 'insert') query = sb.from(table).insert(payload).select().single();
  if (action === 'upsert') query = sb.from(table).upsert(payload).select().single();
  if (action === 'update') query = sb.from(table).update(payload).match(match).select().single();
  /* .select() no delete retorna as linhas excluídas, permitindo detectar
     falhas silenciosas de RLS (0 linhas excluídas sem erro). */
  if (action === 'delete') query = sb.from(table).delete().match(match).select();
  const { data, error } = await query;
  if (error) throw error;
  if (action === 'delete' && Array.isArray(data) && data.length === 0) {
    throw new Error(`Registro não encontrado ou sem permissão para excluir na tabela "${table}".`);
  }
  lastOwnSave = Date.now();
  return data || null;
}

async function getCompanies() {
  return sb && hasSupabaseSession() ? (await selectTable('companies')).map(mapCompany) : state.companies;
}

async function createCompany(company) {
  const row = await supabaseWrite('companies', 'insert', cleanPayload({
    id: isUuid(company.id) ? company.id : undefined,
    name: company.name,
    legal_name: company.legal,
    cnpj: company.cnpj,
    segment: company.segment,
    plan: company.plan,
    status: company.status || 'Implantação',
    notes: company.notes,
  }));
  return row ? mapCompany(row) : company;
}

async function updateCompany(id, company) {
  const row = await supabaseWrite('companies', 'update', cleanPayload({
    name: company.name,
    legal_name: company.legal,
    cnpj: company.cnpj,
    segment: company.segment,
    plan: company.plan,
    status: company.status,
    notes: company.notes,
  }), { id });
  return row ? mapCompany(row) : company;
}

async function inactivateCompany(id) {
  return updateCompany(id, { status: 'Inativa' });
}

async function deleteCompanyRecord(id) {
  return supabaseWrite('companies', 'delete', {}, { id });
}

async function getStores(companyId = null) {
  if (!sb || !hasSupabaseSession()) return state.stores.filter((s) => !companyId || s.companyId === companyId);
  let query = sb.from('stores').select('*');
  if (companyId) query = query.eq('company_id', companyId);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(mapStore);
}

async function createStoreRecord(store) {
  const row = await supabaseWrite('stores', 'insert', cleanPayload({
    company_id: store.companyId,
    name: store.name,
    code: store.code,
    cash_type: store.cashType,
    standard_fund: store.standardFund,
    status: store.status,
  }));
  return row ? mapStore(row) : store;
}

async function updateStore(id, store) {
  const row = await supabaseWrite('stores', 'update', cleanPayload({
    company_id: store.companyId,
    name: store.name,
    code: store.code,
    cash_type: store.cashType,
    standard_fund: store.standardFund,
    tolerance: store.tolerance ?? null,
    critical_divergence: store.criticalDivergence ?? null,
    status: store.status,
  }), { id });
  return row ? mapStore(row) : store;
}

async function deleteStoreRecord(id) {
  return supabaseWrite('stores', 'delete', {}, { id });
}

async function getProfiles(companyId = null) {
  if (!sb || !hasSupabaseSession()) return state.users.filter((u) => !companyId || u.companyId === companyId);
  let query = sb.from('profiles').select('*');
  if (companyId) query = query.eq('company_id', companyId);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(mapProfile);
}

async function getCurrentProfile() {
  if (!sb) return currentUser;
  const { data: sessionData } = await sb.auth.getSession();
  const authId = sessionData?.session?.user?.id;
  if (!authId) return null;
  const { data, error } = await sb.from('profiles').select('*').eq('user_id', authId).maybeSingle();
  if (error) throw error;
  return data ? mapProfile(data) : null;
}

async function updateProfile(id, profile) {
  const row = await supabaseWrite('profiles', 'update', cleanPayload({
    name: profile.name,
    email: profile.login || profile.email,
    role: profile.role,
    company_id: profile.companyId,
    store_id: profile.storeId,
    status: profile.status,
  }), { id });
  return row ? mapProfile(row) : profile;
}

async function createUserViaEdgeFunction(payload) {
  if (!sb || USE_LOCAL_FALLBACK || !hasSupabaseSession()) throw new Error('Supabase Auth/Sessão obrigatório em produção.');
  const { data, error } = await sb.functions.invoke('create-user', {
    body: payload,
  });
  if (error) {
    let message = error.message || 'Erro ao criar usuário.';
    if (error.context?.json) {
      try {
        const body = await error.context.json();
        if (body?.error) message = body.error;
      } catch {}
    }
    throw new Error(message);
  }
  if (!data?.ok) throw new Error(data?.error || 'Erro ao criar usuário.');
  return data.profile ? mapProfile(data.profile) : null;
}

async function deleteUserViaEdgeFunction(user) {
  if (!sb || USE_LOCAL_FALLBACK || !hasSupabaseSession()) throw new Error('Supabase Auth/Sessão obrigatório em produção.');
  const { data: sessionData } = await sb.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('Sessão não encontrada. Faça login novamente.');

  const response = await fetch(`${SUPABASE_URL}/functions/v1/delete-user`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: user.authId,
      profile_id: user.id,
    }),
  });

  let data = null;
  try { data = await response.json(); } catch {}
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || 'Não foi possível excluir o usuário.');
  }
  return data;
}

async function getModulePermissions(companyId, profileRole) {
  if (!sb || !hasSupabaseSession()) return getModuleConfig(companyId, profileRole);
  const { data, error } = await sb.from('module_permissions').select('*').eq('company_id', companyId).eq('role', profileRole);
  if (error) throw error;
  const config = defaultModuleConfig(profileRole);
  (data || []).forEach((row) => { config[row.submodule_key || row.page_key] = !!row.is_enabled; });
  return config;
}

async function saveModulePermissions(companyId, profileRole, permissions) {
  if (!sb || USE_LOCAL_FALLBACK || !hasSupabaseSession()) return permissions;
  const rows = [];
  (MODULE_TREE[profileRole] || []).forEach((mod) => {
    rows.push({ company_id: companyId, role: profileRole, page_key: mod.key, submodule_key: '', is_enabled: !!permissions[mod.key] });
    (mod.submodules || []).forEach((sub) => rows.push({
      company_id: companyId, role: profileRole, page_key: mod.key, submodule_key: sub.key, is_enabled: !!permissions[sub.key],
    }));
  });
  const { error } = await sb.from('module_permissions').upsert(rows, { onConflict: 'company_id,role,page_key,submodule_key' });
  if (error) throw error;
  lastOwnSave = Date.now();
  return permissions;
}

async function getOperationRules(companyId, storeId = null) {
  if (!sb || !hasSupabaseSession()) return state.rules.filter((r) => r.companyId === companyId && (!storeId || r.storeId === storeId));
  let query = sb.from('operation_rules').select('*').eq('company_id', companyId);
  if (storeId) query = query.or(`store_id.eq.${storeId},store_id.is.null`);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((r) => ({ id: r.id, companyId: r.company_id, storeId: r.store_id, type: r.type, text: r.rule_text, status: r.status }));
}

async function createOperationRule(rule) {
  return supabaseWrite('operation_rules', 'insert', cleanPayload({
    id: isUuid(rule.id) ? rule.id : undefined,
    company_id: rule.companyId,
    store_id: rule.storeId || null,
    type: rule.type,
    rule_text: rule.text,
    status: rule.status || 'Ativa',
  }));
}

async function updateOperationRule(id, rule) {
  return supabaseWrite('operation_rules', 'update', cleanPayload({
    store_id: rule.storeId || null,
    type: rule.type,
    rule_text: rule.text,
    status: rule.status,
  }), { id });
}

async function deleteOperationRule(id) {
  return supabaseWrite('operation_rules', 'delete', {}, { id });
}

async function getOperationConfig(companyId) {
  if (!sb || !hasSupabaseSession()) return cfg(companyId);
  const { data, error } = await sb.from('operation_configs').select('*').eq('company_id', companyId).maybeSingle();
  if (error) throw error;
  return data ? mapOperationConfig(data) : cfg(companyId);
}

async function saveOperationConfigToSupabase(companyId, config) {
  if (!sb || USE_LOCAL_FALLBACK || !hasSupabaseSession()) return null;
  const { data, error } = await sb.from('operation_configs').upsert({
    company_id: companyId,
    tolerance: Number(config.tolerance || 5),
    critical_divergence: Number(config.criticalDivergence || 20),
    transfer_tolerance: Number(config.transferTolerance || 0),
    operation_mode: config.mode || 'Diário',
    transfer_receiver: config.receiver || '',
    allowed_expenses: config.allowed || '',
    operator_message: config.message || '',
  }, { onConflict: 'company_id' }).select().single();
  if (error) throw error;
  lastOwnSave = Date.now();
  return data;
}

async function saveSelectOptionsToSupabase() {
  if (!sb || USE_LOCAL_FALLBACK || !hasSupabaseSession()) return state.selectOptions;
  const rows = [];
  Object.entries(state.selectOptions || {}).forEach(([category, values]) => {
    (values || []).forEach((value) => rows.push({
      company_id: null,
      category,
      value,
      is_global: true,
    }));
  });
  const { error: deleteError } = await sb.from('select_options').delete().eq('is_global', true);
  if (deleteError) throw deleteError;
  if (rows.length) {
    const { error: insertError } = await sb.from('select_options').insert(rows);
    if (insertError) throw insertError;
  }
  lastOwnSave = Date.now();
  return state.selectOptions;
}

/* Opções por empresa (categorias em COMPANY_SCOPED_OPTION_CATEGORIES): retorna a lista
   específica da empresa se existir, senão cai para a lista global (compatibilidade). */
function optionsForCompany(companyId, category) {
  if (COMPANY_SCOPED_OPTION_CATEGORIES.includes(category)) {
    const companyValues = state.companySelectOptions?.[companyId]?.[category];
    if (companyValues?.length) return companyValues;
  }
  return state.selectOptions?.[category] || [];
}

async function saveCompanyOptionsToSupabase(companyId, category) {
  if (!sb || USE_LOCAL_FALLBACK || !hasSupabaseSession()) return;
  const values = state.companySelectOptions?.[companyId]?.[category] || [];
  const { error: deleteError } = await sb.from('select_options')
    .delete().eq('company_id', companyId).eq('category', category);
  if (deleteError) throw deleteError;
  if (values.length) {
    const rows = values.map((value) => ({ company_id: companyId, category, value, is_global: false }));
    const { error: insertError } = await sb.from('select_options').insert(rows);
    if (insertError) throw insertError;
  }
  lastOwnSave = Date.now();
}

async function getClosingsByScope({ companyId = null, storeId = null, startDate = null, endDate = null } = {}) {
  if (!sb || !hasSupabaseSession()) return getScopedClosings({ companyId, storeId, startDate, endDate });
  let query = sb.from('closings').select('*');
  if (companyId) query = query.eq('company_id', companyId);
  if (storeId) query = query.eq('store_id', storeId);
  if (startDate) query = query.gte('closing_date', parseBR(startDate));
  if (endDate) query = query.lte('closing_date', parseBR(endDate));
  const { data, error } = await query.order('closing_date', { ascending: false });
  if (error) throw error;
  return (data || []).map((c) => mapClosing(c));
}

async function checkDuplicateClosing({ storeId, closingDate, shift }) {
  if (!sb || !hasSupabaseSession()) {
    return state.closings.find((c) => c.storeId === storeId && parseBR(c.date) === parseBR(closingDate) && (c.shift || 'Integral') === shift && (c.type === 'Original' || !c.type));
  }
  const { data, error } = await sb.from('closings').select('*')
    .eq('store_id', storeId).eq('closing_date', parseBR(closingDate)).eq('shift', shift).eq('type', 'Original').maybeSingle();
  if (error) throw error;
  return data ? mapClosing(data) : null;
}

async function getPreviousClosing({ storeId, closingDate, shift }) {
  if (!sb || !hasSupabaseSession()) return findPreviousClosing(storeId, parseBR(closingDate), shift);
  const rows = await getClosingsByScope({ storeId, endDate: closingDate });
  return rows.filter((c) => parseBR(c.date) < parseBR(closingDate) || (parseBR(c.date) === parseBR(closingDate) && shiftRank(c.shift || 'Integral') < shiftRank(shift)))
    .sort((a, b) => closingSortValue(b).localeCompare(closingSortValue(a)))[0] || null;
}

async function createClosingEntries(closingId, entries = []) {
  if (!sb || USE_LOCAL_FALLBACK || !hasSupabaseSession() || !entries.length) return entries;
  const { error } = await sb.from('closing_entries').insert(entries.map((e) => ({ closing_id: closingId, description: e.description || 'Entrada', category: e.category || '', client: e.client || '', amount: Number(e.value || 0) })));
  if (error) throw error;
  return entries;
}

async function createClosingExpenses(closingId, expenses = []) {
  if (!sb || USE_LOCAL_FALLBACK || !hasSupabaseSession() || !expenses.length) return expenses;
  const { error } = await sb.from('closing_expenses').insert(expenses.map((e) => ({ closing_id: closingId, description: e.description || 'Saída', category: e.category || '', supplier: e.supplier || '', amount: Number(e.value || 0) })));
  if (error) throw error;
  return expenses;
}

function extractStoragePath(url, bucket) {
  const marker = `/${bucket}/`;
  const idx = url.indexOf(marker);
  return idx >= 0 ? url.slice(idx + marker.length) : url;
}

async function viewStorageFile(bucket, filePath, fileName) {
  if (!filePath) return alert('Arquivo sem caminho definido.');
  if (!sb || USE_LOCAL_FALLBACK || !hasSupabaseSession()) return alert('Login necessário para visualizar o arquivo.');
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(filePath, 3600);
  if (error) return alert('Erro ao gerar link: ' + error.message);
  openFileViewer(data.signedUrl, fileName || filePath.split('/').pop());
}

function openFileViewer(url, fileName) {
  const modal = $('fileViewerModal');
  const content = $('fileViewerContent');
  const titleEl = $('fileViewerTitle');
  if (!modal || !content) return window.open(url, '_blank', 'noopener,noreferrer');
  const ext = (fileName || '').split('.').pop().toLowerCase();
  if (titleEl) titleEl.textContent = fileName || 'Arquivo';
  content.innerHTML = ext === 'pdf'
    ? `<iframe src="${url}" style="width:100%;height:70vh;border:none;border-radius:6px"></iframe>`
    : `<img src="${url}" alt="${esc(fileName || 'Imagem')}" style="max-width:100%;max-height:70vh;object-fit:contain;border-radius:6px;display:block;margin:auto">`;
  modal.style.display = 'flex';
}

function closeFileViewer() {
  const modal = $('fileViewerModal');
  const content = $('fileViewerContent');
  if (modal) modal.style.display = 'none';
  if (content) content.innerHTML = '';
}

async function createClosingAttachments(closingId, attachments = []) {
  if (!sb || USE_LOCAL_FALLBACK || !hasSupabaseSession() || !attachments.length) return [];
  const rows = [];
  for (const attachment of attachments) {
    const file = attachment.file;
    if (!file) continue;
    const safeName = String(file.name || attachment.name || 'anexo').replace(/[^\w.\-]+/g, '_');
    const path = `${closingId}/${Date.now()}_${safeName}`;
    const { error: uploadError } = await sb.storage
      .from('closing-attachments')
      .upload(path, file, { upsert: false, contentType: file.type || attachment.type || 'application/octet-stream' });
    if (uploadError) throw uploadError;
    rows.push({
      closing_id: closingId,
      file_name: file.name || attachment.name,
      file_path: path,
      file_url:  path,
      file_type: file.type || attachment.type || '',
      file_size: file.size || attachment.size || 0,
      uploaded_by: currentUser?.authId || null,
    });
  }
  if (!rows.length) return [];
  const { data, error } = await sb.from('closing_attachments').insert(rows).select('*');
  if (error) throw error;
  lastOwnSave = Date.now();
  return data || [];
}

async function getClosingEntries(closingId) {
  if (!sb || !hasSupabaseSession()) return [];
  const { data, error } = await sb.from('closing_entries').select('*').eq('closing_id', closingId);
  if (error) throw error;
  return data || [];
}

async function getClosingExpenses(closingId) {
  if (!sb || !hasSupabaseSession()) return [];
  const { data, error } = await sb.from('closing_expenses').select('*').eq('closing_id', closingId);
  if (error) throw error;
  return data || [];
}

async function createClosing(closing) {
  if (!sb || USE_LOCAL_FALLBACK || !hasSupabaseSession()) return closing;
  const oldId = closing.id;
  const row = await supabaseWrite('closings', 'insert', cleanPayload({
    id: isUuid(closing.id) ? closing.id : undefined,
    company_id: closing.companyId,
    store_id: closing.storeId,
    operator_user_id: currentUser?.authId || undefined,
    responsible_name: closing.responsible,
    closing_date: parseBR(closing.date),
    shift: closing.shift || 'Integral',
    initial_balance: closing.initial,
    total_entries: closing.entries,
    total_expenses: closing.expenses,
    expected_cash: closing.expected,
    transfer_amount: closing.transfer,
    final_after_transfer: closing.finalAfterTransfer,
    standard_fund_snapshot: closing.standardFund,
    tolerance_snapshot: closing.toleranceSnapshot,
    critical_divergence_snapshot: closing.criticalDivergenceSnapshot,
    previous_closing_id: isUuid(closing.previousClosingId) ? closing.previousClosingId : null,
    previous_final_after_transfer: closing.previousFinalAfterTransfer,
    opening_divergence: closing.openingDivergence,
    fund_divergence: closing.fundDivergence ?? closing.diff,
    status: closing.status,
    review_status: closing.reviewStatus,
    notes: closing.notes,
    type: closing.type || 'Original',
    original_closing_id: isUuid(closing.originalClosingId) ? closing.originalClosingId : null,
  }));
  if (row?.id && row.id !== oldId) {
    closing.id = row.id;
    state.closings.forEach((c) => { if (c.id === oldId) c.id = row.id; });
    state.divergenceReviews.forEach((r) => { if (r.closingId === oldId) r.closingId = row.id; });
  }
  /* Entradas e saídas são registros de detalhe — erros são fatais para manter integridade */
  await createClosingEntries(closing.id, closing.entryItems || []);
  await createClosingExpenses(closing.id, closing.expenseItems || []);
  const attachmentRows = await createClosingAttachments(closing.id, closing.attachments || []);
  if (attachmentRows.length) {
    closing.attachments = attachmentRows.map((a) => ({
      id: a.id,
      name: a.file_name,
      url: a.file_url,
      type: a.file_type,
      size: a.file_size,
      uploadedBy: a.uploaded_by,
    }));
  }
  /* Divergence reviews são registros secundários: falha de RLS não deve bloquear o fechamento.
     Usar allSettled para não derrubar toda a operação por falha de permissão nessa tabela. */
  const reviewResults = await Promise.allSettled(
    (state.divergenceReviews || [])
      .filter((r) => r.closingId === closing.id)
      .map((r) => createDivergenceReview(r))
  );
  reviewResults.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.warn(`[createClosing] divergence_review[${i}] falhou (não crítico):`, result.reason?.message || result.reason);
    }
  });
  return closing;
}

async function updateClosing(id, closing) {
  return supabaseWrite('closings', 'update', cleanPayload({
    review_status: closing.reviewStatus,
    notes: closing.notes,
    status: closing.status,
  }), { id });
}

async function softDeleteClosing(id) {
  return supabaseWrite('closings', 'update', { type: 'Excluído' }, { id });
}

async function createCashOpeningAdjustment(adjustment) {
  return supabaseWrite('cash_opening_adjustments', 'insert', cleanPayload({
    id: isUuid(adjustment.id) ? adjustment.id : undefined,
    company_id: adjustment.companyId,
    store_id: adjustment.storeId,
    authorized_by: currentUser?.authId || undefined,
    start_date: parseBR(adjustment.startDate),
    shift: adjustment.shift || 'Integral',
    amount: adjustment.amount,
    reason: adjustment.reason,
    notes: adjustment.notes,
  }));
}

async function getCashOpeningAdjustment({ storeId, date, shift }) {
  if (!sb || !hasSupabaseSession()) return findOpeningAdjustment(storeId, parseBR(date), shift);
  const { data, error } = await sb.from('cash_opening_adjustments').select('*')
    .eq('store_id', storeId).lte('start_date', parseBR(date)).in('shift', [shift, 'Integral'])
    .order('start_date', { ascending: false }).limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

async function createDivergenceReview(review) {
  return supabaseWrite('divergence_reviews', 'insert', cleanPayload({
    id: isUuid(review.id) ? review.id : undefined,
    closing_id: review.closingId,
    company_id: review.companyId,
    store_id: review.storeId,
    divergence_type: review.divergenceType,
    divergence_amount: review.divergenceAmount,
    review_status: review.reviewStatus || 'Pendente',
    admin_comment: review.adminComment || null,
    reviewed_by: isUuid(review.reviewedBy) ? review.reviewedBy : null,
    reviewed_at: review.reviewedAt || null,
  }));
}

async function getPendingDivergenceReviews() {
  if (!sb || !hasSupabaseSession()) return (state.divergenceReviews || []).filter((r) => (r.reviewStatus || 'Pendente') === 'Pendente');
  const { data, error } = await sb.from('divergence_reviews').select('*').eq('review_status', 'Pendente');
  if (error) throw error;
  return data || [];
}

async function updateDivergenceReview(id, review) {
  return supabaseWrite('divergence_reviews', 'update', cleanPayload({
    review_status: review.reviewStatus,
    admin_comment: review.adminComment,
    reviewed_by: currentUser?.authId || undefined,
    reviewed_at: review.reviewedAt || new Date().toISOString(),
  }), { id });
}

async function logAudit(action, entity = null, entityId = null, metadata = {}) {
  return supabaseWrite('audit_logs', 'insert', cleanPayload({
    user_id: currentUser?.authId || undefined,
    company_id: currentUser?.companyId || metadata.companyId || undefined,
    store_id: currentUser?.storeId || metadata.storeId || undefined,
    action,
    entity,
    entity_id: isUuid(entityId) ? entityId : undefined,
    metadata,
  }));
}

async function saveClientSetup() {
  const name = val('setupCompanyName').trim();
  if (!name) return alert('Informe o nome fantasia da empresa.');
  const companyId = uid('c');
  const storeId = uid('s');
  if (sb && !USE_LOCAL_FALLBACK && hasSupabaseSession()) {
    const company = {
      id: companyId, name,
      legal: val('setupCompanyLegal'), cnpj: val('setupCompanyCnpj'),
      segment: val('setupSegment'), plan: val('setupPlan'),
      status: val('setupStatus') || 'Implantação', notes: val('setupNotes'),
    };
    const operationConfig = { tolerance: 5, criticalDivergence: 20, transferTolerance: 0, mode: 'Diário', receiver: '', allowed: '', message: '' };
    const moduleConfig = {
      admin: { ...defaultModuleConfig('admin'), adminClosing: false },
      operator: defaultModuleConfig('operator'),
    };
    try {
      const companyRow = await createCompany(company);
      const storeRow = await createStoreRecord({
        id: storeId, companyId: companyRow.id,
        name: val('setupStoreName') || 'Loja 01',
        code: val('setupStoreCode') || 'LJ01',
        cashType: val('setupCashType') || 'Caixa diário',
        standardFund: Number(val('setupStoreFund')) || 100,
        status: 'Ativa',
      });
      state.companies.push(companyRow);
      state.stores.push(storeRow);
      state.operationConfigs[companyRow.id] = operationConfig;
      state.modules[companyRow.id] = moduleConfig;
      await saveOperationConfigToSupabase(companyRow.id, operationConfig);
      await saveModulePermissions(companyRow.id, 'admin', moduleConfig.admin);
      await saveModulePermissions(companyRow.id, 'operator', moduleConfig.operator);
      await logAudit('Cadastro de cliente', 'company', companyRow.id, { name });
      clearClientSetup();
      save();
      renderAll();
      toast('Cliente cadastrado com sucesso.');
    } catch (e) {
      alert(`Erro ao cadastrar cliente no Supabase: ${e.message}`);
    }
    return;
  }
  if (!DEV_LOCAL_MODE) return alert('Supabase Auth/Sessão obrigatório em produção. Configure o Supabase antes de cadastrar clientes.');
  state.companies.push({
    id: companyId, name,
    legal: val('setupCompanyLegal'), cnpj: val('setupCompanyCnpj'),
    segment: val('setupSegment'), plan: val('setupPlan'),
    status: val('setupStatus') || 'Implantação', notes: val('setupNotes'),
  });
  const store = {
    id: storeId, companyId,
    name: val('setupStoreName') || 'Loja 01',
    code: val('setupStoreCode') || 'LJ01',
    cashType: val('setupCashType') || 'Caixa diário',
    standardFund: Number(val('setupStoreFund')) || 100,
    status: 'Ativa',
  };
  if (sb && !USE_LOCAL_FALLBACK && hasSupabaseSession()) {
    try {
      const row = await createStoreRecord(store);
      store.id = row.id;
    } catch (e) {
      return alert(`Erro ao salvar loja no Supabase: ${e.message}`);
    }
  } else if (!DEV_LOCAL_MODE) {
    return alert('Supabase Auth/Sessão obrigatório em produção. Configure o Supabase antes de cadastrar lojas.');
  }
  state.stores.push(store);
  if (val('setupAdminLogin')) {
    state.users.push({
      id: uid('u'), companyId, storeId: null,
      name: val('setupAdminName') || 'ADM Cliente',
      login: val('setupAdminLogin'), pass: val('setupAdminPass'),
      role: 'admin', status: 'Ativo',
    });
  }
  if (val('setupOperatorLogin')) {
    state.users.push({
      id: uid('u'), companyId, storeId,
      name: val('setupOperatorName') || 'Operador',
      login: val('setupOperatorLogin'), pass: val('setupAdminPass'),
      role: 'operator', status: 'Ativo',
    });
  }
  state.operationConfigs[companyId] = { tolerance: 5, criticalDivergence: 20, transferTolerance: 0, mode: 'Diário', receiver: '', allowed: '', message: '' };
  state.modules[companyId] = {
    admin: { ...defaultModuleConfig('admin'), adminClosing: false },
    operator: defaultModuleConfig('operator'),
  };
  addAudit('Cadastro de cliente', name);
  clearClientSetup();
  save();
  renderAll();
  toast('Cliente cadastrado com sucesso.');
}

function clearClientSetup() {
  ['setupCompanyName','setupCompanyLegal','setupCompanyCnpj','setupAdminName','setupAdminLogin',
   'setupOperatorName','setupOperatorLogin','setupStoreName','setupStoreCode','setupNotes'].forEach(clear);
  setVal('setupAdminPass', '');
  setVal('setupStoreFund', 100);
}

async function toggleCompany(id) {
  const c = state.companies.find((x) => x.id === id);
  if (!c) return;
  c.status = c.status === 'Inativa' ? 'Ativa' : 'Inativa';
  if (sb && !USE_LOCAL_FALLBACK && hasSupabaseSession()) {
    try {
      await updateCompany(c.id, c);
    } catch (e) {
      return alert(`Erro ao atualizar empresa no Supabase: ${e.message}`);
    }
  } else if (!DEV_LOCAL_MODE) {
    return alert('Supabase Auth/Sessão obrigatório em produção para atualizar empresas.');
  }
  addAudit(`Empresa ${c.status === 'Inativa' ? 'inativada' : 'ativada'}`, c.name);
  save();
  renderAll();
}

async function deleteCompany(id) {
  if (!confirm('Excluir empresa e todos os dados vinculados?')) return;
  if (sb && !USE_LOCAL_FALLBACK && hasSupabaseSession()) {
    try {
      await deleteCompanyRecord(id);
    } catch (e) {
      return alert(`Erro ao excluir empresa no Supabase: ${e.message}`);
    }
  } else if (!DEV_LOCAL_MODE) {
    return alert('Supabase Auth/Sessão obrigatório em produção para excluir empresas.');
  }
  state.companies = state.companies.filter((c) => c.id !== id);
  state.stores = state.stores.filter((s) => s.companyId !== id);
  state.users = state.users.filter((u) => u.companyId !== id);
  state.rules = state.rules.filter((r) => r.companyId !== id);
  state.closings = state.closings.filter((c) => c.companyId !== id);
  delete state.operationConfigs[id];
  delete state.modules[id];
  save();
  renderAll();
}

/* --- CRUD — Lojas --- */
async function createStore() {
  const cid = val('storeCompany');
  const name = val('storeName').trim();
  if (!cid) return alert('Selecione a empresa.');
  if (!name) return alert('Informe o nome da loja.');
  const code = val('storeCode').trim();
  const exists = state.stores.some((s) =>
    s.companyId === cid &&
    (s.name.toLowerCase() === name.toLowerCase() ||
     (code && String(s.code).toLowerCase() === code.toLowerCase()))
  );
  if (exists) return alert('Já existe uma loja com este nome ou código nesta empresa.');
  const store = {
    id: uid('s'), companyId: cid, name, code,
    cashType: val('storeCashType') || 'Caixa diário',
    standardFund: Number(val('storeStandardFund')) || 0,
    status: val('storeStatus') || 'Ativa',
  };
  if (sb && !USE_LOCAL_FALLBACK && hasSupabaseSession()) {
    try {
      const row = await createStoreRecord(store);
      store.id = row.id;
    } catch (e) {
      return alert(`Erro ao salvar loja no Supabase: ${e.message}`);
    }
  } else if (!DEV_LOCAL_MODE) {
    return alert('Supabase Auth/Sessão obrigatório em produção. Configure o Supabase antes de cadastrar lojas.');
  }
  state.stores.push(store);
  ['storeName','storeCode'].forEach(clear);
  setVal('storeStandardFund', 100);
  addAudit('Cadastro de loja', name);
  save();
  renderAll();
}

async function updateStoreFund(id, value) {
  const s = state.stores.find((x) => x.id === id);
  if (!s) return;
  const old = s.standardFund;
  s.standardFund = Number(value) || 0;
  if (sb && !USE_LOCAL_FALLBACK && hasSupabaseSession()) {
    try {
      await updateStore(s.id, s);
    } catch (e) {
      s.standardFund = old;
      return alert(`Erro ao atualizar fundo no Supabase: ${e.message}`);
    }
  } else if (!DEV_LOCAL_MODE) {
    s.standardFund = old;
    return alert('Supabase Auth/Sessão obrigatório em produção para atualizar fundo padrão.');
  }
  addAudit('Alteração de fundo padrão', `${s.name}: ${money(old)} → ${money(s.standardFund)}`);
  save();
  renderAll();
}

function loadStoreToEdit(id) {
  const s = state.stores.find((x) => x.id === id);
  if (!s) return;
  setVal('editStoreId', s.id);
  setVal('editStoreName', s.name);
  setVal('editStoreCode', s.code || '');
  setVal('editStoreStandardFund', String(s.standardFund || 0));
  setVal('editStoreStatus', s.status || 'Ativa');
  setVal('editStoreCashType', s.cashType || 'Caixa diário');
  /* popular select de empresa */
  const sel = $('editStoreCompany');
  if (sel) {
    sel.innerHTML = state.companies.map((c) => `<option value="${c.id}"${c.id === s.companyId ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
  }
  const modal = $('editStoreModal');
  if (modal) { modal.style.display = 'flex'; }
}

function closeEditStoreModal() {
  const modal = $('editStoreModal');
  if (modal) modal.style.display = 'none';
}

async function saveStoreEdit() {
  const id = val('editStoreId');
  const s  = state.stores.find((x) => x.id === id);
  if (!s) return alert('Loja não encontrada.');
  const name = val('editStoreName').trim();
  if (!name) return alert('Informe o nome da loja.');
  const updated = {
    ...s,
    companyId:    val('editStoreCompany')    || s.companyId,
    name,
    code:         val('editStoreCode').trim(),
    cashType:     val('editStoreCashType')   || s.cashType,
    standardFund: Number(val('editStoreStandardFund')) || 0,
    status:       val('editStoreStatus')     || s.status,
  };
  if (sb && !USE_LOCAL_FALLBACK && hasSupabaseSession()) {
    try { await updateStore(id, updated); } catch (e) { return alert(`Erro ao salvar: ${e.message}`); }
  } else if (!DEV_LOCAL_MODE) {
    return alert('Supabase obrigatório em produção.');
  }
  Object.assign(s, updated);
  addAudit('Edição de loja', `${s.name}`);
  closeEditStoreModal();
  save();
  renderAll();
}

async function deleteStore(id) {
  const hasClosings = (state.closings || []).some((c) => c.storeId === id);
  const storeName_ = state.stores.find((s) => s.id === id)?.name || id;
  const msg = hasClosings
    ? `A loja "${storeName_}" possui fechamentos vinculados. Excluí-la removerá esses registros. Confirma?`
    : `Excluir a loja "${storeName_}"?`;
  if (!confirm(msg)) return;
  if (sb && !USE_LOCAL_FALLBACK && hasSupabaseSession()) {
    try {
      await deleteStoreRecord(id);
    } catch (e) {
      return alert(`Erro ao excluir loja no Supabase: ${e.message}`);
    }
  } else if (!DEV_LOCAL_MODE) {
    return alert('Supabase Auth/Sessão obrigatório em produção para excluir lojas.');
  }
  state.stores = state.stores.filter((s) => s.id !== id);
  state.closings = state.closings.filter((c) => c.storeId !== id);
  state.users.forEach((u) => { if (u.storeId === id) u.storeId = null; });
  save();
  renderAll();
}

/* --- CRUD — Usuários --- */
async function createUserFromMaster() {
  const cid = val('opCompany');
  const roleNew = val('newUserRole') || 'operator';
  const nameNew = val('opName');
  const loginNew = val('opLogin');
  if (!cid) return alert('Selecione a empresa.');
  if (!nameNew || !loginNew) return alert('Informe nome e login.');
  if (state.users.some((u) => String(u.login).toLowerCase() === loginNew.toLowerCase())) {
    return alert('Já existe usuário com este login.');
  }
  const storeId = roleNew === 'operator' ? val('opStore') : null;
  if (roleNew === 'operator' && !storeId) return alert('Selecione a loja do operador.');
  const password = val('opPass');
  if (!password || password.length < 6) return alert('Informe uma senha com pelo menos 6 caracteres.');

  if (!DEV_LOCAL_MODE) {
    try {
      const profile = await createUserViaEdgeFunction({
        name: nameNew,
        email: loginNew,
        password,
        role: roleNew,
        company_id: cid,
        store_id: storeId,
      });
      if (profile) state.users.push(profile);
      ['opName','opLogin'].forEach(clear);
      setVal('opPass', '');
      addAudit('Cadastro de usuário', loginNew);
      save();
      setVal('usersCompanyFilter', profile?.companyId || cid);
      setVal('userManageCompany', profile?.companyId || cid);
      renderAll();
      fillUserManageSelect();
      if (profile?.id) {
        setVal('userManageSelect', profile.id);
        loadUserToEdit();
      }
      return toast('Usuário cadastrado com sucesso.');
    } catch (e) {
      const message = String(e.message || '');
      if (message.toLowerCase().includes('e-mail') || message.toLowerCase().includes('email') || message.toLowerCase().includes('already')) {
        return alert('Já existe um usuário cadastrado com este e-mail.');
      }
      return alert('Não foi possível cadastrar o usuário. Verifique os dados e tente novamente.');
    }
  }

  state.users.push({
    id: uid('u'), companyId: cid, storeId,
    name: nameNew, login: loginNew,
    pass: password,
    role: roleNew, status: 'Ativo',
  });
  ['opName','opLogin'].forEach(clear);
  setVal('opPass', '');
  addAudit('Cadastro de usuário', loginNew);
  save();
  setVal('usersCompanyFilter', cid);
  setVal('userManageCompany', cid);
  renderAll();
  fillUserManageSelect();
  const created = state.users[state.users.length - 1];
  setVal('userManageSelect', created.id);
  loadUserToEdit();
  toast('Usuário cadastrado com sucesso.');
}

function loadUserToEdit() {
  const u = state.users.find((x) => x.id === val('userManageSelect'));
  if (!u) return;
  setVal('editUserName', u.name);
  setVal('editUserLogin', u.login);
  setVal('editUserRole', u.role);
  setVal('editUserStatus', u.status || 'Ativo');
  setVal('editUserPass', '');
  fillEditUserStore();
  setVal('editUserStore', u.storeId || '');
}

async function saveUserEdit() {
  const u = state.users.find((x) => x.id === val('userManageSelect'));
  if (!u) return alert('Selecione um usuário.');
  u.name = val('editUserName');
  u.login = val('editUserLogin');
  u.role = val('editUserRole');
  u.status = val('editUserStatus') || 'Ativo';
  u.storeId = u.role === 'operator' ? val('editUserStore') : null;
  if (sb && !USE_LOCAL_FALLBACK && hasSupabaseSession()) {
    try {
      await updateProfile(u.id, u);
    } catch (e) {
      return alert(`Erro ao atualizar profile no Supabase: ${e.message}`);
    }
  } else if (DEV_LOCAL_MODE && val('editUserPass')) {
    u.pass = val('editUserPass');
  } else if (!DEV_LOCAL_MODE) {
    return alert('Supabase Auth/Sessão obrigatório em produção para atualizar usuários.');
  }
  addAudit('Edição de usuário', u.login);
  save();
  renderAll();
  toast('Usuário atualizado.');
}

async function resetSelectedUserPassword() {
  const u = state.users.find((x) => x.id === val('userManageSelect'));
  if (!u) return alert('Selecione um usuário.');
  if (DEV_LOCAL_MODE) {
    u.pass = '';
    addAudit('Reset de senha', u.login);
    save();
    return alert('Senha local removida.');
  }
  if (!u.authId) return alert('Este usuário não possui vínculo com o Supabase Auth. Crie-o novamente pelo sistema.');
  const newPass = prompt(`Nova senha para ${u.name}:\n(Mínimo 6 caracteres)`);
  if (!newPass) return;
  if (newPass.length < 6) return alert('A senha precisa ter pelo menos 6 caracteres.');
  try {
    await resetUserPasswordViaEdgeFunction(u.authId, newPass);
    addAudit('Reset de senha', u.login);
    save();
    toast('Senha redefinida com sucesso.');
  } catch (e) {
    alert('Erro ao redefinir senha: ' + (e.message || 'tente novamente.'));
  }
}

async function resetUserPasswordViaEdgeFunction(authId, newPassword) {
  if (!sb || !hasSupabaseSession()) throw new Error('Sessão obrigatória. Faça login novamente.');
  const { data: sessionData } = await sb.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('Sessão não encontrada. Faça login novamente.');
  const response = await fetch(`${SUPABASE_URL}/functions/v1/reset-user-password`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: authId, new_password: newPassword }),
  });
  let data = null;
  try { data = await response.json(); } catch {}
  if (!response.ok || !data?.ok) throw new Error(data?.error || 'Não foi possível redefinir a senha.');
  return data;
}

async function removeUserById(id) {
  const u = state.users.find((x) => x.id === id);
  if (!u) return alert('Selecione um usuário.');
  if (!confirm('Tem certeza que deseja excluir este usuário? Ele perderá acesso ao sistema.')) return;
  if (currentUser?.authId && u.authId === currentUser.authId) {
    return alert('Você não pode excluir seu próprio usuário.');
  }

  if (!DEV_LOCAL_MODE) {
    try {
      await deleteUserViaEdgeFunction(u);
    } catch (e) {
      const message = String(e.message || '');
      if (message.includes('próprio')) return alert('Você não pode excluir seu próprio usuário.');
      if (message.includes('Master')) return alert('Apenas o perfil Master pode excluir usuários.');
      return alert('Não foi possível excluir o usuário.');
    }
  }

  state.users = state.users.filter((user) => user.id !== id);
  setVal('userManageSelect', '');
  save();
  renderAll();
  fillUserManageSelect();
  toast('Usuário excluído com sucesso.');
}

function deleteSelectedUser() {
  const id = val('userManageSelect');
  if (!id) return alert('Selecione um usuário.');
  removeUserById(id);
}

function deleteUser(id) {
  removeUserById(id);
}

/* --- CRUD — Regras --- */
async function createRule() {
  const cid = val('ruleCompany');
  if (!cid || !val('ruleText')) return alert('Selecione a empresa e informe a regra.');
  const rule = { id: uid('r'), companyId: cid, type: val('ruleType'), text: val('ruleText') };
  if (sb && !USE_LOCAL_FALLBACK && hasSupabaseSession()) {
    try {
      const row = await createOperationRule(rule);
      if (row?.id) rule.id = row.id;
    } catch (e) {
      return alert(`Erro ao salvar regra no Supabase: ${e.message}`);
    }
  } else if (!DEV_LOCAL_MODE) {
    return alert('Supabase Auth/Sessão obrigatório em produção para salvar regras.');
  }
  state.rules.push(rule);
  clear('ruleText');
  addAudit('Cadastro de regra', companyName(cid));
  save();
  renderAll();
}

async function deleteRule(id) {
  if (!confirm('Excluir regra?')) return;
  if (sb && !USE_LOCAL_FALLBACK && hasSupabaseSession()) {
    try {
      await deleteOperationRule(id);
    } catch (e) {
      return alert(`Erro ao excluir regra no Supabase: ${e.message}`);
    }
  } else if (!DEV_LOCAL_MODE) {
    return alert('Supabase Auth/Sessão obrigatório em produção para excluir regras.');
  }
  state.rules = state.rules.filter((r) => r.id !== id);
  save();
  renderAll();
}

/* --- Implantação (checklist editável por empresa, sincronizado com Supabase) --- */
async function upsertImplantStep(companyId, stepKey, stepName, status, note) {
  if (!companyId || !stepKey) return;
  if (!state.implantSteps) state.implantSteps = {};
  if (!state.implantSteps[companyId]) state.implantSteps[companyId] = {};
  state.implantSteps[companyId][stepKey] = { status: status || 'Pendente', note: note || '', date: todayISO() };

  if (sb && !USE_LOCAL_FALLBACK && hasSupabaseSession()) {
    try {
      const { error } = await sb.from('implant_steps').upsert({
        company_id: companyId,
        step_key: stepKey,
        step_name: stepName,
        status: status || 'Pendente',
        note: note || null,
      }, { onConflict: 'company_id,step_key' });
      if (error) {
        const msg = String(error.message || error.code || '');
        const isMissingTable = msg.includes('42P01') || msg.includes('schema cache') || msg.includes('does not exist') || msg.includes('Could not find');
        if (isMissingTable) {
          console.warn('Tabela implant_steps não encontrada. Execute o SQL em supabase/schema.sql.');
        } else {
          throw error;
        }
      }
    } catch (e) {
      const msg = String(e.message || '');
      const isMissingTable = msg.includes('42P01') || msg.includes('schema cache') || msg.includes('does not exist') || msg.includes('Could not find');
      if (!isMissingTable) return alert(`Erro ao salvar etapa: ${e.message}`);
      console.warn('implant_steps não existe — salvo apenas localmente.');
    }
  } else if (!DEV_LOCAL_MODE && !hasSupabaseSession()) {
    return alert('Supabase Auth/Sessão obrigatório em produção para salvar etapas.');
  }

  addAudit('Implantação', `${companyName(companyId)} — ${stepName}: ${status}`);
  lastOwnSave = Date.now();
  save();
  renderCadastros();
  toast(`Etapa "${stepName}" → ${status}`);
}

function saveImplantStep() {
  /* stub de compatibilidade — substituído por upsertImplantStep */
}

/* --- Configuração operacional --- */
async function saveOperationConfig() {
  const cid = val('operationCompany');
  if (!cid) return alert('Selecione a empresa.');
  const config = {
    tolerance: Number(val('operationTolerance')) || 5,
    transferTolerance: Number(val('operationTransferTolerance')) || 0,
    mode: val('operationMode') || 'Diário',
    receiver: val('operationReceiver'),
    allowed: val('operationAllowed'),
    message: val('operationMessage'),
    rectificationDeadlineDays: Number(val('operationRectificationDays') ?? 0) || 0,
  };
  if (sb && !USE_LOCAL_FALLBACK && hasSupabaseSession()) {
    try {
      await saveOperationConfigToSupabase(cid, config);
    } catch (e) {
      return alert(`Erro ao salvar configuração no Supabase: ${e.message}`);
    }
  } else if (!DEV_LOCAL_MODE) {
    return alert('Supabase Auth/Sessão obrigatório em produção para salvar configuração.');
  }
  state.operationConfigs[cid] = config;
  addAudit('Configuração operacional', companyName(cid));
  save();
  renderAll();
}

/* --- Opções de seleção --- */
async function addSelectOption() {
  const key = val('optionCategory');
  const value = val('optionNewValue').trim();
  if (!key || !value) return alert('Selecione o campo e informe a opção.');

  if (COMPANY_SCOPED_OPTION_CATEGORIES.includes(key)) {
    const companyId = val('optionCompany');
    if (!companyId) return alert('Selecione a empresa para esta categoria.');
    state.companySelectOptions[companyId] = state.companySelectOptions[companyId] || {};
    state.companySelectOptions[companyId][key] = state.companySelectOptions[companyId][key] || [];
    if (state.companySelectOptions[companyId][key].includes(value)) return;
    state.companySelectOptions[companyId][key].push(value);
    if (sb && !USE_LOCAL_FALLBACK && hasSupabaseSession()) {
      try {
        await saveCompanyOptionsToSupabase(companyId, key);
      } catch (e) {
        state.companySelectOptions[companyId][key] = state.companySelectOptions[companyId][key].filter((v) => v !== value);
        renderAll();
        return alert(`Não foi possível salvar a alteração. Tente novamente.\n(${e.message})`);
      }
    } else if (!DEV_LOCAL_MODE) {
      state.companySelectOptions[companyId][key] = state.companySelectOptions[companyId][key].filter((v) => v !== value);
      return alert('Supabase Auth/Sessão obrigatório em produção para salvar opções.');
    }
    clear('optionNewValue');
    save();
    renderAll();
    return;
  }

  state.selectOptions[key] = state.selectOptions[key] || [];
  if (state.selectOptions[key].includes(value)) return;
  state.selectOptions[key].push(value);
  if (sb && !USE_LOCAL_FALLBACK && hasSupabaseSession()) {
    try {
      await saveSelectOptionsToSupabase();
    } catch (e) {
      /* Reverte a adição em memória para não mentir ao usuário */
      state.selectOptions[key] = state.selectOptions[key].filter((v) => v !== value);
      renderAll();
      return alert(`Não foi possível salvar a alteração. Tente novamente.\n(${e.message})`);
    }
  } else if (!DEV_LOCAL_MODE) {
    state.selectOptions[key] = state.selectOptions[key].filter((v) => v !== value);
    return alert('Supabase Auth/Sessão obrigatório em produção para salvar opções.');
  }
  clear('optionNewValue');
  save();
  renderAll();
}

async function removeSelectOption(key, value) {
  if (COMPANY_SCOPED_OPTION_CATEGORIES.includes(key)) {
    const companyId = val('optionCompany');
    if (!companyId) return;
    const backup = [...(state.companySelectOptions[companyId]?.[key] || [])];
    state.companySelectOptions[companyId] = state.companySelectOptions[companyId] || {};
    state.companySelectOptions[companyId][key] = backup.filter((v) => v !== value);
    if (sb && !USE_LOCAL_FALLBACK && hasSupabaseSession()) {
      try {
        await saveCompanyOptionsToSupabase(companyId, key);
      } catch (e) {
        state.companySelectOptions[companyId][key] = backup;
        renderAll();
        return alert(`Não foi possível salvar a alteração. Tente novamente.\n(${e.message})`);
      }
    } else if (!DEV_LOCAL_MODE) {
      state.companySelectOptions[companyId][key] = backup;
      return alert('Supabase Auth/Sessão obrigatório em produção para salvar opções.');
    }
    save();
    renderAll();
    return;
  }

  const backup = [...(state.selectOptions[key] || [])];
  state.selectOptions[key] = backup.filter((v) => v !== value);
  if (sb && !USE_LOCAL_FALLBACK && hasSupabaseSession()) {
    try {
      await saveSelectOptionsToSupabase();
    } catch (e) {
      /* Reverte a remoção em memória para não mentir ao usuário */
      state.selectOptions[key] = backup;
      renderAll();
      return alert(`Não foi possível salvar a alteração. Tente novamente.\n(${e.message})`);
    }
  } else if (!DEV_LOCAL_MODE) {
    state.selectOptions[key] = backup;
    return alert('Supabase Auth/Sessão obrigatório em produção para salvar opções.');
  }
  save();
  renderAll();
}

/* --- Fornecedores e Categorias por empresa (aba dedicada em Sistema → Configurações) --- */
async function addCompanyOption(category, companyId, value) {
  value = (value || '').trim();
  if (!companyId) return alert('Selecione a empresa.');
  if (!value) return alert('Informe um valor.');
  state.companySelectOptions[companyId] = state.companySelectOptions[companyId] || {};
  state.companySelectOptions[companyId][category] = state.companySelectOptions[companyId][category] || [];
  if (state.companySelectOptions[companyId][category].includes(value)) return alert('Este item já está cadastrado para esta empresa.');
  state.companySelectOptions[companyId][category].push(value);
  if (sb && !USE_LOCAL_FALLBACK && hasSupabaseSession()) {
    try {
      await saveCompanyOptionsToSupabase(companyId, category);
    } catch (e) {
      state.companySelectOptions[companyId][category] = state.companySelectOptions[companyId][category].filter((v) => v !== value);
      renderAll();
      return alert(`Não foi possível salvar a alteração. Tente novamente.\n(${e.message})`);
    }
  } else if (!DEV_LOCAL_MODE) {
    state.companySelectOptions[companyId][category] = state.companySelectOptions[companyId][category].filter((v) => v !== value);
    return alert('Supabase Auth/Sessão obrigatório em produção para salvar opções.');
  }
  save();
  renderAll();
}

async function addFornecedor() {
  const companyId = val('fcCompanyFilter');
  const value = val('fcNewFornecedor').trim();
  if (!companyId) return alert('Selecione a empresa.');
  if (!value) return alert('Informe o nome do fornecedor.');
  const before = (state.companySelectOptions?.[companyId]?.fornecedores || []).length;
  await addCompanyOption('fornecedores', companyId, value);
  if ((state.companySelectOptions?.[companyId]?.fornecedores || []).length > before) clear('fcNewFornecedor');
}

async function addCategoria() {
  const companyId = val('fcCompanyFilter');
  const value = val('fcNewCategoria').trim();
  if (!companyId) return alert('Selecione a empresa.');
  if (!value) return alert('Informe o nome da categoria.');
  const before = (state.companySelectOptions?.[companyId]?.expenseCategories || []).length;
  await addCompanyOption('expenseCategories', companyId, value);
  if ((state.companySelectOptions?.[companyId]?.expenseCategories || []).length > before) clear('fcNewCategoria');
}

async function addCliente() {
  const companyId = val('fcCompanyFilter');
  const value = val('fcNewCliente').trim();
  if (!companyId) return alert('Selecione a empresa.');
  if (!value) return alert('Informe o nome do cliente.');
  const before = (state.companySelectOptions?.[companyId]?.clientes || []).length;
  await addCompanyOption('clientes', companyId, value);
  if ((state.companySelectOptions?.[companyId]?.clientes || []).length > before) clear('fcNewCliente');
}

async function addCategoriaEntrada() {
  const companyId = val('fcCompanyFilter');
  const value = val('fcNewCategoriaEntrada').trim();
  if (!companyId) return alert('Selecione a empresa.');
  if (!value) return alert('Informe o nome da categoria.');
  const before = (state.companySelectOptions?.[companyId]?.entryCategories || []).length;
  await addCompanyOption('entryCategories', companyId, value);
  if ((state.companySelectOptions?.[companyId]?.entryCategories || []).length > before) clear('fcNewCategoriaEntrada');
}

async function removeCompanyOption(category, companyId, value) {
  const backup = [...(state.companySelectOptions[companyId]?.[category] || [])];
  state.companySelectOptions[companyId] = state.companySelectOptions[companyId] || {};
  state.companySelectOptions[companyId][category] = backup.filter((v) => v !== value);
  if (sb && !USE_LOCAL_FALLBACK && hasSupabaseSession()) {
    try {
      await saveCompanyOptionsToSupabase(companyId, category);
    } catch (e) {
      state.companySelectOptions[companyId][category] = backup;
      renderAll();
      return alert(`Não foi possível salvar a alteração. Tente novamente.\n(${e.message})`);
    }
  } else if (!DEV_LOCAL_MODE) {
    state.companySelectOptions[companyId][category] = backup;
    return alert('Supabase Auth/Sessão obrigatório em produção para salvar opções.');
  }
  save();
  renderAll();
}

async function renameCompanyOption(category, companyId, oldValue, newValue) {
  newValue = (newValue || '').trim();
  if (!newValue || newValue === oldValue) return;
  const list = state.companySelectOptions?.[companyId]?.[category] || [];
  const idx = list.indexOf(oldValue);
  if (idx === -1) return;
  if (list.includes(newValue)) return alert('Já existe um item com esse nome para esta empresa.');
  const backup = [...list];
  const updated = [...list];
  updated[idx] = newValue;
  state.companySelectOptions[companyId][category] = updated;
  if (sb && !USE_LOCAL_FALLBACK && hasSupabaseSession()) {
    try {
      await saveCompanyOptionsToSupabase(companyId, category);
    } catch (e) {
      state.companySelectOptions[companyId][category] = backup;
      renderAll();
      return alert(`Não foi possível salvar a alteração. Tente novamente.\n(${e.message})`);
    }
  } else if (!DEV_LOCAL_MODE) {
    state.companySelectOptions[companyId][category] = backup;
    return alert('Supabase Auth/Sessão obrigatório em produção para salvar opções.');
  }
  save();
  renderAll();
}

function promptRenameCompanyOption(category, companyId, oldValue) {
  const label = category === 'fornecedores' ? 'fornecedor' : category === 'clientes' ? 'cliente' : 'categoria';
  const newValue = prompt(`Novo nome para o ${label} "${oldValue}":`, oldValue);
  if (newValue === null) return;
  renameCompanyOption(category, companyId, oldValue, newValue);
}

async function resetSelectOptions() {
  if (!confirm('Restaurar opções padrão?')) return;
  state.selectOptions = defaultSelectOptions();
  if (sb && !USE_LOCAL_FALLBACK && hasSupabaseSession()) {
    try {
      await saveSelectOptionsToSupabase();
    } catch (e) {
      return alert(`Erro ao salvar opções no Supabase: ${e.message}`);
    }
  } else if (!DEV_LOCAL_MODE) {
    return alert('Supabase Auth/Sessão obrigatório em produção para salvar opções.');
  }
  save();
  renderAll();
}

/* --- Limpar dados operacionais por empresa --- */
function openLimparDadosModal() {
  const sel = $('limparEmpresa');
  if (sel) {
    sel.innerHTML = '<option value="">Selecione a empresa</option>' +
      state.companies.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  }
  setVal('limparDataDe', '');
  setVal('limparDataAte', '');
  setVal('limparConfirmacao', '');
  const hint = $('limparConfirmacaoHint');
  if (hint) hint.style.display = 'none';
  if ($('limparFechamentos'))  $('limparFechamentos').checked  = true;
  if ($('limparAjustes'))      $('limparAjustes').checked      = true;
  if ($('limparDivergencias')) $('limparDivergencias').checked = true;
  if ($('limparRepasses'))     $('limparRepasses').checked     = false;
  if ($('limparAudit'))        $('limparAudit').checked        = false;
  const modal = $('limparDadosModal');
  if (modal) modal.style.display = 'flex';
}

function closeLimparDadosModal() {
  const modal = $('limparDadosModal');
  if (modal) modal.style.display = 'none';
}

async function clearCompanyData() {
  const companyId = val('limparEmpresa');
  const company = state.companies.find((c) => c.id === companyId);
  if (!companyId || !company) return alert('Selecione uma empresa.');

  const typed = val('limparConfirmacao').trim();
  const hint = $('limparConfirmacaoHint');
  if (typed.toLowerCase() !== company.name.toLowerCase()) {
    if (hint) hint.style.display = '';
    return;
  }
  if (hint) hint.style.display = 'none';

  const delClose = !!$('limparFechamentos')?.checked;
  const delAdj   = !!$('limparAjustes')?.checked;
  const delDiv   = !!$('limparDivergencias')?.checked;
  const delRep   = !!$('limparRepasses')?.checked;
  const delAudit = !!$('limparAudit')?.checked;

  if (!delClose && !delAdj && !delDiv && !delRep && !delAudit) {
    return alert('Selecione ao menos um tipo de dado para limpar.');
  }

  const dataDe  = val('limparDataDe')  || null; // ISO YYYY-MM-DD
  const dataAte = val('limparDataAte') || null; // ISO YYYY-MM-DD

  const itens = [];
  if (delClose) itens.push('fechamentos (+ entradas, saídas, anexos)');
  if (delAdj)   itens.push('ajustes de saldo inicial');
  if (delDiv)   itens.push('revisões de divergência');
  if (delRep)   itens.push('repasses recebidos');
  if (delAudit) itens.push('logs de auditoria');

  const periodoTxt = (dataDe || dataAte)
    ? ` | Período: ${dataDe || 'início'} a ${dataAte || 'hoje'}`
    : ' | Todos os registros';

  if (!confirm(`Remover permanentemente:\n• ${itens.join('\n• ')}\n\nEmpresa: ${company.name}${periodoTxt}\n\nEsta ação NÃO pode ser desfeita!`)) return;

  try {
    if (sb && !USE_LOCAL_FALLBACK && hasSupabaseSession()) {
      if (delClose) {
        let q = sb.from('closings').delete().eq('company_id', companyId);
        if (dataDe)  q = q.gte('closing_date', dataDe);
        if (dataAte) q = q.lte('closing_date', dataAte);
        const { error } = await q;
        if (error) throw error;
      }
      if (delAdj) {
        let q = sb.from('cash_opening_adjustments').delete().eq('company_id', companyId);
        if (dataDe)  q = q.gte('start_date', dataDe);
        if (dataAte) q = q.lte('start_date', dataAte);
        const { error } = await q;
        if (error) throw error;
      }
      if (delDiv) {
        const { error } = await sb.from('divergence_reviews').delete().eq('company_id', companyId);
        if (error) throw error;
      }
      if (delRep) {
        const { error } = await sb.from('transfer_receipts').delete().eq('company_id', companyId);
        if (error) throw error;
      }
      if (delAudit) {
        const { error } = await sb.from('audit_logs').delete().eq('company_id', companyId);
        if (error) throw error;
      }
    } else if (!DEV_LOCAL_MODE) {
      return alert('Supabase Auth/Sessão obrigatório em produção para limpar dados.');
    }

    /* Filtra estado local */
    const inPeriod = (isoDate) => {
      if (!dataDe && !dataAte) return true;
      if (dataDe  && isoDate < dataDe)  return false;
      if (dataAte && isoDate > dataAte) return false;
      return true;
    };

    let removedIds = new Set();
    if (delClose) {
      removedIds = new Set(
        state.closings
          .filter((c) => c.companyId === companyId && inPeriod(parseBR(c.date)))
          .map((c) => c.id)
      );
      state.closings = state.closings.filter((c) => !removedIds.has(c.id));
    }
    if (delAdj) {
      state.cashOpeningAdjustments = state.cashOpeningAdjustments.filter((a) => {
        if (a.companyId !== companyId) return true;
        return !inPeriod(a.startDate || '');
      });
    }
    if (delDiv) {
      state.divergenceReviews = state.divergenceReviews.filter((r) => r.companyId !== companyId);
    } else if (removedIds.size) {
      state.divergenceReviews = state.divergenceReviews.filter((r) => !removedIds.has(r.closingId));
    }
    if (delRep) {
      state.transferReceipts = (state.transferReceipts || []).filter((r) => r.companyId !== companyId);
    }
    if (delAudit) {
      state.audit = state.audit.filter((a) => a.companyId !== companyId);
    }

    addAudit('Limpeza de dados operacionais', `${company.name} — ${itens.join(', ')}`);
    lastOwnSave = Date.now();
    save();
    renderAll();
    closeLimparDadosModal();
    toast(`Dados de "${company.name}" removidos com sucesso.`);
  } catch (e) {
    alert(`Erro ao limpar dados: ${e.message}`);
  }
}

/* --- Backup --- */
function exportBackup() {
  downloadFile(`backup_caixa5x_${todayISO()}.json`, JSON.stringify(state, null, 2), 'application/json;charset=utf-8');
}

function importBackup() {
  const f = $('backupFile')?.files?.[0];
  if (!f) return alert('Selecione um arquivo JSON.');
  const reader = new FileReader();
  reader.onload = () => {
    try {
      state = JSON.parse(reader.result);
      normalizeState();
      save();
      renderAll();
      toast('Backup restaurado com sucesso.');
    } catch { alert('Arquivo inválido. Verifique o formato JSON.'); }
  };
  reader.readAsText(f);
}

function resetSystem() {
  if (!confirm('ATENÇÃO: Isto apagará todos os dados. Confirmar?')) return;
  state = defaultState();
  save();
  renderAll();
}

/* --- Selects (fill) --- */
function storeOptionsForCompany(companyId) {
  return state.stores
    .filter((s) => !companyId || s.companyId === companyId)
    .map((s) => [s.id, s.name]);
}

function operatorOptionsForCompany(companyId) {
  return (state.users || [])
    .filter((u) => u.role === 'operator' && u.companyId === companyId && u.status !== 'Inativo')
    .map((u) => [u.authId || u.id, u.name]);
}

function setOptions(id, rows, placeholder = 'Selecione') {
  const el = $(id); if (!el) return;
  const current = el.value;
  el.innerHTML = `<option value="">${placeholder}</option>` +
    rows.map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join('');
  if ([...el.options].some((o) => o.value === current)) el.value = current;
}

function fillSelects() {
  if (!state) return;
  const companies = visibleCompanies().map((c) => [c.id, c.name]);
  [
    'storeCompany','opCompany','ruleCompany','implantCompanyFilter','operationCompany',
    'ruleFilterCompany','moduleCompany','reportCompany','masterExtractCompany',
    'masterMovementCompanyFilter','masterDivergenceCompanyFilter','masterResumoCompany','masterRepasseCompany',
    'userManageCompany','usersCompanyFilter',
  ].forEach((id) => setOptions(id, companies));

  fillStoreSelect();
  fillClosingStoreSelect();
  fillReportStore();
  fillReportOperator();
  fillMasterExtractStore();
  fillMasterMovementStore();
  fillMasterDivergenceStore();
  fillMasterResumoStore();
  fillMasterRepasseStore();
  fillUserManageSelect();
  fillClientReportStore();
  fillClientReportOperator();
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
  if (role === 'operator') {
    el.style.cssText += ';pointer-events:none;appearance:none;-webkit-appearance:none;font-weight:600;background:transparent;border:none;box-shadow:none;padding-left:0';
  }
  fillClosingResponsible5X();
}
function fillClosingResponsible5X() {
  const storeId = val('closingStore');
  const store = state.stores.find((s) => s.id === storeId);
  const users = state.users.filter((u) =>
    u.companyId === store?.companyId &&
    (!u.storeId || u.storeId === storeId) &&
    u.status !== 'Inativo'
  );
  const el = $('closingResponsible'); if (!el) return;
  const cur = el.value;
  el.innerHTML = '<option value="">Selecione o responsável</option>' +
    users.map((u) => `<option>${esc(u.name)}</option>`).join('');
  if (role === 'operator') {
    if (currentUser?.name) el.value = currentUser.name;
    el.style.cssText += ';pointer-events:none;appearance:none;-webkit-appearance:none;font-weight:600;background:transparent;border:none;box-shadow:none;padding-left:0';
  } else if (cur && [...el.options].some((o) => o.value === cur)) {
    el.value = cur;
  }
}
function fillReportStore() { setOptions('reportStore', storeOptionsForCompany(val('reportCompany')), 'Todas'); }
function fillReportOperator() { setOptions('reportOperator', operatorOptionsForCompany(val('reportCompany')), 'Todos'); }
function fillClientReportStore() { setOptions('clientReportStore', storeOptionsForCompany(currentUser?.companyId), 'Todas'); }
function fillClientReportOperator() { setOptions('clientReportOperator', operatorOptionsForCompany(currentUser?.companyId), 'Todos'); }
function fillMasterExtractStore() { setOptions('masterExtractStore', storeOptionsForCompany(val('masterExtractCompany')), 'Todas'); }
function fillMasterMovementStore() { setOptions('masterMovementStoreFilter', storeOptionsForCompany(val('masterMovementCompanyFilter')), 'Todas'); }
function fillMasterDivergenceStore() { setOptions('masterDivergenceStoreFilter', storeOptionsForCompany(val('masterDivergenceCompanyFilter')), 'Todas'); }
function fillMasterResumoStore()  { setOptions('masterResumoStore',  storeOptionsForCompany(val('masterResumoCompany')),  'Todas'); }
function fillMasterRepasseStore() { setOptions('masterRepasseStore', storeOptionsForCompany(val('masterRepasseCompany')), 'Todas'); }
function fillUserManageSelect() {
  const cid = val('userManageCompany');
  setOptions('userManageSelect', state.users.filter((u) => !cid || u.companyId === cid).map((u) => [u.id, `${u.name} — ${u.login}`]));
}
/* ================================================================
   PASTA DE DOCUMENTOS — store_documents
   Arquivos independentes enviados por operadores (não vinculados a fechamentos).
================================================================ */
function mapStoreDocument(row) {
  return {
    id:          row.id,
    companyId:   row.company_id,
    storeId:     row.store_id,
    name:        row.file_name,
    path:        row.file_path  || '',
    url:         row.file_url   || '',
    type:        row.file_type  || '',
    size:        Number(row.file_size || 0),
    description: row.description || '',
    uploadedBy:  row.uploaded_by,
    createdAt:   row.created_at,
  };
}

async function uploadStoreDocument({ storeId, file, description }) {
  const store = state.stores.find((s) => s.id === storeId);
  if (!store) throw new Error('Loja não encontrada.');
  const safeName = String(file.name).replace(/[^\w.\-]+/g, '_');
  const filePath = `${store.companyId}/${storeId}/${Date.now()}_${safeName}`;
  if (sb && !USE_LOCAL_FALLBACK && hasSupabaseSession()) {
    const { error: uploadError } = await sb.storage
      .from('store-documents')
      .upload(filePath, file, { upsert: false, contentType: file.type || 'application/octet-stream' });
    if (uploadError) throw uploadError;
    const row = await supabaseWrite('store_documents', 'insert', cleanPayload({
      company_id:  store.companyId,
      store_id:    storeId,
      file_name:   file.name,
      file_path:   filePath,
      file_url:    filePath,
      file_type:   file.type || '',
      file_size:   file.size || 0,
      description: description || null,
      uploaded_by: currentUser?.authId || undefined,
    }));
    return row ? mapStoreDocument(row) : null;
  } else if (!DEV_LOCAL_MODE) {
    throw new Error('Supabase obrigatório em produção para enviar documentos.');
  }
  return {
    id: uid('doc'), companyId: store.companyId, storeId,
    name: file.name, path: filePath, url: '', type: file.type || '',
    size: file.size || 0, description: description || '',
    uploadedBy: currentUser?.authId || null, createdAt: new Date().toISOString(),
  };
}

async function deleteStoreDocument(docId, filePath) {
  if (sb && !USE_LOCAL_FALLBACK && hasSupabaseSession()) {
    if (filePath) {
      const { error: storageError } = await sb.storage.from('store-documents').remove([filePath]);
      if (storageError) console.warn('[deleteStoreDocument] Storage (não-fatal):', storageError.message);
    }
    await supabaseWrite('store_documents', 'delete', {}, { id: docId });
  } else if (!DEV_LOCAL_MODE) {
    throw new Error('Supabase obrigatório em produção para excluir documentos.');
  }
}

async function clearStoreDocumentsByStore(storeId) {
  if (sb && !USE_LOCAL_FALLBACK && hasSupabaseSession()) {
    const { data: docs } = await sb.from('store_documents').select('file_path').eq('store_id', storeId);
    const paths = (docs || []).map((d) => d.file_path).filter(Boolean);
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await sb.storage.from('store-documents').remove(paths.slice(i, i + 100));
      if (error) console.warn('[clearStoreDocuments] Storage batch (não-fatal):', error.message);
    }
    const { error } = await sb.from('store_documents').delete().eq('store_id', storeId);
    if (error) throw error;
  } else if (!DEV_LOCAL_MODE) {
    throw new Error('Supabase obrigatório em produção para limpar documentos.');
  }
}

/* --- Handlers de UI --- */
const ALLOWED_DOC_MIME = ['image/jpeg', 'image/png', 'application/pdf'];
const ALLOWED_DOC_EXT  = /\.(jpe?g|png|pdf)$/i;
const MAX_DOC_BYTES    = 10 * 1024 * 1024;

function previewDocUpload(input) {
  const file = input?.files?.[0];
  const nameEl = $('docUploadFileName');
  if (nameEl) nameEl.textContent = file ? file.name : 'Clique para selecionar ou arraste um arquivo';
}

async function handleDocUpload() {
  const input = $('docUploadFile');
  const file = input?.files?.[0];
  if (!file) return alert('Selecione um arquivo para enviar.');
  if (!ALLOWED_DOC_MIME.includes(file.type) && !ALLOWED_DOC_EXT.test(file.name))
    return alert('Tipo não permitido. Use JPG, PNG ou PDF.');
  if (file.size > MAX_DOC_BYTES) return alert('Arquivo muito grande. Máximo: 10 MB.');
  const storeId = currentUser?.storeId;
  if (!storeId) return alert('Operador sem loja vinculada. Contate o administrador.');
  const description = val('docUploadDescription') || '';
  const btn = $('docUploadBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
  try {
    const doc = await uploadStoreDocument({ storeId, file, description });
    if (doc) {
      state.storeDocuments = state.storeDocuments || [];
      state.storeDocuments.unshift(doc);
    }
    if (input) input.value = '';
    const nameEl = $('docUploadFileName');
    if (nameEl) nameEl.textContent = 'Clique para selecionar ou arraste um arquivo';
    setVal('docUploadDescription', '');
    addAudit('Documento enviado', `${storeName(storeId)} — ${file.name}`);
    save();
    renderAll();
    toast('Documento enviado com sucesso!');
  } catch (e) {
    alert('Erro ao enviar documento: ' + (e.message || 'tente novamente.'));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Enviar documento'; }
  }
}

async function handleDeleteDoc(docId, filePath) {
  const doc = (state.storeDocuments || []).find((d) => d.id === docId);
  if (!doc) return;
  if (!confirm(`Remover "${doc.name}"?`)) return;
  try {
    await deleteStoreDocument(docId, filePath || doc.path);
    state.storeDocuments = (state.storeDocuments || []).filter((d) => d.id !== docId);
    addAudit('Documento removido', `${storeName(doc.storeId)} — ${doc.name}`);
    save();
    renderAll();
    toast('Documento removido.');
  } catch (e) {
    alert('Erro ao remover documento: ' + (e.message || 'tente novamente.'));
  }
}

async function handleClearStoreDocuments(storeId, storeNameParam) {
  const count = (state.storeDocuments || []).filter((d) => d.storeId === storeId).length;
  if (!count) return toast('A pasta já está vazia.');
  if (!confirm(`Limpar todos os ${count} arquivo(s) da pasta "${storeNameParam}"?\nEsta ação não pode ser desfeita.`)) return;
  try {
    await clearStoreDocumentsByStore(storeId);
    state.storeDocuments = (state.storeDocuments || []).filter((d) => d.storeId !== storeId);
    addAudit('Pasta de documentos limpa', `${storeNameParam} — ${count} arquivo(s) removido(s)`);
    save();
    renderAll();
    toast(`Pasta de "${storeNameParam}" limpa com sucesso.`);
  } catch (e) {
    alert('Erro ao limpar pasta: ' + (e.message || 'tente novamente.'));
  }
}

async function reloadStoreDocuments() {
  if (!sb || USE_LOCAL_FALLBACK || !hasSupabaseSession()) return toast('Offline — recarregue a página.', 'error');
  const btn = $('reloadDocumentsBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Recarregando...'; }
  try {
    const rows = await selectTable('store_documents').catch(() => []);
    state.storeDocuments = rows.map(mapStoreDocument);
    renderAll();
    toast('Documentos atualizados.');
  } catch (e) {
    alert('Erro ao recarregar documentos: ' + (e.message || 'tente novamente.'));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Recarregar'; }
  }
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

Object.assign(window, {
  state: null, isBooting: true,
  DEV_LOCAL_MODE, USE_LOCAL_FALLBACK, NORMALIZED_TABLES, IMPLANT_STEP_LIST,
  defaultSelectOptions, defaultState, normalizeState, load, save, autosave, addAudit,
  setupRealtimeSync, stopRealtimeSync, manualRefresh,
  getCompanies, createCompany, updateCompany, inactivateCompany, deleteCompanyRecord,
  getStores, createStoreRecord, updateStore, deleteStoreRecord,
  getProfiles, getCurrentProfile, updateProfile, createUserViaEdgeFunction, deleteUserViaEdgeFunction,
  getModulePermissions, saveModulePermissions,
  getOperationRules, createOperationRule, updateOperationRule, deleteOperationRule,
  getOperationConfig, saveOperationConfigToSupabase, saveSelectOptionsToSupabase,
  getClosingsByScope, createClosing, updateClosing, softDeleteClosing, getPreviousClosing, checkDuplicateClosing,
  createClosingEntries, createClosingExpenses, createClosingAttachments, getClosingEntries, getClosingExpenses,
  createCashOpeningAdjustment, getCashOpeningAdjustment,
  createDivergenceReview, getPendingDivergenceReviews, updateDivergenceReview,
  logAudit,
  companyName, storeName, visibleCompanies, visibleStores, cfg,
  saveClientSetup, clearClientSetup, toggleCompany, deleteCompany,
  createStore, updateStoreFund, deleteStore,
  createUserFromMaster, loadUserToEdit, saveUserEdit,
  resetSelectedUserPassword, resetUserPasswordViaEdgeFunction, removeUserById,
  deleteSelectedUser, deleteUser,
  createRule, deleteRule, saveImplantStep, upsertImplantStep, saveOperationConfig,
  addSelectOption, removeSelectOption, resetSelectOptions, optionsForCompany,
  addCompanyOption, removeCompanyOption, renameCompanyOption, promptRenameCompanyOption,
  addFornecedor, addCategoria, addCliente, addCategoriaEntrada,
  openLimparDadosModal, closeLimparDadosModal, clearCompanyData,
  exportBackup, importBackup, resetSystem,
  storeOptionsForCompany, operatorOptionsForCompany, setOptions, fillSelects,
  fillStoreSelect, fillClosingStoreSelect, fillClosingResponsible5X,
  fillReportStore, fillReportOperator, fillClientReportStore, fillClientReportOperator, fillMasterExtractStore,
  fillMasterMovementStore, fillMasterDivergenceStore, fillMasterResumoStore, fillMasterRepasseStore,
  fillUserManageSelect, fillEditUserStore, toggleUserStore,
  mapStoreDocument, uploadStoreDocument, deleteStoreDocument, clearStoreDocumentsByStore,
  previewDocUpload, handleDocUpload, handleDeleteDoc, handleClearStoreDocuments,
  viewStorageFile, openFileViewer, closeFileViewer, reloadStoreDocuments,
  saveRectificationRequest,
  confirmTransferReceipt, cancelTransferReceipt,
});

Object.defineProperty(window, 'state', {
  get: () => state,
  set: (v) => { state = v; },
  configurable: true,
});
Object.defineProperty(window, 'isBooting', {
  get: () => isBooting,
  set: (v) => { isBooting = v; },
  configurable: true,
});
