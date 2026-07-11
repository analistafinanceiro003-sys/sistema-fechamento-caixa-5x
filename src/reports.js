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
  operatorId = null,
  startDate = null,
  endDate = null,
  onlyDivergences = false,
  includeDeleted = false,
  scope = null,
} = {}) {
  let rows = [...(state?.closings || [])];
  if (!includeDeleted) rows = rows.filter((c) => c.type !== 'Excluído');

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
  if (operatorId) {
    const op = (state.users || []).find((u) => (u.authId || u.id) === operatorId);
    const opName = op?.name || '';
    rows = rows.filter((c) => c.operatorUserId === operatorId || (opName && (c.responsible === opName || c.operator === opName)));
  }

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
    scope:      'admin',
    storeId:    val('adminMovementStoreFilter'),
    operatorId: val('adminMovementOperatorFilter'),
    startDate:  startISO,
    endDate:    endISO,
  });
}

function fechResumoFilteredClosings() {
  const { startISO, endISO, error } = readDateRange('masterResumoStart', 'masterResumoEnd');
  if (error) { flash(error); return []; }
  return getScopedClosings({
    companyId: val('masterResumoCompany'),
    storeId:   val('masterResumoStore'),
    startDate: startISO,
    endDate:   endISO,
  });
}

function adminResumoFilteredClosings() {
  const { startISO, endISO, error } = readDateRange('adminResumoStart', 'adminResumoEnd');
  if (error) { flash(error); return []; }
  return getScopedClosings({
    scope:      'admin',
    storeId:    val('adminResumoStoreFilter'),
    operatorId: val('adminResumoOperatorFilter'),
    startDate:  startISO,
    endDate:    endISO,
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
    companyId:  admin ? currentUser?.companyId : val('reportCompany'),
    storeId:    admin ? val('clientReportStore') : val('reportStore'),
    operatorId: admin ? val('clientReportOperator') : val('reportOperator'),
    startDate:  startISO,
    endDate:    endISO,
    scope:      admin ? 'admin' : null,
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
      notes: c.notes || '',
      Empresa: companyName(c.companyId), Data: c.date,
      Loja: storeName(c.storeId), 'Responsável': c.responsible || c.operator || '',
    };
    const entries = (c.entryItems?.length ? c.entryItems : [{ description: 'Entrada em Dinheiro', value: c.entries }])
      .filter((i) => Number(i.value))
      .map((i) => ({ ...base, Tipo: 'Entrada', 'Descrição': i.description, Categoria: '', Valor: Number(i.value) }));
    const exits = (c.expenseItems || [])
      .filter((i) => Number(i.value))
      .map((i) => ({ ...base, Tipo: 'Saída', 'Descrição': i.description, Categoria: i.category || '', Fornecedor: i.supplier || '', Valor: -Math.abs(Number(i.value)) }));
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

/* Ordem/nomes de colunas conforme o modelo padrão do Conta Azul (aba "Dados") */
const CONTA_AZUL_HEADERS = [
  'Data de Competência','Data de Vencimento','Data de Pagamento',
  'Valor','Categoria','Descrição','Cliente/Fornecedor','CNPJ/CPF Cliente/Fornecedor',
  'Centro de Custo','Observações',
];
function contaAzulRow(r, obsPrefix) {
  return {
    'Data de Competência': r.Data,
    'Data de Vencimento': r.Data,
    'Data de Pagamento': r.Data,
    Valor: r.Valor,
    Categoria: r.Tipo === 'Entrada' ? 'Receita de Venda - Dinheiro'
      : r.Tipo === 'Saída' ? (r.Categoria || 'Saída de Caixa')
      : 'Transferência entre contas',
    'Descrição': r['Descrição'],
    'Cliente/Fornecedor': r.Fornecedor || '',
    'CNPJ/CPF Cliente/Fornecedor': '',
    'Centro de Custo': r.Loja,
    'Observações': `${obsPrefix} - ${r.Empresa} - ID ${r['ID Fechamento'] || ''}`,
  };
}
function exportCSV() {
  const rows = allMovementRows(reportFilteredClosings()).map((r) => contaAzulRow(r, 'Fechamento de caixa 5X'));
  exportGenericCSV('fechamento_por_loja_conta_azul_5x.csv', CONTA_AZUL_HEADERS, rows);
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
/* Repasses são transferência de custódia, não lançamento contábil —
   por isso ficam de fora do modelo Conta Azul (usar o relatório de Repasses). */
const CONTA_AZUL_ORIENTACOES = [
  'Orientações de preenchimento da planilha:',
  '* A data de pagamento precisa ser igual ou inferior a data de hoje, caso a mesma seja superior ao dia de hoje o lançamento será importado com o status: "Em Aberto".',
  '* Não utilizar caracteres especiais, como por exemplo: \' " ! @ #  %  ¨  &  *  (  )  ª  º  §  + _  - ? ° [ { } ] : ;',
  '* Cole as informações planilha utilizando a função "Colar Especial > Colar Valores" para não perder a formatação padrão das células;',
  '* Verificar se não ficou espaços entre os dados informados, principalmente quando as informações são coladas;',
  '* As células não podem conter fórmulas;',
];
function exportContaAzulXLSX() {
  const rows = allMovementRows(reportFilteredClosings())
    .filter((r) => r.Tipo === 'Entrada' || r.Tipo === 'Saída')
    .map((r) => contaAzulRow(r, 'Importado Central de Caixa 5X'));

  if (typeof XLSX === 'undefined') {
    exportGenericCSV('modelo_conta_azul_5x.csv', CONTA_AZUL_HEADERS, rows);
    if (window.toast) toast('Biblioteca de exportação Excel indisponível — gerado em CSV.', 'warning');
    return;
  }

  const dadosSheet = XLSX.utils.aoa_to_sheet([
    CONTA_AZUL_HEADERS,
    ...rows.map((r) => CONTA_AZUL_HEADERS.map((h) => r[h] ?? '')),
  ]);
  const orientSheet = XLSX.utils.aoa_to_sheet(CONTA_AZUL_ORIENTACOES.map((l) => [l]));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, dadosSheet, 'Dados');
  XLSX.utils.book_append_sheet(wb, orientSheet, 'Orientações');
  XLSX.writeFile(wb, 'modelo_conta_azul_5x.xlsx');
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

/* ============================================================
   EXPORTAÇÃO PDF — jsPDF + autoTable (CDN)
============================================================ */
let _logoB64 = null;

async function _loadLogo() {
  if (_logoB64) return _logoB64;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      _logoB64 = c.toDataURL('image/png');
      resolve(_logoB64);
    };
    img.onerror = () => resolve(null);
    img.src = '/assets/logo-gestao5x-transparente.png';
  });
}

function _fmtM(v) {
  const n = Number(v);
  if (v === '' || v == null || isNaN(n)) return v ?? '';
  const abs = Math.abs(n).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (n < 0 ? '-' : '') + abs + ' R$';
}

function _per(startId, endId) {
  const s = val(startId) || '', e = val(endId) || '';
  return s || e ? 'Período: ' + (s || '—') + ' a ' + (e || '—') : '';
}

async function generatePDF({ title, companyLabel = '', periodLabel = '', headers, rows, filename }) {
  if (!window.jspdf) { alert('Módulo PDF não carregado. Recarregue a página e tente novamente.'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  /* Cabeçalho escuro */
  doc.setFillColor(13, 23, 32);
  doc.rect(0, 0, W, 22, 'F');

  const logo = await _loadLogo();
  if (logo) doc.addImage(logo, 'PNG', 6, 3, 34, 16);

  doc.setFontSize(11); doc.setFont(undefined, 'bold'); doc.setTextColor(255, 255, 255);
  doc.text('GESTÃO 5X', W - 10, 10, { align: 'right' });
  doc.setFontSize(8); doc.setFont(undefined, 'normal'); doc.setTextColor(54, 199, 189);
  doc.text('Central de Caixa 5X', W - 10, 16, { align: 'right' });

  /* Linha teal separadora */
  doc.setDrawColor(54, 199, 189); doc.setLineWidth(0.6);
  doc.line(0, 22, W, 22);

  /* Título */
  doc.setFontSize(12); doc.setFont(undefined, 'bold'); doc.setTextColor(16, 24, 32);
  doc.text(title, 8, 30);

  /* Metadados */
  doc.setFontSize(8); doc.setFont(undefined, 'normal'); doc.setTextColor(100, 100, 100);
  const now = new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  let mY = 37;
  if (companyLabel) { doc.text('Empresa: ' + companyLabel, 8, mY); mY += 5; }
  if (periodLabel)  { doc.text(periodLabel, 8, mY); mY += 5; }
  doc.text('Emitido em: ' + now, 8, mY);

  /* Tabela */
  doc.autoTable({
    head: [headers],
    body: rows.map((r) => headers.map((h) => r[h] ?? '')),
    startY: mY + 6,
    theme: 'striped',
    headStyles: { fillColor: [13, 23, 32], textColor: [255, 255, 255], fontSize: 7.5, fontStyle: 'bold', cellPadding: 2.5 },
    bodyStyles: { fontSize: 7.5, textColor: [30, 40, 50], cellPadding: 2 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 8, right: 8 },
    styles: { overflow: 'linebreak', cellWidth: 'auto' },
    didDrawPage: ({ pageNumber }) => {
      const total = doc.internal.getNumberOfPages();
      doc.setFontSize(7); doc.setTextColor(150);
      doc.text('Página ' + pageNumber + ' de ' + total + '  —  Gestão 5X', W / 2, H - 5, { align: 'center' });
    },
  });

  doc.save(filename);
}

/* --- Funções PDF por relatório --- */

async function exportFechamentoPDF() {
  const cId = val('reportCompany');
  const H = ['Empresa','Loja','Data','Turno','Responsável','Entradas','Saídas','Repasse','Saldo Final Após Repasse','Divergência Fundo','Status'];
  const rows = closingRows(reportFilteredClosings()).map((r) => ({
    ...r,
    Entradas: _fmtM(r.Entradas), 'Saídas': _fmtM(r['Saídas']),
    Repasse: _fmtM(r.Repasse), 'Saldo Final Após Repasse': _fmtM(r['Saldo Final Após Repasse']),
    'Divergência Fundo': _fmtM(r['Divergência Fundo']),
  }));
  await generatePDF({ title: 'Fechamento por Loja', companyLabel: cId ? companyName(cId) : 'Todas as empresas',
    periodLabel: _per('reportStart', 'reportEnd'), headers: H, rows, filename: 'fechamento_por_loja_5x.pdf' });
}

async function exportDivergencesPDF() {
  const cId = val('reportCompany');
  const H = ['Empresa','Loja','Data','Responsável','Divergência Fundo','Status','Observações'];
  const rows = closingRows(reportFilteredClosings().filter((c) => Math.abs(Number(c.diff || 0)) > 0))
    .map((r) => ({ ...r, 'Divergência Fundo': _fmtM(r['Divergência Fundo']) }));
  await generatePDF({ title: 'Divergências do Período', companyLabel: cId ? companyName(cId) : 'Todas as empresas',
    periodLabel: _per('reportStart', 'reportEnd'), headers: H, rows, filename: 'divergencias_5x.pdf' });
}

async function exportTransfersPDF() {
  const cId = val('reportCompany');
  const start = val('reportStart') || val('clientReportStart') || '';
  const end   = val('reportEnd')   || val('clientReportEnd')   || '';
  const rows = reportFilteredClosings()
    .filter((c) => Number(c.transfer))
    .map((c) => ({ Empresa: companyName(c.companyId), Loja: storeName(c.storeId), Data: c.date,
      'Responsável': c.responsible, Repasse: _fmtM(c.transfer), Status: c.status }));
  await generatePDF({ title: 'Repasses ao Caixa Central',
    companyLabel: cId ? companyName(cId) : (role !== 'master' ? companyName(currentUser?.companyId) : 'Todas as empresas'),
    periodLabel: start || end ? 'Período: ' + (start || '—') + ' a ' + (end || '—') : '',
    headers: ['Empresa','Loja','Data','Responsável','Repasse','Status'], rows, filename: 'repasses_5x.pdf' });
}

async function exportExpensesPDF() {
  const cId = val('reportCompany');
  const start = val('reportStart') || val('clientReportStart') || '';
  const end   = val('reportEnd')   || val('clientReportEnd')   || '';
  const rows = allMovementRows(reportFilteredClosings()).filter((r) => r.Tipo === 'Saída')
    .map((r) => ({ ...r, Valor: _fmtM(r.Valor) }));
  await generatePDF({ title: 'Saídas por Descrição',
    companyLabel: cId ? companyName(cId) : (role !== 'master' ? companyName(currentUser?.companyId) : 'Todas as empresas'),
    periodLabel: start || end ? 'Período: ' + (start || '—') + ' a ' + (end || '—') : '',
    headers: ['Empresa','Data','Loja','Descrição','Categoria','Valor','Responsável'], rows, filename: 'saidas_5x.pdf' });
}

async function exportConsolidadoPDF() {
  const companies = visibleCompanies();
  const start = val('reportStart') || val('clientReportStart') || '';
  const end   = val('reportEnd')   || val('clientReportEnd')   || '';
  const rows = companies.map((co) => {
    const cls = getScopedClosings({ companyId: co.id, startDate: start, endDate: end });
    return {
      Empresa: co.name,
      Entradas:     _fmtM(cls.reduce((a, c) => a + Number(c.entries || 0), 0)),
      'Saídas':     _fmtM(cls.reduce((a, c) => a + Number(c.expenses || 0), 0)),
      Repasses:     _fmtM(cls.reduce((a, c) => a + Number(c.transfer || 0), 0)),
      'Saldo Final':_fmtM(cls.reduce((a, c) => a + Number(c.cashBalance ?? c.finalAfterTransfer ?? 0), 0)),
      'Div. Fundo': _fmtM(cls.reduce((a, c) => a + Number(c.fundDivergence ?? c.diff ?? 0), 0)),
    };
  });
  await generatePDF({ title: 'Consolidado por Empresa',
    periodLabel: start || end ? 'Período: ' + (start || '—') + ' a ' + (end || '—') : '',
    headers: ['Empresa','Entradas','Saídas','Repasses','Saldo Final','Div. Fundo'], rows, filename: 'consolidado_empresa_5x.pdf' });
}

async function exportAuditPDF() {
  const rows = (state?.audit || []).map((a) => ({ Data: a.date, 'Usuário': a.user, Perfil: a.role, 'Ação': a.action, Detalhe: a.detail }));
  await generatePDF({ title: 'Auditoria Operacional', headers: ['Data','Usuário','Perfil','Ação','Detalhe'], rows, filename: 'auditoria_5x.pdf' });
}

async function exportClientMovementsPDF() {
  const cId = currentUser?.companyId;
  const H = ['Loja','Data','Turno','Responsável','Entradas','Saídas','Repasse','Saldo Final Após Repasse','Divergência Fundo','Status'];
  const rows = closingRows(reportFilteredClosings(true)).map((r) => ({
    ...r,
    Entradas: _fmtM(r.Entradas), 'Saídas': _fmtM(r['Saídas']),
    Repasse: _fmtM(r.Repasse), 'Saldo Final Após Repasse': _fmtM(r['Saldo Final Após Repasse']),
    'Divergência Fundo': _fmtM(r['Divergência Fundo']),
  }));
  await generatePDF({ title: 'Fechamento por Loja', companyLabel: cId ? companyName(cId) : '',
    periodLabel: _per('clientReportStart', 'clientReportEnd'), headers: H, rows, filename: 'fechamento_cliente_5x.pdf' });
}

async function exportClientDivergencesPDF() {
  const cId = currentUser?.companyId;
  const H = ['Loja','Data','Responsável','Divergência Fundo','Status','Observações'];
  const rows = closingRows(reportFilteredClosings(true).filter((c) => Math.abs(Number(c.diff || 0)) > 0))
    .map((r) => ({ ...r, 'Divergência Fundo': _fmtM(r['Divergência Fundo']) }));
  await generatePDF({ title: 'Divergências por Loja', companyLabel: cId ? companyName(cId) : '',
    periodLabel: _per('clientReportStart', 'clientReportEnd'), headers: H, rows, filename: 'divergencias_cliente_5x.pdf' });
}

/* ============================================================
   MANUAL DE IMPLANTAÇÃO — PDF
============================================================ */
async function exportManualPDF(onlySection = null) {
  if (!window.jspdf) { alert('jsPDF não carregado. Aguarde a página carregar completamente.'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const PW = 210, PH = 297;
  const teal  = [54, 199, 189];
  const dark  = [13, 23, 32];
  const white = [255, 255, 255];
  const light = [236, 251, 250];
  const todayStr = new Date().toLocaleDateString('pt-BR');

  /* Carrega logo e calcula dimensões reais para não esticar */
  const logoB64 = await _loadLogo();
  let logoW = 65, logoH = 32;
  if (logoB64) {
    await new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const aspect = img.naturalWidth / img.naturalHeight;
        const maxW = 78, maxH = 44;
        if (aspect > maxW / maxH) { logoW = maxW; logoH = maxW / aspect; }
        else { logoH = maxH; logoW = maxH * aspect; }
        resolve();
      };
      img.onerror = resolve;
      img.src = logoB64;
    });
  }
  /* Tamanho do logo no cabeçalho de página (cabe em 22×12mm) */
  const hA = logoW / logoH;
  const hLW = hA > 22 / 12 ? 22 : 12 * hA;
  const hLH = hA > 22 / 12 ? 22 / hA : 12;

  const _footer = () => {
    const n = doc.internal.getNumberOfPages();
    doc.setFontSize(8);
    doc.setTextColor(160, 160, 160);
    doc.text(`Página ${n}  ·  Manual de Implantação 5X  ·  Emitido em ${todayStr}`, PW / 2, PH - 7, { align: 'center' });
    doc.setTextColor(0, 0, 0);
  };

  const _pageHeader = (subtitle) => {
    doc.setFillColor(...dark);
    doc.rect(0, 0, PW, 18, 'F');
    if (logoB64) doc.addImage(logoB64, 'PNG', 8, (18 - hLH) / 2, hLW, hLH, '', 'FAST');
    doc.setTextColor(...white);
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.text(subtitle || 'Manual de Implantação — Conferência Caixa em Dinheiro', PW / 2, 11, { align: 'center' });
    doc.setFillColor(...teal);
    doc.rect(0, 18, PW, 1.5, 'F');
    doc.setFont(undefined, 'normal');
    doc.setTextColor(0, 0, 0);
  };

  /* _section NÃO chama addPage() — o chamador gerencia paginação */
  const _section = (title, content) => {
    _pageHeader();

    doc.setFillColor(...teal);
    doc.roundedRect(14, 22, PW - 28, 9, 2, 2, 'F');
    doc.setTextColor(...white);
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text(title, PW / 2, 28.5, { align: 'center' });
    doc.setFont(undefined, 'normal');
    doc.setTextColor(0, 0, 0);

    /* Sanitiza chars Unicode que jsPDF/Helvetica não suporta (fora do Windows-1252) */
    const _safe = (s) => String(s ?? '')
      .replace(/−/g, '-').replace(/→/g, '->').replace(/←/g, '<-')
      .replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/≠/g, '!=')
      .replace(/×/g, 'x').replace(/÷/g, '/');

    let y = 37;

    for (const item of content) {
      if (item.type === 'text') {
        doc.setFontSize(9.5);
        const lines = doc.splitTextToSize(_safe(item.content), PW - 28);
        doc.text(lines, 14, y);
        y += lines.length * 4.8 + 3;

      } else if (item.type === 'label') {
        doc.setFontSize(9);
        doc.setFont(undefined, 'bold');
        doc.text(_safe(item.content), 14, y);
        doc.setFont(undefined, 'normal');
        y += 6;

      } else if (item.type === 'formula') {
        const availW = PW - 28 - 10;
        doc.setFontSize(9);
        const titleLines = doc.splitTextToSize(_safe(item.title), availW);
        /* Pré-calcula todas as linhas de conteúdo já com wrap */
        const contentLines = item.lines.flatMap(l => doc.splitTextToSize(_safe(l), availW));
        const fH = 5 + titleLines.length * 5.5 + contentLines.length * 4.8 + 4;
        doc.setFillColor(...light);
        doc.roundedRect(14, y, PW - 28, fH, 2, 2, 'F');
        doc.setFillColor(...teal);
        doc.roundedRect(14, y, 3, fH, 1, 1, 'F');
        doc.setTextColor(...dark);
        doc.setFont(undefined, 'bold');
        doc.text(titleLines, 20, y + 6);
        doc.setFont(undefined, 'normal');
        doc.setFontSize(8.5);
        let lineY = y + 6 + titleLines.length * 5.5 + 0.5;
        contentLines.forEach(l => { doc.text(l, 20, lineY); lineY += 4.8; });
        doc.setFontSize(9);
        doc.setTextColor(0, 0, 0);
        y += fH + 4;

      } else if (item.type === 'table') {
        doc.autoTable({
          startY: y,
          head: [item.headers],
          body: item.rows,
          theme: 'grid',
          headStyles: { fillColor: dark, textColor: white, fontStyle: 'bold', fontSize: 8.5 },
          bodyStyles: { fontSize: 8.5, cellPadding: 2.2 },
          alternateRowStyles: { fillColor: light },
          columnStyles: item.colStyles || {},
          margin: { left: 14, right: 14 },
          styles: { overflow: 'linebreak' },
          didDrawPage: () => { _pageHeader(); _footer(); },
        });
        y = doc.lastAutoTable.finalY + 6;
      }
    }
    _footer();
  };

  /* ── Definição de todas as seções ── */
  const allSections = [
    {
      key: 'overview',
      title: '1. Visão Geral do Sistema',
      content: [
        { type: 'text', content: 'O Central de Fechamento de Caixa 5X é uma plataforma digital multiempresa de governança financeira diária. Substitui planilhas e anotações em papel, garantindo que cada centavo do caixa seja registrado, conferido e auditado — em tempo real, de qualquer dispositivo com internet.' },
        { type: 'text', content: 'A Gestão 5X acompanha todos os clientes em um único painel: fechamentos, divergências, repasses e relatórios consolidados de todas as empresas implantadas.' },
        { type: 'table',
          headers: ['Módulo', 'O que faz', 'Perfil'],
          rows: [
            ['Fechamento Diário', 'Registro de saldo, entradas, saídas, repasse e cálculo automático', 'Operador / Admin'],
            ['Histórico', 'Consulta de fechamentos anteriores com filtros de data e loja', 'Admin / Operador'],
            ['Movimentações', 'Extrato consolidado com filtros de data e loja', 'Admin / Master'],
            ['Repasses', 'Confirmação dos repasses pelo gestor', 'Admin'],
            ['Divergências', 'Listagem de fechamentos fora da tolerância', 'Admin / Master'],
            ['Relatórios', 'Exportação PDF/CSV por loja, consolidado, repasses, saídas', 'Admin / Master'],
            ['Módulos', 'Controle do que cada perfil pode ver por empresa', 'Master'],
            ['Auditoria', 'Log completo de todas as ações realizadas', 'Master'],
          ],
          colStyles: { 0: { cellWidth: 38 }, 1: { cellWidth: 100 } },
        },
      ],
    },
    {
      key: 'perfis',
      title: '2. Perfis de Acesso',
      content: [
        { type: 'table',
          headers: ['Perfil', 'Quem é', 'Pode fazer', 'Não pode'],
          rows: [
            ['Master\n(Gestão 5X)', 'Equipe interna Gestão 5X', 'Acesso total: todas as empresas, criar usuários, módulos, auditorias, retificações', 'N/A'],
            ['Admin\n(Gestor cliente)', 'Sócio ou gerente do cliente', 'Ver fechamentos da empresa, histórico, movimentações, confirmar repasses, exportar relatórios', 'Não vê outras empresas. Módulos dependem do Master.'],
            ['Operador\n(Caixa)', 'Funcionário que opera o caixa', 'Registrar fechamento diário, consultar próprio histórico, ver regras (se liberado)', 'Não vê outras lojas, não confirma repasses, não altera configurações'],
          ],
          colStyles: { 0: { cellWidth: 28 }, 1: { cellWidth: 30 }, 2: { cellWidth: 68 } },
        },
        { type: 'label', content: 'Como criar usuários:' },
        { type: 'text', content: 'Cadastros → Usuários → selecionar empresa → perfil (Admin ou Operador) → nome, e-mail e senha. Para Operador, vincular à loja correta. Use sempre e-mail real — é o canal de recuperação de senha.' },
      ],
    },
    {
      key: 'fechamento',
      title: '3. Fechamento Diário',
      content: [
        { type: 'formula',
          title: 'Fórmula 5X — cálculo automático',
          lines: [
            'Saldo antes do repasse  =  Saldo inicial  +  Entradas  −  Saídas',
            'Saldo após o repasse    =  Saldo antes do repasse  −  Repasse',
            'Divergência do fundo    =  Saldo após repasse  −  Fundo padrão  (ideal = 0,00 R$)',
          ],
        },
        { type: 'table',
          headers: ['Campo', 'O que é', 'Dica prática'],
          rows: [
            ['Data', 'Data do fechamento', 'Confirme antes de salvar — sem edição após salvar (requer retificação)'],
            ['Turno', 'Manhã / Tarde / Noite / Integral', 'Use "Integral" para operação com turno único'],
            ['Responsável', 'Operador que faz o fechamento', 'Identifica quem é responsável pelo caixa naquele turno'],
            ['Saldo inicial', 'Dinheiro no caixa no início do turno', 'Deve ser igual ao saldo final do turno anterior'],
            ['Entradas', 'Todo dinheiro que entrou no caixa', 'Informe cada tipo separado com descrição clara'],
            ['Saídas', 'Retiradas autorizadas do caixa', 'Informe categoria e descrição. Anexe comprovante'],
            ['Repasse', 'Valor enviado ao caixa central', 'Transferência de custódia — gestor confirma o recebimento'],
            ['Fundo padrão', 'Valor que deve permanecer no caixa', 'Configurado pelo gestor para cada loja'],
            ['Divergência', 'Diferença calculada automaticamente', '0,00 R$ ideal. Fora da tolerância gera alerta'],
            ['Observações', 'Justificativas de ocorrências', 'Obrigatório ao explicar divergências'],
            ['Anexos', 'Comprovantes em arquivo', 'Aceita JPG, PNG e PDF. Máx. 10 MB por arquivo'],
          ],
          colStyles: { 0: { cellWidth: 30 }, 1: { cellWidth: 65 } },
        },
      ],
    },
    {
      key: 'transacoes',
      title: '4. Transações — Entradas, Saídas e Repasse',
      content: [
        { type: 'label', content: 'Tipos de Entrada:' },
        { type: 'table',
          headers: ['Tipo', 'Descrição', 'Exemplo de descrição'],
          rows: [
            ['Vendas em dinheiro', 'Pagamentos de clientes em espécie', '"Vendas dinheiro 08h–14h"'],
            ['Sangria recebida', 'Reforço de outro caixa ou cofre', '"Reforço do cofre"'],
            ['Troco de fornecedor', 'Troco de pagamento que voltou ao caixa', '"Troco NF Distribuidora X"'],
            ['Recebimento avulso', 'Qualquer outro valor recebido em dinheiro', '"Recebimento aluguel de equipamento"'],
          ],
        },
        { type: 'label', content: 'Categorias de Saída:' },
        { type: 'table',
          headers: ['Categoria', 'O que inclui', 'Comprovante'],
          rows: [
            ['Ajuda de custo', 'Vale transporte, refeição ou auxílio pago em dinheiro', 'Recomendado — assinatura do recebedor'],
            ['Taxa de entrega', 'Pagamento a entregadores/motoboys em dinheiro', 'Sim — recibo ou comprovante'],
            ['Compra de mercadoria', 'Compra emergencial de insumos com dinheiro do caixa', 'Obrigatório — nota fiscal'],
            ['Outras saídas', 'Qualquer retirada autorizada não categorizada acima', 'Sempre descrever o motivo detalhadamente'],
          ],
        },
        { type: 'text', content: 'Repasse: valor enviado ao caixa central ao fim do turno. Não é uma saída — é transferência de custódia. O operador informa no fechamento e o gestor confirma em "Repasses".' },
        { type: 'text', content: 'Fundo padrão: valor pré-configurado que deve permanecer no caixa para o próximo turno. Divergência de abertura ocorre quando o saldo inicial informado difere do saldo final do fechamento anterior.' },
      ],
    },
    {
      key: 'implantacao',
      title: '5. Implantação Passo a Passo',
      content: [
        { type: 'table',
          headers: ['Etapa', 'O que fazer', 'Onde', 'Ponto de atenção'],
          rows: [
            ['1. Empresa', 'Cadastrar empresa: nome, CNPJ, segmento, plano. Status: Implantação.', 'Cadastros → Cadastro Guiado', 'Use o Cadastro Guiado para criar empresa + loja em um único formulário'],
            ['2. Lojas', 'Criar cada loja: nome, código, tipo de caixa, fundo padrão. Status: Ativa.', 'Cadastros → Lojas e Caixas', 'Confirme o fundo padrão com o gestor antes de ativar — erro aqui distorce toda a divergência'],
            ['3. Usuários', 'Criar Admin (gestor) e Operador(es) vinculados à empresa e loja correta.', 'Cadastros → Usuários', 'Use e-mail real. Jamais e-mail genérico — dificulta recuperação de senha'],
            ['4. Regras', 'Cadastrar regras: saídas permitidas, limite de repasse, checklist de conferência.', 'Operação → Regras', 'Regras por loja são visíveis apenas ao operador daquela loja'],
            ['5. Config', 'Definir tolerâncias (divergência e repasse), divergência crítica, receptor do repasse.', 'Operação → Configurações', 'Tolerância divergência: 5,00 R$. Tolerância repasse: conforme acordo com gestor'],
            ['6. Módulos', 'Liberar apenas módulos necessários para Admin e Operador. Menos módulos = menos confusão.', 'Operação → Módulos', 'Comece conservador. Libere mais módulos conforme o cliente aprende'],
            ['7. Ativação', 'Fazer fechamento teste com o operador. Verificar cálculos. Alterar status para Ativa.', 'Login operador → Fechamento', 'Acompanhe os primeiros 5 fechamentos reais para ajustar tolerâncias se necessário'],
          ],
          colStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 55 }, 2: { cellWidth: 40 } },
        },
      ],
    },
    {
      key: 'checklist',
      title: '6. Checklist de Ativação',
      content: [
        { type: 'label', content: 'Checklist técnico — responsabilidade da Gestão 5X:' },
        { type: 'table',
          headers: ['✓', 'Item', 'Como verificar'],
          rows: [
            ['☐', 'DEV_LOCAL_MODE = false', 'Confirmar false em src/db.js linha 12'],
            ['☐', 'Supabase URL e chave corretos', 'Variáveis em src/supabaseClient.js apontam para projeto de produção'],
            ['☐', 'CORS das Edge Functions', 'ALLOWED_ORIGINS com domínio de produção real, sem wildcard'],
            ['☐', 'RLS ativo em todas as tabelas', '14 tabelas com Row Level Security habilitado no painel Supabase'],
            ['☐', 'Bucket Storage criado', 'closing-attachments com política de acesso autenticado'],
            ['☐', 'Edge Functions deployadas', 'create-user e delete-user com secrets PROJECT_URL e SERVICE_ROLE_KEY'],
            ['☐', 'Usuário Master criado', 'role = master na tabela profiles, usuário ativo no Supabase Auth'],
            ['☐', 'Empresa demo removida', 'Inativar ou excluir empresa demo antes de apresentar ao cliente'],
            ['☐', 'Fluxo completo testado', 'Login → fechamento → histórico → logout sem erros'],
          ],
          colStyles: { 0: { cellWidth: 10 }, 1: { cellWidth: 65 } },
        },
        { type: 'label', content: 'Checklist operacional — por cliente:' },
        { type: 'table',
          headers: ['✓', 'Item', 'Onde configurar'],
          rows: [
            ['☐', 'Empresa cadastrada corretamente', 'Cadastros → Cadastro Guiado'],
            ['☐', 'Todas as lojas criadas e ativas', 'Cadastros → Lojas e Caixas'],
            ['☐', 'Fundo padrão definido por loja', 'Cadastros → Lojas e Caixas'],
            ['☐', 'Admin criado e testado', 'Cadastros → Usuários'],
            ['☐', 'Operadores criados e vinculados às lojas', 'Cadastros → Usuários'],
            ['☐', 'Tolerância de divergência configurada', 'Operação → Configurações'],
            ['☐', 'Tolerância de repasse configurada (se aplicável)', 'Operação → Configurações'],
            ['☐', 'Receptor do repasse informado', 'Operação → Configurações'],
            ['☐', 'Regras operacionais cadastradas', 'Operação → Regras'],
            ['☐', 'Módulos configurados para Admin e Operador', 'Operação → Módulos'],
            ['☐', 'Fechamento teste realizado com operador', 'Login operador → Fechamento Diário'],
            ['☐', 'Gestor orientado sobre o painel', 'Login admin → demonstrar histórico e confirmação de repasses'],
            ['☐', 'Status da empresa alterado para Ativa', 'Cadastros → Empresas → editar status'],
          ],
          colStyles: { 0: { cellWidth: 10 }, 1: { cellWidth: 80 } },
        },
      ],
    },
    {
      key: 'gestor',
      title: '7. Manual do Gestor (Admin)',
      content: [
        { type: 'text', content: 'Este manual explica como acompanhar os fechamentos dos seus operadores, o que validar todo dia e o que fazer quando aparecer uma divergência.' },
        { type: 'formula',
          title: 'Fórmulas do caixa',
          lines: [
            'Repasse esperado     =  Saldo de caixa  -  Fundo padrão',
            'Saldo Final          =  Saldo de caixa  -  Repasse confirmado  (deve = Fundo padrão)',
            'Divergência de fundo =  Saldo Final  -  Fundo padrão  (ideal = 0,00)',
            'Div. de abertura     =  Saldo inicial informado  -  Saldo final do turno anterior',
          ],
        },
        { type: 'label', content: 'O que conferir todo dia:' },
        { type: 'table',
          headers: ['O que verificar', 'Onde ver', 'O que esperar'],
          rows: [
            ['Fechamentos do dia', 'Movimentações -> Histórico', 'Todas as lojas com fechamento. Status OK na maioria.'],
            ['Saldo Final por loja', 'Resumo por Fechamento', 'Coluna "Saldo Final": deve ser igual ao fundo padrão (verde = OK, vermelho/amarelo = divergência).'],
            ['Status dos fechamentos', 'Resumo por Fechamento', '"Repasse Confirmado": valor informado pelo operador. "Recebimento": confirmado ou pendente. Clique nos cabeçalhos para ordenar.'],
            ['Repasses recebidos', 'Repasses', 'Confirmar o valor físico recebido. Registra quem confirmou e quando.'],
            ['Divergências pendentes', 'Divergências', 'Toda divergência acima da tolerância aparece aqui. Revisar e comentar.'],
          ],
          colStyles: { 0: { cellWidth: 38 }, 1: { cellWidth: 40 } },
        },
        { type: 'label', content: 'Badges de Recebimento — o que significa cada um:' },
        { type: 'table',
          headers: ['Badge', 'Significado', 'Ação'],
          rows: [
            ['Confirmado', 'Repasse recebido e confirmado por você.', 'Nenhuma — situação ideal.'],
            ['Pendente confirmação', 'Operador informou repasse, você ainda não confirmou.', 'Acesse Repasses e clique em confirmar.'],
            ['Não repassado', 'Caixa superou o fundo mas operador não informou repasse.', 'Verificar com o operador o destino do dinheiro.'],
            ['Dentro da tolerância', 'Valor a repassar é pequeno (abaixo da tolerância configurada).', 'Nenhuma — configuração automática.'],
            ['Sem repasse — fundo OK', 'Caixa ficou exatamente com o fundo padrão.', 'Nenhuma.'],
          ],
          colStyles: { 0: { cellWidth: 42 }, 1: { cellWidth: 80 } },
        },
        { type: 'formula',
          title: 'Divergência de Fundo padrão — o que fazer',
          lines: [
            'Positiva (+): sobrou mais que o fundo — operador não repassou o suficiente.',
            'Negativa (−): faltou dinheiro — erro na contagem ou saída não registrada.',
            'Ação: solicitar justificativa no campo Observações. Erro de lançamento → pedir retificação.',
          ],
        },
        { type: 'formula',
          title: 'Divergência de Abertura — o que fazer',
          lines: [
            'Positiva (+): caixa aberto com mais dinheiro — alguém colocou dinheiro entre turnos.',
            'Negativa (−): caixa aberto com menos — retirada entre turnos ou erro de contagem.',
            'Ação: verificar troca de fundo entre turnos. Recorrente = falha no processo.',
          ],
        },
        { type: 'label', content: 'Rotina recomendada:' },
        { type: 'table',
          headers: ['Frequência', 'Ação'],
          rows: [
            ['Diariamente', 'Acessar o Histórico, confirmar repasses pendentes e verificar divergências novas.'],
            ['2× por semana', 'Revisar a aba Divergências e comentar todas as pendentes.'],
            ['Semanalmente', 'Verificar o Resumo por Fechamento — identificar padrões de divergência recorrente.'],
            ['Mensalmente', 'Exportar relatório consolidado (PDF ou CSV) para conferência com o financeiro.'],
          ],
          colStyles: { 0: { cellWidth: 38 } },
        },
      ],
    },
    {
      key: 'operador',
      title: '8. Manual do Operador de Caixa',
      content: [
        { type: 'text', content: 'Este manual explica como fazer o fechamento de caixa corretamente. Leia com atenção antes do primeiro fechamento e consulte sempre que tiver dúvida.' },
        { type: 'label', content: 'Como fazer o fechamento — passo a passo:' },
        { type: 'table',
          headers: ['Passo', 'O que fazer', 'Ponto de atenção'],
          rows: [
            ['1. Contar o caixa', 'Antes de abrir o sistema, conte fisicamente todo o dinheiro. Separe por denominação, conte duas vezes. Esse é o Saldo Inicial.', 'Deve ser igual ao saldo que ficou do fechamento anterior. Se diferente, registre o real e explique nas Observações.'],
            ['2. Informar entradas', 'Registre todo dinheiro que entrou durante o turno. Clique em "Adicionar entrada", informe descrição e valor.', 'Exemplos: "Vendas em dinheiro", "Troco do fornecedor", "Complemento de fundo".'],
            ['3. Informar saídas', 'Registre todo dinheiro retirado de forma autorizada. Informe a categoria e a descrição.', 'Toda saída precisa de descrição real. "Saída diversa" não é aceito. Consulte as Regras Operacionais.'],
            ['4. Calcular repasse', 'O sistema sugere o repasse automaticamente. Verifique o campo "Repasse sugerido" e informe o valor entregue.', 'Repasse não é saída — é transferência de custódia. O valor que fica é o fundo padrão.'],
            ['5. Verificar e salvar', 'Confira o Saldo de Caixa e a Divergência antes de salvar. O ideal é divergência = 0,00.', 'Se aparecer divergência, confira seus lançamentos. Se persistir, salve e preencha as Observações.'],
            ['6. Entregar o repasse', 'Entregue o valor físico ao gestor. Ele confirmará o recebimento no sistema.', 'Guarde o comprovante se houver.'],
          ],
          colStyles: { 0: { cellWidth: 30 }, 1: { cellWidth: 75 } },
        },
        { type: 'label', content: 'Erros mais comuns — e como evitar:' },
        { type: 'table',
          headers: ['Erro', 'Consequência', 'Como evitar'],
          rows: [
            ['Saldo inicial errado', 'Gera divergência de abertura no próximo fechamento', 'Conte o dinheiro físico antes de digitar'],
            ['Esquecer uma saída', 'O caixa sobra — gera divergência positiva', 'Anote as saídas no momento em que acontecem'],
            ['Repasse diferente do entregue', 'O gestor não consegue confirmar — valor não bate', 'Informe o valor exato que está entregando fisicamente'],
            ['Salvar duas vezes', 'Duplicidade no histórico, difícil de corrigir', 'Verifique se já há fechamento do dia antes de salvar'],
            ['Sem observação na divergência', 'O gestor não consegue revisar sem justificativa', 'Sempre explique o motivo no campo Observações'],
          ],
          colStyles: { 0: { cellWidth: 40 }, 1: { cellWidth: 65 } },
        },
        { type: 'label', content: 'Dúvidas frequentes:' },
        { type: 'table',
          headers: ['Dúvida', 'Resposta'],
          rows: [
            ['Posso fazer o fechamento no dia seguinte?', 'Não é recomendado. Faça ao fim do turno, com o dinheiro físico em mãos. Correções exigem retificação pelo gestor.'],
            ['O que é o fundo padrão?', 'Valor configurado pelo gestor que deve sempre ficar no caixa. O sistema desconta no repasse sugerido — você não calcula.'],
            ['Abri o caixa com valor diferente. O que faço?', 'Informe o valor real. Explique nas Observações (ex: "fundo complementado pelo gestor"). O sistema registra a divergência de abertura.'],
            ['Preciso repassar tudo acima do fundo?', 'Sim, a menos que o gestor oriente diferente. Valores muito pequenos podem ter tolerância configurada.'],
            ['Errei o fechamento. Posso apagar e refazer?', 'Não é possível apagar. Avise o gestor, que solicita Retificação à Gestão 5X. O original é mantido para auditoria.'],
          ],
          colStyles: { 0: { cellWidth: 65 } },
        },
      ],
    },
  ];

  /* ── Capa reutilizável ── */
  const _renderCover = (subtitle) => {
    doc.setFillColor(...dark);
    doc.rect(0, 0, PW, PH, 'F');

    /* Barra teal superior com logo proporcional */
    doc.setFillColor(...teal);
    doc.rect(0, 0, PW, 62, 'F');
    if (logoB64) {
      doc.addImage(logoB64, 'PNG', (PW - logoW) / 2, (62 - logoH) / 2, logoW, logoH, '', 'FAST');
    }

    /* Corpo escuro */
    doc.setFillColor(...dark);
    doc.rect(0, 62, PW, PH - 62, 'F');
    doc.setFillColor(...teal);
    doc.rect(0, 62, PW, 2, 'F');

    /* Título */
    doc.setTextColor(...white);
    doc.setFontSize(28);
    doc.setFont(undefined, 'bold');
    doc.text('Manual de Implantação', PW / 2, 108, { align: 'center' });

    doc.setFillColor(...teal);
    doc.rect(40, 114, PW - 80, 1.5, 'F');

    /* Subtítulo: nome da seção ou tagline */
    doc.setTextColor(...teal);
    doc.setFontSize(12);
    doc.setFont(undefined, 'normal');
    const subLines = doc.splitTextToSize(subtitle, PW - 60);
    subLines.forEach((l, i) => doc.text(l, PW / 2, 124 + i * 7, { align: 'center' }));

    /* Grade de seções apenas no manual completo */
    if (!onlySection) {
      const sectionLabels = ['Visão Geral', 'Perfis de Acesso', 'Fechamento Diário', 'Transações', 'Implantação', 'Checklist', 'Manual do Gestor', 'Manual do Operador'];
      const bW = (PW - 32) / 4, bH = 20;
      sectionLabels.forEach((lbl, i) => {
        const col = i % 4, row = Math.floor(i / 4);
        const bx = 16 + col * (bW + 2.5), by = 152 + row * (bH + 6);
        doc.setFillColor(22, 34, 48);
        doc.roundedRect(bx, by, bW, bH, 2, 2, 'F');
        doc.setFillColor(...teal);
        doc.roundedRect(bx, by, 3, bH, 1, 1, 'F');
        doc.setTextColor(...white);
        doc.setFontSize(8);
        const ls = doc.splitTextToSize(`${i + 1}. ${lbl}`, bW - 8);
        doc.text(ls, bx + 7, by + (bH - ls.length * 4) / 2 + 4);
      });
    }

    /* Rodapé da capa */
    doc.setFillColor(8, 14, 22);
    doc.rect(0, 254, PW, 38, 'F');
    doc.setFillColor(...teal);
    doc.rect(0, PH - 5, PW, 5, 'F');
    doc.setTextColor(130, 145, 160);
    doc.setFontSize(9);
    doc.text('Sistema de Fechamento de Caixa em Dinheiro', PW / 2, 266, { align: 'center' });
    doc.setTextColor(...teal);
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('Gestão 5X', PW / 2, 277, { align: 'center' });
    doc.setTextColor(130, 145, 160);
    doc.setFontSize(8.5);
    doc.setFont(undefined, 'normal');
    doc.text(`Emitido em ${todayStr}`, PW / 2, 286, { align: 'center' });
  };

  /* ── Renderização ── */
  const nameMap = { overview: 'visao_geral', perfis: 'perfis', fechamento: 'fechamento', transacoes: 'transacoes', implantacao: 'implantacao', checklist: 'checklist', gestor: 'manual_gestor', operador: 'manual_operador' };

  if (!onlySection) {
    _renderCover('Conferência Caixa em Dinheiro');
    allSections.forEach(s => { doc.addPage(); _section(s.title, s.content); });
    doc.save('manual_implantacao_gestao5x.pdf');
  } else {
    const target = allSections.find(s => s.key === onlySection);
    if (!target) { alert('Seção não encontrada.'); return; }
    /* Capa com o título da seção + seção na página seguinte */
    _renderCover(target.title);
    doc.addPage();
    _section(target.title, target.content);
    doc.save(`manual_${nameMap[onlySection] || onlySection}_gestao5x.pdf`);
  }
}

async function exportManualTabPDF() {
  const btn = document.querySelector('#manualImplantacao .inner-tab-btn.active');
  const tabId = btn?.dataset?.subtab || 'man-overview';
  const map = { 'man-overview': 'overview', 'man-perfis': 'perfis', 'man-fechamento': 'fechamento', 'man-transacoes': 'transacoes', 'man-implantacao': 'implantacao', 'man-checklist': 'checklist', 'man-gestor': 'gestor', 'man-operador': 'operador' };
  await exportManualPDF(map[tabId] || 'overview');
}

Object.assign(window, {
  getScopedClosings, filteredClosings,
  masterFilteredClosings, extractFilteredClosings,
  divergenceFilteredClosings, adminMovFilteredClosings,
  operatorHistoryClosings, reportFilteredClosings, validateAndExport,
  closingRows, allMovementRows, diffRead, diffAction,
  exportCSV, exportDivergencesCSV, exportTransfersCSV, exportExpensesCSV,
  exportAuditCSV, exportClientMovementsCSV, exportClientDivergencesCSV,
  exportContaAzulXLSX, exportConsolidadoCSV,
  generatePDF, exportManualPDF, exportManualTabPDF,
  exportFechamentoPDF, exportDivergencesPDF, exportTransfersPDF, exportExpensesPDF,
  exportConsolidadoPDF, exportAuditPDF, exportClientMovementsPDF, exportClientDivergencesPDF,
});
