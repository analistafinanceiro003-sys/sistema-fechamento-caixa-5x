'use strict';
/* ============================================================
   RENDERIZAÇÃO — Caixa 5X
   Cada função de render é independente: erro em uma não derruba as demais.
============================================================ */

function renderAll() {
  if (!state) return;
  try { fillSelects(); } catch(e) { console.warn('fillSelects:', e); }
  try { renderSidebarByPermissions(); } catch(e) { console.warn('renderSidebarByPermissions:', e); }
  try { applyModuleAccess(); } catch(e) { console.warn('applyModuleAccess:', e); }
  try { renderMetrics(); } catch(e) { console.warn('renderMetrics:', e); }
  try { renderMasterDashboard(); } catch(e) { console.warn('renderMasterDashboard:', e); }
  try { renderCadastros(); } catch(e) { console.warn('renderCadastros:', e); }
  try { renderOperacao(); } catch(e) { console.warn('renderOperacao:', e); }
  try { renderFechamentos(); } catch(e) { console.warn('renderFechamentos:', e); }
  try { renderSistema(); } catch(e) { console.warn('renderSistema:', e); }
  try { renderAdminViews(); } catch(e) { console.warn('renderAdminViews:', e); }
  try { renderOperatorViews(); } catch(e) { console.warn('renderOperatorViews:', e); }
  try { renderModuleManager(); } catch(e) { console.warn('renderModuleManager:', e); }
  try { renderAttachments(); } catch(e) { console.warn('renderAttachments:', e); }
  try { renderDocumentos(); } catch(e) { console.warn('renderDocumentos:', e); }
  try { calc(); } catch(e) { console.warn('calc:', e); }
}

/* --- KPIs (Master e Admin) --- */
function renderMetrics() {
  /* Master */
  text('mCompanies', state.companies.filter((c) => c.status !== 'Inativa').length);
  text('mStores', state.stores.length);
  text('mClosings', state.closings.length);
  text('mDiff', money(state.closings.reduce((a, c) => a + Math.abs(Number(c.diff || 0)), 0)));
  /* Admin */
  const adminRows = getScopedClosings({ scope: 'admin' });
  text('aStores', state.stores.filter((s) => s.companyId === currentUser?.companyId).length);
  text('aClosings', adminRows.length);
  text('aUsers', state.users.filter((u) => u.companyId === currentUser?.companyId).length);
  text('aDiff', money(adminRows.reduce((a, c) => a + Math.abs(Number(c.diff || 0)), 0)));
}

/* --- MASTER DASHBOARD --- */
function renderMasterDashboard() {
  /* Alertas de divergência */
  const critical = state.closings.filter((c) => c.status === 'Divergência').slice(-5);
  html('dashAlerts', critical.length
    ? critical.map((c) => `<div class="alert-item warning"><strong>${esc(companyName(c.companyId))} / ${esc(storeName(c.storeId))}</strong><span>${money(c.diff)}</span><span class="subtle">${esc(c.date)}</span></div>`).join('')
    : '<p class="subtle">Nenhuma divergência recente.</p>'
  );
  /* Empresas em implantação */
  const impl = state.companies.filter((c) => c.status === 'Implantação');
  html('dashImplant', impl.length
    ? impl.map((c) => `<div class="alert-item info"><strong>${esc(c.name)}</strong><span class="status warning">Implantação</span></div>`).join('')
    : '<p class="subtle">Nenhuma empresa em implantação.</p>'
  );
  /* Resumo executivo */
  const totalDiv = state.closings.reduce((a, c) => a + Math.abs(Number(c.diff || 0)), 0);
  html('dashSummary', `
    <div class="exec-stats">
      <div class="exec-stat"><span>Empresas ativas</span><strong>${state.companies.filter((c) => c.status !== 'Inativa').length}</strong></div>
      <div class="exec-stat"><span>Lojas/Caixas</span><strong>${state.stores.length}</strong></div>
      <div class="exec-stat"><span>Fechamentos</span><strong>${state.closings.length}</strong></div>
      <div class="exec-stat"><span>Divergência total</span><strong>${money(totalDiv)}</strong></div>
    </div>`
  );
}

/* --- CADASTROS (sub-abas) --- */
function renderCadastros() {
  /* Empresas */
  html('companiesBody', state.companies.map((c) =>
    `<tr>
      <td>${esc(c.name)}</td><td>${esc(c.legal)}</td><td>${esc(c.cnpj)}</td>
      <td>${esc(c.segment)}</td><td>${tag(c.status)}</td><td>${esc(c.plan)}</td>
      <td>${state.stores.filter((s) => s.companyId === c.id).length}</td>
      <td>${state.users.filter((u) => u.companyId === c.id).length}</td>
      <td>
        <button class="btn btn-sm" onclick="toggleCompany('${c.id}')">${c.status === 'Inativa' ? 'Ativar' : 'Inativar'}</button>
      </td>
    </tr>`
  ).join('') || emptyRow(9));

  /* Lojas — com filtro e ações de editar/excluir */
  const storeSearch = (val('storeFilter') || '').toLowerCase();
  const filteredStores = visibleStores().filter((s) =>
    !storeSearch || s.name.toLowerCase().includes(storeSearch) || (s.code || '').toLowerCase().includes(storeSearch)
  );
  html('storesBody', filteredStores.map((s) => {
    const hasClosings = (state.closings || []).some((c) => c.storeId === s.id);
    return `<tr>
      <td>${esc(companyName(s.companyId))}</td><td>${esc(s.name)}</td>
      <td>${esc(s.code)}</td><td>${esc(s.cashType)}</td>
      <td>${money(s.standardFund)}</td>
      <td>${tag(s.status)}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-sm" onclick="loadStoreToEdit('${s.id}')">Editar</button>
        <button class="btn btn-danger btn-sm" onclick="deleteStore('${s.id}')" ${hasClosings ? 'title="Esta loja possui fechamentos vinculados"' : ''}>Excluir</button>
      </td>
    </tr>`;
  }).join('') || emptyRow(7));

  /* Usuários */
  renderUsersByCompany();

  /* Implantação — checklist editável por empresa */
  const implantCid = val('implantCompanyFilter') || '';
  const implantStepsData = implantCid ? (state.implantSteps?.[implantCid] || {}) : null;

  /* Wizard: overview das etapas da empresa selecionada */
  html('setupWizard', IMPLANT_STEP_LIST.map((s, i) => {
    const statusVal = implantStepsData?.[s.key]?.status || 'Pendente';
    const cls = statusVal === 'Concluído' ? 'done' : statusVal === 'Em andamento' ? 'doing' : 'pending';
    return `<div class="step ${cls}"><small>Etapa ${i + 1}</small><strong>${esc(s.name.replace(/^\d+\.\s*/, ''))}</strong></div>`;
  }).join(''));

  /* Tabela editável com Salvar por linha */
  if (implantCid) {
    html('implantBody', IMPLANT_STEP_LIST.map((s) => {
      const step = implantStepsData?.[s.key] || { status: 'Pendente', note: '', date: '' };
      return `<tr>
        <td><strong>${esc(s.name)}</strong></td>
        <td>
          <select id="implantStatus_${s.key}" style="min-width:150px">
            ${['Pendente','Em andamento','Concluído'].map(
              (opt) => `<option value="${opt}"${step.status === opt ? ' selected' : ''}>${opt}</option>`
            ).join('')}
          </select>
        </td>
        <td><input id="implantNote_${s.key}" value="${esc(step.note || '')}" placeholder="Observação..." style="min-width:180px;width:100%"/></td>
        <td><span class="subtle" style="font-size:12px">${esc(step.date || '-')}</span></td>
        <td>
          <button class="btn btn-sm btn-primary"
            onclick="upsertImplantStep('${implantCid}','${s.key}','${s.name}',
              document.getElementById('implantStatus_${s.key}').value,
              document.getElementById('implantNote_${s.key}').value)">Salvar</button>
        </td>
      </tr>`;
    }).join(''));
  } else {
    html('implantBody', `<tr><td colspan="5" style="text-align:center;padding:24px" class="subtle">Selecione uma empresa para ver e editar o checklist.</td></tr>`);
  }
}

function renderUsersByCompany() {
  const filter = val('usersCompanyFilter');
  const rows = state.users.filter((u) => !filter || u.companyId === filter);
  html('usersBody', rows.map((u) =>
    `<tr>
      <td>${esc(companyName(u.companyId))}</td><td>${esc(storeName(u.storeId))}</td>
      <td>${esc(u.name)}</td><td>${esc(u.login)}</td>
      <td>${u.role === 'admin' ? 'Administrador Cliente' : 'Operador'}</td>
      <td>${tag(u.status || 'Ativo')}</td>
      <td>
        <button class="btn btn-sm" onclick="
          document.getElementById('userManageCompany').value='${u.companyId}';
          fillUserManageSelect();
          document.getElementById('userManageSelect').value='${u.id}';
          loadUserToEdit()
        ">Editar</button>
      </td>
    </tr>`
  ).join('') || emptyRow(7));
}

/* --- OPERAÇÃO (sub-abas: regras, config, módulos) --- */
function renderOperacao() {
  /* Regras */
  const filter = val('ruleFilterCompany');
  const companies = state.companies.filter((c) => !filter || c.id === filter);
  html('companyRuleTabs', companies.map((c) =>
    `<button class="btn btn-sm" onclick="document.getElementById('ruleFilterCompany').value='${c.id}';renderOperacao()">${esc(c.name)}</button>`
  ).join(''));
  html('rulesByCompany', companies.map((c) => {
    const rows = state.rules.filter((r) => r.companyId === c.id);
    return `<div class="rule-company-card"><h4>${esc(c.name)}</h4>${
      rows.length
        ? rows.map((r) => `<div class="rule-row-mini"><strong>${esc(r.type)}:</strong> ${esc(r.text)}</div>`).join('')
        : '<p class="subtle">Nenhuma regra cadastrada.</p>'
    }</div>`;
  }).join('') || '<p class="subtle">Nenhuma empresa.</p>');
  html('rulesBody', state.rules.map((r) =>
    `<tr><td>${esc(companyName(r.companyId))}</td><td>${esc(r.type)}</td><td>${esc(r.text)}</td></tr>`
  ).join('') || emptyRow(3));

  /* Configuração operacional */
  html('operationConfigList', Object.entries(state.operationConfigs).map(([cid, c]) =>
    `<div class="kpi-alert" style="margin-bottom:10px">
      <strong>${esc(companyName(cid))}</strong>
      <p class="subtle">Modo: ${esc(c.mode)} | Tolerância: ${money(c.tolerance)} | Repasse: ${esc(c.receiver || '-')}</p>
    </div>`
  ).join('') || '<p class="subtle">Nenhuma configuração salva.</p>');
}

/* --- FECHAMENTOS (sub-abas: movimentações, extrato, divergências) --- */
function renderFechamentos() {
  /* Movimentações */
  html('movementsBody', masterFilteredClosings().map((c) =>
    `<tr>
      <td>${esc(companyName(c.companyId))}</td><td>${esc(storeName(c.storeId))}</td>
      <td>${esc(c.date)}<br><span class="subtle">${esc(c.shift || 'Integral')}</span></td><td>${esc(c.responsible)}</td>
      <td>${money(c.initial)}</td><td>${money(c.entries)}</td><td>${money(c.expenses)}</td>
      <td>${money(c.expected)}</td><td>${money(c.transfer)}</td>
      <td>${money(c.cashBalance ?? c.finalAfterTransfer)}</td>
      <td>${money(c.fundDivergence ?? c.diff)}<br><span class="subtle">Abertura: ${money(c.openingDivergence || 0)}</span></td>
      <td>${tag(c.type || 'Original')}${c.type === 'Retificado' && c.originalClosingId ? `<button class="btn" style="padding:3px 8px;font-size:11px;margin-left:6px" onclick="openOriginalClosingModal('${esc(c.originalClosingId)}')">Ver original</button>` : ''}</td>
      <td>${tag(c.status)}</td>
    </tr>`
  ).join('') || emptyRow(13));

  /* Extrato — usa extractFilteredClosings() que já respeita data/loja */
  const type = val('masterExtractType');
  let extractRows = allMovementRows(extractFilteredClosings());
  if (type) extractRows = extractRows.filter((r) => r.Tipo === type);
  html('masterMovementsExtractBody', extractRows.map((r) =>
    `<tr>
      <td>${esc(r.Empresa)}</td><td>${esc(r.Data)}</td><td>${esc(r.Loja)}</td>
      <td>${esc(r.Tipo)}</td><td>${esc(r.Descrição)}</td>
      <td style="color:${Number(r.Valor)>=0?'var(--success)':'var(--danger)'}">${money(r.Valor)}</td>
      <td>${esc(r.Responsável)}</td>
    </tr>`
  ).join('') || emptyRow(7));

  /* Divergências */
  const divRows = divergenceFilteredClosings();
  html('divergenceSummary',
    `<div class="kpi-alert"><strong>${divRows.length} divergência(s)</strong>
    <p class="subtle">Valor absoluto total: ${money(divRows.reduce((a,c)=>a+Math.abs(Number(c.diff||0)),0))}</p></div>`
  );
  html('divergencesBody', divRows.map((c) =>
    `<tr>
      <td>${esc(companyName(c.companyId))}</td><td>${esc(storeName(c.storeId))}</td>
      <td>${esc(c.date)}</td><td style="color:${Number(c.diff)<0?'var(--danger)':'var(--warning)'}">${money(c.diff)}</td>
      <td>${esc(diffRead(c))}</td><td>${esc(diffAction(c))}</td>
    </tr>`
  ).join('') || emptyRow(6));
}

/* --- SISTEMA (sub-abas: config, backup, logs) --- */
function renderSistema() {
  /* Config / opções de seleção */
  const labels = {
    segments:'Segmentos', plans:'Planos', companyStatus:'Status da empresa',
    cashTypes:'Tipos de caixa', operationModes:'Modos de fechamento',
    ruleTypes:'Tipos de regra', shifts:'Turnos',
    implantSteps:'Etapas de implantação', implantStatus:'Status de implantação',
    expenseCategories:'Categorias de saída',
  };
  html('optionGroups', Object.keys(labels).map((key) =>
    `<div class="option-group">
      <div class="option-group-head"><strong>${labels[key]}</strong><span class="pill">${(state.selectOptions[key]||[]).length} opção(ões)</span></div>
      <div class="option-items">${(state.selectOptions[key]||[]).map((v) =>
        `<span class="option-pill">${esc(v)}<button onclick="removeSelectOption('${key}','${esc(v)}')">×</button></span>`
      ).join('') || '<span class="subtle">Nenhuma.</span>'}</div>
    </div>`
  ).join(''));

  /* Tabelas de manutenção */
  html('settingsCompaniesBody', state.companies.map((c) =>
    `<tr><td>${esc(c.name)}</td><td>${tag(c.status)}</td><td><button class="btn btn-danger btn-sm" onclick="deleteCompany('${c.id}')">Excluir</button></td></tr>`
  ).join('') || emptyRow(3));
  html('settingsStoresBody', state.stores.map((s) =>
    `<tr><td>${esc(companyName(s.companyId))}</td><td>${esc(s.name)}</td><td><button class="btn btn-danger btn-sm" onclick="deleteStore('${s.id}')">Excluir</button></td></tr>`
  ).join('') || emptyRow(3));
  html('settingsUsersBody', state.users.map((u) =>
    `<tr><td>${esc(u.name)}<br><span class="subtle">${esc(u.login)}</span></td><td>${u.role === 'admin' ? 'ADM Cliente' : 'Operador'}</td><td><button class="btn btn-danger btn-sm" onclick="deleteUser('${u.id}')">Excluir</button></td></tr>`
  ).join('') || emptyRow(3));
  html('settingsRulesBody', state.rules.map((r) =>
    `<tr><td>${esc(companyName(r.companyId))}</td><td>${esc(r.type)}</td><td><button class="btn btn-danger btn-sm" onclick="deleteRule('${r.id}')">Excluir</button></td></tr>`
  ).join('') || emptyRow(3));

  /* Logs de auditoria */
  html('auditLogBody', [...(state.audit || [])].reverse().slice(0,100).map((a) =>
    `<tr><td>${new Date(a.date).toLocaleString('pt-BR')}</td><td>${esc(a.user)}</td><td>${tag(a.role)}</td><td>${esc(a.action)}</td><td>${esc(a.detail)}</td></tr>`
  ).join('') || emptyRow(5));
}

/* --- ADMIN --- */
function renderAdminViews() {
  const stores = state.stores.filter((s) => s.companyId === currentUser?.companyId);
  const rows   = getScopedClosings({ scope: 'admin' });

  /* KPIs do dashboard */
  text('aStores',   stores.length);
  text('aClosings', rows.length);
  const totalDiff = rows.reduce((a, c) => a + Math.abs(Number(c.diff || 0)), 0);
  text('aDiff', money(totalDiff));

  /* Saldo Central = soma dos repasses marcados como Recebido */
  const receipts = getTransferReceipts().filter((r) => r.companyId === currentUser?.companyId);
  const saldoCentral = receipts.reduce((a, r) => a + Number(r.amount || 0), 0);
  const pendCount    = rows.filter((c) => Number(c.transfer || 0) > 0 &&
    !receipts.find((r) => r.closingId === c.id)).length;
  text('aSaldoCentral', money(saldoCentral));
  text('aSaldoCentralHint', `${pendCount} repasse(s) pendente(s)`);

  /* Dashboard por loja */
  html('adminStoreDashboard', stores.map((s) => {
    const cls = rows.filter((c) => c.storeId === s.id);
    const lastStatus = cls.slice(-1)[0]?.status || '-';
    return `<div class="store-card">
      <h4>${esc(s.name)}</h4>
      <div class="store-kpis">
        <div class="store-kpi"><span>Entradas</span><strong>${money(cls.reduce((a,c)=>a+Number(c.entries||0),0))}</strong></div>
        <div class="store-kpi"><span>Saídas</span><strong>${money(cls.reduce((a,c)=>a+Number(c.expenses||0),0))}</strong></div>
        <div class="store-kpi"><span>Repasse</span><strong>${money(cls.reduce((a,c)=>a+Number(c.transfer||0),0))}</strong></div>
        <div class="store-kpi"><span>Divergência</span><strong>${money(cls.reduce((a,c)=>a+Number(c.diff||0),0))}</strong></div>
      </div>
      <div style="margin-top:8px">${tag(lastStatus)}</div>
    </div>`;
  }).join('') || '<p class="subtle">Nenhuma loja cadastrada.</p>');

  /* Lojas */
  html('adminStoresBody', stores.map((s) =>
    `<tr><td>${esc(s.name)}</td><td>${esc(s.code)}</td><td>${esc(s.cashType)}</td><td>${money(s.standardFund)}</td><td>${tag(s.status)}</td></tr>`
  ).join('') || emptyRow(5));

  /* Regras */
  html('adminRulesList', state.rules.filter((r) => r.companyId === currentUser?.companyId).map((r) =>
    `<div class="rule"><span class="dot"></span><span><strong>${esc(r.type)}:</strong> ${esc(r.text)}</span></div>`
  ).join('') || '<p class="subtle">Nenhuma regra cadastrada.</p>');

  /* Saldo Inicial autorizado */
  const adjStores = role === 'master' ? state.stores.filter((s) => s.status !== 'Inativa') : stores;
  setOptions('openingAdjustmentStore', adjStores.map((s) => [s.id, s.name]), 'Selecione');
  if ($('openingAdjustmentDate') && !val('openingAdjustmentDate')) setVal('openingAdjustmentDate', todayISO());
  html('openingAdjustmentsBody', (state.cashOpeningAdjustments || [])
    .filter((a) => role === 'master' || a.companyId === currentUser?.companyId)
    .map((a) => `<tr><td>${esc(storeName(a.storeId))}</td><td>${esc(toBRFromISO(parseBR(a.startDate)))}</td><td>${esc(a.shift || 'Integral')}</td><td>${money(a.amount)}</td><td>${esc(a.reason)}</td><td>${esc(a.authorizedBy || '-')}</td></tr>`)
    .join('') || emptyRow(6));

  /* Histórico de fechamentos (afech-historico) — usa filtros adminMovStart/adminMovEnd */
  setOptions('adminMovementStoreFilter', stores.map((s) => [s.id, s.name]), 'Todas');
  const histRows = allMovementRows(adminMovFilteredClosings());
  html('adminMovementsDetailBody', histRows.map((r) =>
    `<tr><td>${esc(r.Data)}</td><td>${esc(r.Loja)}</td><td>${esc(r.Tipo)}</td><td>${esc(r.Descrição)}</td>
     <td style="color:${Number(r.Valor)>=0?'var(--success)':'var(--danger)'}">${money(r.Valor)}</td><td>${esc(r.Responsável)}</td></tr>`
  ).join('') || emptyRow(6));

  /* Extrato (amov-extrato) — com filtros por loja e período */
  setOptions('adminExtratStoreFilter', stores.map((s) => [s.id, s.name]), 'Todas');
  const extratStore = val('adminExtratStoreFilter');
  const extratStart = val('adminExtratStart');
  const extratEnd   = val('adminExtratEnd');
  const adminMovRows = rows.filter((c) =>
    (!extratStore || c.storeId === extratStore) &&
    (!extratStart || parseBR(c.date) >= extratStart) &&
    (!extratEnd   || parseBR(c.date) <= extratEnd)
  );
  html('adminMovementsDetailBody2', allMovementRows(adminMovRows).map((r) =>
    `<tr><td>${esc(r.Data)}</td><td>${esc(r.Loja)}</td><td>${esc(r.Tipo)}</td><td>${esc(r.Descrição)}</td>
     <td style="color:${Number(r.Valor)>=0?'var(--success)':'var(--danger)'}">${money(r.Valor)}</td><td>${esc(r.Responsável)}</td></tr>`
  ).join('') || emptyRow(6));

  /* Repasses Recebidos */
  setOptions('adminRepasseStoreFilter', stores.map((s) => [s.id, s.name]), 'Todas');
  const repStore  = val('adminRepasseStoreFilter');
  const repStart  = val('adminRepasseStart');
  const repEnd    = val('adminRepasseEnd');
  const repStatus = val('adminRepasseStatusFilter');
  const repasseRows = rows.filter((c) =>
    Number(c.transfer || 0) > 0 &&
    (!repStore || c.storeId === repStore) &&
    (!repStart || parseBR(c.date) >= repStart) &&
    (!repEnd   || parseBR(c.date) <= repEnd)
  );
  html('adminRepassesBody', repasseRows.map((c) => {
    const receipt = receipts.find((r) => r.closingId === c.id);
    const status  = receipt ? 'Recebido' : 'Pendente';
    if (repStatus && status !== repStatus) return '';
    return `<tr>
      <td>${esc(c.date)}</td><td>${esc(storeName(c.storeId))}</td><td>${esc(c.responsible || c.operator || '-')}</td>
      <td>${money(c.transfer)}</td><td>${tag(status)}</td>
      <td>${receipt ? new Date(receipt.confirmedAt).toLocaleString('pt-BR') : '-'}</td>
      <td>${esc(receipt?.confirmedBy || '-')}</td>
      <td>${status === 'Pendente'
        ? `<button class="btn btn-sm btn-primary" onclick="confirmTransferReceipt('${c.id}')">Recebido</button>`
        : '<span class="status success">✓</span>'
      }</td>
    </tr>`;
  }).filter(Boolean).join('') || emptyRow(8));

  /* Divergências — com filtro de status */
  setOptions('adminDivergenceStoreFilter', stores.map((s) => [s.id, s.name]), 'Todas');
  const divStatusFilter = val('adminDivergenceStatusFilter') || 'Pendente';
  const divStoreFilter  = val('adminDivergenceStoreFilter');
  const allReviews = (state.divergenceReviews || []).filter((r) =>
    r.companyId === currentUser?.companyId &&
    (!divStoreFilter || r.storeId === divStoreFilter) &&
    (!divStatusFilter || (r.reviewStatus || 'Pendente') === divStatusFilter)
  );
  html('adminDivergencesReviewBody', allReviews.map((r) => {
    const c = state.closings.find((x) => x.id === r.closingId) || {};
    const isOpen = (r.reviewStatus || 'Pendente') === 'Pendente';
    return `<tr>
      <td>${esc(c.date || '-')}</td><td>${esc(storeName(r.storeId))}</td><td>${esc(c.responsible || '-')}</td>
      <td>${esc(r.divergenceType)}<br><strong>${money(r.divergenceAmount)}</strong></td>
      <td>${tag(r.reviewStatus || 'Pendente')}</td>
      <td>${isOpen
        ? `<button class="btn btn-sm" onclick="reviewDivergence('${r.id}','Revisada')">Revisada</button>
           <button class="btn btn-sm" onclick="reviewDivergence('${r.id}','Justificada')">Justificada</button>
           <button class="btn btn-sm" onclick="reviewDivergence('${r.id}','Resolvida')">Resolvida</button>`
        : `<span class="subtle">${esc(r.adminComment || '-')}</span>`
      }</td>
    </tr>`;
  }).join('') || emptyRow(6));

  /* Últimas movimentações (dashboard) */
  html('adminMovementsBody', rows.slice(-8).reverse().map((c) =>
    `<tr><td>${esc(c.date)}</td><td>${esc(storeName(c.storeId))}</td><td>${money(c.entries)}</td><td>${money(c.diff)}</td><td>${tag(c.status)}</td></tr>`
  ).join('') || emptyRow(5));
}

/* --- OPERADOR --- */
function renderOperatorViews() {
  const rows = operatorHistoryClosings(); /* respeita filtro de data */
  html('operatorHistoryBody', [...rows].reverse().map((c) =>
    `<tr>
      <td>${esc(c.date)}</td><td>${esc(storeName(c.storeId))}</td>
      <td>${money(c.entries)}</td><td>${money(c.expenses)}</td><td>${money(c.transfer)}</td>
      <td style="color:${Number(c.diff)<0?'var(--danger)':'var(--warning)'}">${money(c.diff)}</td>
      <td>${tag(c.type||'Original')}${c.type === 'Retificado' && c.originalClosingId ? `<button class="btn" style="padding:3px 8px;font-size:11px;margin-left:6px" onclick="openOriginalClosingModal('${esc(c.originalClosingId)}')">Ver original</button>` : ''}</td>
      <td>${tag(c.status)}</td>
    </tr>`
  ).join('') || emptyRow(8));

  /* Regras da loja — bloco no formulário de fechamento (store selecionada no form) */
  const closingStore = selectedStore();
  const closingRules = state.rules.filter((r) => r.companyId === closingStore?.companyId && r.status !== 'Inativa');
  const closingCfg = cfg(closingStore?.companyId);
  html('operatorRules',
    `${closingRules.map((r) => `<div class="rule"><span class="dot"></span><span><strong>${esc(r.type)}:</strong> ${esc(r.text)}</span></div>`).join('')}
    ${closingCfg.message ? `<div class="rule"><span class="dot"></span><span>${esc(closingCfg.message)}</span></div>` : ''}`
    || '<p class="subtle">Nenhuma regra cadastrada.</p>'
  );

  /* Regras da loja — aba "Regras da Loja" da sidebar do operador */
  const opStore = state.stores.find((s) => s.id === currentUser?.storeId);
  const opRules = state.rules.filter((r) =>
    r.companyId === opStore?.companyId &&
    (!r.storeId || r.storeId === opStore?.id) &&
    r.status !== 'Inativa'
  );
  const opCfg = cfg(opStore?.companyId);
  const rulesHtml = opRules.map((r) =>
    `<div class="rule"><span class="dot"></span><span><strong>${esc(r.type)}:</strong> ${esc(r.text)}</span></div>`
  ).join('');
  html('adminRulesList2',
    rulesHtml
    + (opCfg.message ? `<div class="rule"><span class="dot"></span><span>${esc(opCfg.message)}</span></div>` : '')
    || '<p class="subtle">Nenhuma regra cadastrada para esta loja.</p>'
  );
}

/* --- MÓDULOS (gerenciador hierárquico) --- */
function renderModuleManager() {
  const cid = val('moduleCompany');
  const profile = val('moduleProfile') || 'admin';
  const box = $('moduleManager');
  if (!box) return;
  if (!cid) { box.innerHTML = '<p class="subtle">Selecione uma empresa para configurar os módulos.</p>'; return; }

  const config = getModuleConfig(cid, profile);
  setVal('moduleAccessStatus', config.status || 'Ativo');

  const tree = MODULE_TREE[profile] || [];
  if (!tree.length) {
    box.innerHTML = '<p class="subtle">Nenhum módulo configurável para este perfil.</p>';
    return;
  }

  box.innerHTML = tree.map((mod) => {
    const parentEnabled = config[mod.key] !== false;

    const subHtml = mod.submodules.length
      ? `<div class="module-children" style="${parentEnabled ? '' : 'display:none'}">` +
        mod.submodules.map((sub) => {
          const subEnabled = config[sub.key] !== false;
          return `<label class="module-child-label">
            <input type="checkbox" class="module-check-child" data-module-key="${sub.key}" data-parent="${mod.key}"
              ${subEnabled ? 'checked' : ''} onchange="draftModules()"/>
            <span>${esc(sub.label)}</span>
            <span class="status ${subEnabled ? 'success' : 'danger'}" style="font-size:10px;margin-left:6px">${subEnabled ? 'Lib.' : 'Bloq.'}</span>
          </label>`;
        }).join('') + `</div>`
      : '';

    const closingWarn = (mod.key === 'adminFechamento' && parentEnabled)
      ? `<p class="subtle" style="color:#d97706;margin-top:5px;font-size:12px">⚠ Liberar "Cadastrar Fechamento" permite que o Admin registre fechamentos.</p>`
      : '';

    return `<div class="module-group">
      <div class="module-group-header">
        <label class="module-parent-label">
          <input type="checkbox" class="module-check-parent" data-module-key="${mod.key}"
            ${parentEnabled ? 'checked' : ''} onchange="onParentModuleChange(this)"/>
          <strong>${esc(mod.label)}</strong>
        </label>
        <span class="status ${parentEnabled ? 'success' : 'danger'}">${parentEnabled ? 'Liberado' : 'Bloqueado'}</span>
      </div>
      ${closingWarn}
      ${subHtml}
    </div>`;
  }).join('');
}

/* --- switch central (aba de setup dentro de Cadastros) --- */
function switchCentral(tabId, btn) {
  all('.central-tab').forEach((t) => t.classList.add('hidden'));
  $(tabId)?.classList.remove('hidden');
  all('.tab-btn').forEach((b) => b.classList.remove('active'));
  btn?.classList.add('active');
}

/* ================================================================
   PASTA DE DOCUMENTOS — renderização por perfil
================================================================ */
function renderDocumentos() {
  const docs = state.storeDocuments || [];
  const docItem = (d) => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid #f1f5f9;font-size:13px">
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        ${esc(d.name)}${d.description ? ` <span class="subtle">— ${esc(d.description)}</span>` : ''}
      </span>
      <span class="subtle" style="white-space:nowrap">${Math.round((d.size||0)/1024)} KB</span>
      <span class="subtle" style="white-space:nowrap">${esc((d.createdAt||'').slice(0,10))}</span>
      ${d.url ? `<a class="btn btn-sm" href="${esc(d.url)}" target="_blank" rel="noopener" style="white-space:nowrap">Ver</a>` : ''}
      <button class="btn btn-danger btn-sm" onclick="handleDeleteDoc('${d.id}','${esc(d.path||'')}')">Remover</button>
    </div>`;

  if (role === 'operator') {
    const myDocs = docs.filter((d) => d.storeId === currentUser?.storeId)
      .sort((a, b) => (b.createdAt||'').localeCompare(a.createdAt||''));
    html('operatorDocList', myDocs.length
      ? myDocs.map(docItem).join('')
      : '<p class="subtle" style="padding:16px">Nenhum documento enviado ainda.</p>'
    );
    return;
  }

  const storeFolder = (s) => {
    const storeDocs = docs.filter((d) => d.storeId === s.id)
      .sort((a, b) => (b.createdAt||'').localeCompare(a.createdAt||''));
    const header = role === 'master'
      ? `${esc(companyName(s.companyId))} / ${esc(s.name)}`
      : esc(s.name);
    return `
      <div class="rule-company-card" style="margin-bottom:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:8px">
          <h4 style="margin:0">${header} <span class="subtle">(${storeDocs.length} arquivo${storeDocs.length!==1?'s':''})</span></h4>
          ${storeDocs.length ? `<button class="btn btn-danger btn-sm" onclick="handleClearStoreDocuments('${s.id}','${esc(s.name)}')">Limpar pasta</button>` : ''}
        </div>
        ${storeDocs.length
          ? storeDocs.map(docItem).join('')
          : '<p class="subtle" style="padding:8px">Pasta vazia.</p>'
        }
      </div>`;
  };

  if (role === 'admin') {
    const myStores = state.stores.filter((s) => s.companyId === currentUser?.companyId);
    html('adminDocFolders', myStores.map(storeFolder).join('') || '<p class="subtle">Nenhuma loja cadastrada.</p>');
    return;
  }

  if (role === 'master') {
    const filterCo    = val('docFilterCompany') || '';
    const filterStore = val('docFilterStore')   || '';
    const coEl = $('docFilterCompany');
    if (coEl && coEl.options.length <= 1) {
      coEl.innerHTML = '<option value="">Todas as empresas</option>' +
        state.companies.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    }
    if (filterCo) {
      setOptions('docFilterStore', state.stores.filter((s) => s.companyId === filterCo).map((s) => [s.id, s.name]), 'Todas as lojas');
    }
    const visStores = state.stores.filter((s) =>
      (!filterCo    || s.companyId === filterCo) &&
      (!filterStore || s.id === filterStore)
    );
    html('masterDocFolders', visStores.map(storeFolder).join('') || '<p class="subtle">Nenhum arquivo encontrado.</p>');
  }
}

Object.assign(window, {
  renderAll, renderMetrics, renderMasterDashboard, renderCadastros,
  renderUsersByCompany, renderOperacao, renderFechamentos, renderSistema,
  renderAdminViews, renderOperatorViews, renderModuleManager, switchCentral,
  renderDocumentos,
});
