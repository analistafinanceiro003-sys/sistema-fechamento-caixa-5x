'use strict';
/* ============================================================
   RELATÓRIOS E FILTROS — Caixa 5X
   Função única getScopedClosings() alimenta todos os relatórios.
   Exportador CSV genérico exportGenericCSV() unifica todas as exportações.
============================================================ */

/* --- Filtro unificado --- */
function getScopedClosings({
  companyId = null,
  storeId = null,
  startDate = null,
  endDate = null,
  onlyDivergences = false,
  scope = null,
} = {}) {
  let rows = [...(state?.closings || [])];

  /* Escopo por role */
  const effectiveScope = scope || role;
  if (effectiveScope === 'admin' || role === 'admin') {
    rows = rows.filter((c) => c.companyId === currentUser?.companyId);
  } else if (effectiveScope === 'operator' || role === 'operator') {
    rows = rows.filter((c) =>
      c.storeId === currentUser?.storeId ||
      /* operatorUserId é o UUID do Supabase Auth — confiável após reload */
      (currentUser?.authId && c.operatorUserId === currentUser?.authId) ||
      /* operator é o nome — compatibilidade com dados em localStorage */
      (currentUser?.name && c.operator === currentUser?.name)
    );
  }

  /* Filtros adicionais */
  if (companyId) rows = rows.filter((c) => c.companyId === companyId);
  if (storeId)   rows = rows.filter((c) => c.storeId === storeId);

  if (startDate) {
    const start = parseBR(startDate);
    rows = rows.filter((c) => parseBR(c.date) >= start);
  }
  if (endDate) {
    const end = parseBR(endDate);
    rows = rows.filter((c) => parseBR(c.date) <= end);
  }
  if (onlyDivergences) rows = rows.filter((c) => Math.abs(Number(c.diff || 0)) > 0);

  return rows;
}

/* ============================================================
   FILTROS NOMEADOS — cada seção de relatório tem seus próprios IDs
   Para adicionar datas a uma seção, basta criar inputs com os IDs abaixo.
============================================================ */
function filteredClosings({ scope = 'master' } = {}) { return getScopedClosings({ scope }); }

function masterFilteredClosings() {
  const { startISO, endISO, error } = readDateRange('masterFechStart', 'masterFechEnd');
  if (error) { flash(error); return []; }
  return getScopedClosings({
    companyId: val('masterMovementCompanyFilter'),
    storeId:   val('masterMovementStoreFilter'),
    startDate: startISO,
    endDate:   endISO,
  });
}

function extractFilteredClosings() {
  const { startISO, endISO, error } = readDateRange('masterExtractStart', 'masterExtractEnd');
  if (error) { flash(error); return []; }
  return getScopedClosings({
    companyId: val('masterExtractCompany'),
    storeId:   val('masterExtractStore'),
    startDate: startISO,
    endDate:   endISO,
  });
}

function divergenceFilteredClosings() {
  const { startISO, endISO, error } = readDateRange('masterDivStart', 'masterDivEnd');
  if (error) { flash(error); return []; }
  return getScopedClosings({
    companyId: val('masterDivergenceCompanyFilter'),
    storeId:   val('masterDivergenceStoreFilter'),
    startDate: startISO,
    endDate:   endISO,
    onlyDivergences: true,
  });
}

function adminMovFilteredClosings() {
  const { startISO, endISO, error } = readDateRange('adminMovStart', 'adminMovEnd');
  if (error) { flash(error); return []; }
  return getScopedClosings({
    scope:     'admin',
    storeId:   val('adminMovementStoreFilter'),
    startDate: startISO,
    endDate:   endISO,
  });
}

function operatorHistoryClosings() {
  const { startISO, endISO, error } = readDateRange('opHistStart', 'opHistEnd');
  if (error) { flash(error); return []; }
  return getScopedClosings({
    scope:     'operator',
    startDate: startISO,
    endDate:   endISO,
  });
}

function reportFilteredClosings(admin = false) {
  const { startISO, endISO, error } = admin
    ? readDateRange('clientReportStart', 'clientReportEnd')
    : readDateRange('reportStart', 'reportEnd');
  if (error) { flash(error); return []; }
  return getScopedClosings({
    companyId: admin ? currentUser?.companyId : val('reportCompany'),
    storeId:   admin ? val('clientReportStore') : val('reportStore'),
    startDate: startISO,
    endDate:   endISO,
    scope:     admin ? 'admin' : null,
  });
}

/* Validação antes de exportar */
function validateAndExport(exportFn, startId, endId) {
  const { error } = readDateRange(startId, endId);
  if (error) { alert(error); return; }
  exportFn();
}

/* --- Transformadores --- */
function closingRows(rows) {
  return rows.map((c) => ({
    Empresa: companyName(c.companyId),
    Loja: storeName(c.storeId),
    Data: c.date,
    Turno: c.shift || 'Integral',
    Tipo: c.type || 'Original',
    'Responsável': c.responsible,
    'Saldo Inicial': c.initial,
    'Ultimo Saldo Fechado': c.previousFinalAfterTransfer ?? '',
    'Divergencia Abertura': c.openingDivergence ?? '',
    'Origem Abertura': c.openingReferenceOrigin || '',
    Entradas: c.entries,
    'Saídas': c.expenses,
    'Saldo em Caixa Antes do Repasse': c.expected,
    Repasse: c.transfer,
    'Saldo Final Após Repasse': c.cashBalance ?? c.finalAfterTransfer,
    'Fundo Padrão': c.standardFund,
    Tolerância: c.toleranceSnapshot ?? cfg(c.companyId).tolerance,
    'Divergência Fundo': c.fundDivergence ?? c.diff,
    Status: c.status,
    'Status Revisao': c.reviewStatus,
    'Parecer Admin': (state.divergenceReviews || []).filter((r) => r.closingId === c.id).map((r) => `${r.divergenceType}: ${r.reviewStatus}${r.adminComment ? ' - ' + r.adminComment : ''}`).join(' | '),
    'Observações': c.notes,
    'ID Fechamento': c.id,
  }));
}

function allMovementRows(rows = []) {
  return rows.flatMap((c) => {
    const base = {
      companyId: c.companyId, storeId: c.storeId,
      closingId: c.id,
      Empresa: companyName(c.companyId), Data: c.date,
      Loja: storeName(c.storeId), 'Responsável': c.responsible || c.operator || '',
    };
    const entries = (c.entryItems?.length ? c.entryItems : [{ description: 'Entrada em Dinheiro', value: c.entries }])
      .filter((i) => Number(i.value))
      .map((i) => ({ ...base, Tipo: 'Entrada', 'Descrição': i.description, Categoria: '', Valor: Number(i.value) }));
    const exits = (c.expenseItems || [])
      .filter((i) => Number(i.value))
      .map((i) => ({ ...base, Tipo: 'Saída', 'Descrição': i.description, Categoria: i.category || '', Valor: -Math.abs(Number(i.value)) }));
    const transfer = Number(c.transfer)
      ? [{ ...base, Tipo: 'Repasse / Transferência', 'Descrição': 'Repasse ao caixa central', Categoria: '', Destino: 'Caixa Central', Valor: -Math.abs(Number(c.transfer)) }]
      : [];
    return [...entries, ...exits, ...transfer].map((row) => ({
      ...row,
      Destino: row.Destino || '',
      'ID Fechamento': row.closingId,
    }));
  });
}

function diffRead(c) {
  const d = Number(c.diff || 0);
  if (d > 0) return 'Saldo final acima do fundo padrão.';
  if (d < 0) return 'Saldo final abaixo do fundo padrão.';
  return 'Sem divergência.';
}
function diffAction(c) {
  const abs = Math.abs(Number(c.diff || 0));
  const c_ = cfg(c.companyId);
  if (c_.criticalDivergence && abs > Math.abs(Number(c_.criticalDivergence))) {
    return 'Tratar como divergência crítica: revisar saídas, repasse e fundo.';
  }
  if (abs > Math.abs(Number(c_.tolerance || 0))) {
    return 'Registrar como divergência operacional e validar com o responsável.';
  }
  return 'Dentro da tolerância permitida.';
}

/* --- Exportações --- */
const CLOSING_HEADERS = [
  'Empresa','Loja','Data','Turno','Tipo','Responsável','Saldo Inicial','Ultimo Saldo Fechado','Divergencia Abertura','Origem Abertura','Entradas','Saídas',
  'Saldo em Caixa Antes do Repasse','Repasse','Saldo Final Após Repasse','Fundo Padrão','Tolerância',
  'Divergência Fundo','Status','Status Revisao','Parecer Admin','Observações',
  'ID Fechamento',
];
const MOVEMENT_HEADERS = ['Empresa','Data','Loja','Tipo','Descrição','Categoria','Destino','Valor','Responsável','ID Fechamento'];

function exportCSV() {
  exportGenericCSV('fechamentos_5x.csv', CLOSING_HEADERS, closingRows(reportFilteredClosings()));
}
function exportDivergencesCSV() {
  const rows = closingRows(reportFilteredClosings().filter((c) => Math.abs(Number(c.diff || 0)) > 0));
  exportGenericCSV('divergencias_5x.csv', CLOSING_HEADERS, rows);
}
function exportTransfersCSV() {
  const headers = ['Empresa','Loja','Data','Responsável','Repasse','Status'];
  const rows = reportFilteredClosings()
    .filter((c) => Number(c.transfer))
    .map((c) => ({
      Empresa: companyName(c.companyId), Loja: storeName(c.storeId),
      Data: c.date, 'Responsável': c.responsible, Repasse: c.transfer, Status: c.status,
    }));
  exportGenericCSV('repasses_5x.csv', headers, rows);
}
function exportExpensesCSV() {
  const rows = allMovementRows(reportFilteredClosings()).filter((r) => r.Tipo === 'Saída');
  exportGenericCSV('saidas_5x.csv', MOVEMENT_HEADERS, rows);
}
function exportAuditCSV() {
  const headers = ['Data','Usuário','Perfil','Ação','Detalhe'];
  const rows = (state?.audit || []).map((a) => ({
    Data: a.date, 'Usuário': a.user, Perfil: a.role, 'Ação': a.action, Detalhe: a.detail,
  }));
  exportGenericCSV('auditoria_5x.csv', headers, rows);
}
function exportClientMovementsCSV() {
  const rows = allMovementRows(reportFilteredClosings(true));
  exportGenericCSV('movimentacoes_cliente_5x.csv', MOVEMENT_HEADERS, rows);
}
function exportClientDivergencesCSV() {
  const rows = closingRows(reportFilteredClosings(true).filter((c) => Math.abs(Number(c.diff || 0)) > 0));
  exportGenericCSV('divergencias_cliente_5x.csv', CLOSING_HEADERS, rows);
}
function exportContaAzulCSV() {
  const headers = [
    'Data de Competência','Data de Vencimento','Data de Pagamento',
    'Descrição','Categoria','Valor','Cliente/Fornecedor','CNPJ/CPF',
    'Centro de Custo','Observações',
  ];
  const rows = allMovementRows(reportFilteredClosings()).map((r) => ({
    'Data de Competência': r.Data,
    'Data de Vencimento': r.Data,
    'Data de Pagamento': r.Data,
    'Descrição': r['Descrição'],
    Categoria: r.Tipo === 'Entrada' ? 'Receita de Venda - Dinheiro'
      : r.Tipo === 'Saída' ? (r.Categoria || 'Saída de Caixa')
      : 'Transferência entre contas',
    Valor: r.Valor,
    'Cliente/Fornecedor': '',
    'CNPJ/CPF': '',
    'Centro de Custo': r.Loja,
    'Observações': `Importado Central de Caixa 5X - ${r.Empresa} - ${r['ID Fechamento'] || ''}`,
  }));
  exportGenericCSV('modelo_conta_azul_5x.csv', headers, rows);
}

function exportConsolidadoCSV() {
  const companies = visibleCompanies();
  const headers = ['Empresa','Período','Entradas','Saídas','Repasses','Saldo Final','Div. Fundo'];
  const start = val('reportStart') || val('clientReportStart') || '';
  const end   = val('reportEnd')   || val('clientReportEnd')   || '';
  const rows = companies.map((company) => {
    const closings = getScopedClosings({ companyId: company.id, startDate: start, endDate: end });
    return {
      Empresa: company.name,
      'Período': `${start || 'início'} a ${end || 'hoje'}`,
      Entradas: closings.reduce((a, c) => a + Number(c.entries || 0), 0),
      'Saídas': closings.reduce((a, c) => a + Number(c.expenses || 0), 0),
      Repasses: closings.reduce((a, c) => a + Number(c.transfer || 0), 0),
      'Saldo Final': closings.reduce((a, c) => a + Number(c.cashBalance ?? c.finalAfterTransfer ?? 0), 0),
      'Div. Fundo': closings.reduce((a, c) => a + Number(c.fundDivergence ?? c.diff ?? 0), 0),
    };
  });
  exportGenericCSV('consolidado_empresa_5x.csv', headers, rows);
}

Object.assign(window, {
  getScopedClosings, filteredClosings,
  masterFilteredClosings, extractFilteredClosings,
  divergenceFilteredClosings, adminMovFilteredClosings,
  operatorHistoryClosings, reportFilteredClosings, validateAndExport,
  closingRows, allMovementRows, diffRead, diffAction,
  exportCSV, exportDivergencesCSV, exportTransfersCSV, exportExpensesCSV,
  exportAuditCSV, exportClientMovementsCSV, exportClientDivergencesCSV,
  exportContaAzulCSV, exportConsolidadoCSV,
});
