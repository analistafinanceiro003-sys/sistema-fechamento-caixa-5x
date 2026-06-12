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
  html('operationConfigList', Object.entries(state.operationConfigs).map(([cid, c]) => {
    const deadline = Number(c.rectificationDeadlineDays ?? 0);
    return `<div class="kpi-alert" style="margin-bottom:10px">
      <strong>${esc(companyName(cid))}</strong>
      <p class="subtle">Modo: ${esc(c.mode)} | Tolerância div.: ${money(c.tolerance)} | Tolerância repasse: ${money(c.transferTolerance || 0)} | Repasse: ${esc(c.receiver || '-')} | Retificação: ${deadline === 0 ? 'mesmo mês' : deadline + ' dias'}</p>
    </div>`;
  }).join('') || '<p class="subtle">Nenhuma configuração salva.</p>');
}

/* --- HELPER: linha de resumo por fechamento (master + admin) --- */
function buildResumoRow(c, receipt, includeEmpresa) {
  const transfer    = Number(c.transfer || 0);
  const saldoCaixa  = Number(c.expected || 0);
  const fundoPadrao = Number(c.standardFund || 0);
  const esperado    = Math.max(0, saldoCaixa - fundoPadrao);
  const diferenca   = transfer - esperado;
  let difHtml;
  if (esperado === 0 && transfer === 0) {
    difHtml = '<span class="subtle">—</span>';
  } else if (diferenca === 0) {
    difHtml = '<span style="color:var(--success)">—</span>';
  } else {
    const col = diferenca < 0 ? 'var(--danger)' : 'var(--warning)';
    const sig = diferenca > 0 ? '+' : '';
    difHtml = `<span style="color:${col};font-weight:600">${sig}${money(diferenca)}</span>`;
  }
  const transferTolerance = Number(cfg(c.companyId)?.transferTolerance || 0);
  const recMotivos = {
    semRepasse: 'Repasse e fundo estão equilibrados — nenhum repasse era necessário neste fechamento.',
    tolerancia: `Valor a repassar (${money(esperado)}) está dentro da tolerância de repasse configurada (${money(transferTolerance)}). Não gera alerta.`,
    naoRepassado: 'O saldo de caixa superou o fundo padrão da loja, mas nenhum repasse foi informado. O valor esperado já desconta o fundo mínimo — se o saldo não ultrapassar o fundo, nenhum aviso é gerado.',
    confirmado: 'Repasse recebido e confirmado pela gestão.',
    pendente: 'Repasse informado pelo operador, aguardando confirmação da gestão.',
  };
  let recTag, recMotivo;
  if (esperado === 0 && transfer === 0) {
    recMotivo = recMotivos.semRepasse;
    recTag = `<span style="background:#e0f2fe;color:#0369a1;padding:2px 7px;border-radius:4px;font-size:11px;white-space:nowrap">Sem repasse — fundo OK</span>`;
  } else if (transfer === 0 && transferTolerance > 0 && esperado <= transferTolerance) {
    recMotivo = recMotivos.tolerancia;
    recTag = `<span style="background:#f1f5f9;color:#64748b;padding:2px 7px;border-radius:4px;font-size:11px;white-space:nowrap">Dentro da tolerância</span>`;
  } else if (transfer === 0) {
    recMotivo = recMotivos.naoRepassado;
    recTag = `<span style="background:#fef9c3;color:#854d0e;padding:2px 7px;border-radius:4px;font-size:11px;white-space:nowrap">⚠ Não repassado</span>`;
  } else if (receipt) {
    recMotivo = recMotivos.confirmado;
    recTag = `<span style="background:#dcfce7;color:#166534;padding:2px 7px;border-radius:4px;font-size:11px;white-space:nowrap">✓ Confirmado</span>`;
  } else {
    recMotivo = recMotivos.pendente;
    recTag = `<span style="background:#fef3c7;color:#92400e;padding:2px 7px;border-radius:4px;font-size:11px;white-space:nowrap">Pendente confirmação</span>`;
  }
  const infoBtn = `<button class="info-tip-btn" data-tooltip="${esc(recMotivo)}" onmouseenter="showInfoTooltip(this)" onmouseleave="hideInfoTooltip()">ⓘ</button>`;
  const regTime = c.createdAt ? new Date(c.createdAt).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'}) : '';
  const empresaCol = includeEmpresa ? `<td>${esc(companyName(c.companyId))}</td>` : '';
  return `<tr>
    ${empresaCol}<td>${esc(storeName(c.storeId))}</td>
    <td>${esc(c.date)}<br><span class="subtle">${esc(c.shift || 'Integral')}</span>${regTime ? `<br><span class="subtle" style="font-size:10px;color:#94a3b8">${regTime}</span>` : ''}</td>
    <td>${esc(c.responsible || '-')}</td>
    <td>${money(c.initial)}</td><td>${money(c.entries)}</td><td>${money(c.expenses)}</td>
    <td>${money(saldoCaixa)}</td><td>${money(esperado)}</td><td>${money(transfer)}</td>
    <td>${difHtml}</td><td style="white-space:nowrap">${recTag}${infoBtn}</td>
  </tr>`;
}

/* --- FECHAMENTOS (sub-abas: movimentações, extrato, divergências) --- */
function renderFechamentos() {
  /* Movimentações */
  html('movementsBody', masterFilteredClosings().map((c) => {
    const atts = c.attachments || [];
    const attHtml = atts.length
      ? atts.map((a) => a.path ? `<button class="btn btn-sm" style="display:block;font-size:11px;margin-bottom:2px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" onclick="viewStorageFile('closing-attachments','${esc(a.path)}','${esc(a.name)}')" title="${esc(a.name)}">${esc(a.name)}</button>` : `<span style="font-size:11px">${esc(a.name)}</span>`).join('')
      : '<span class="subtle" style="font-size:11px">—</span>';
    return `<tr>
      <td>${esc(companyName(c.companyId))}</td><td>${esc(storeName(c.storeId))}</td>
      <td>${esc(c.date)}<br><span class="subtle">${esc(c.shift || 'Integral')}</span></td><td>${esc(c.responsible)}</td>
      <td>${money(c.initial)}</td><td>${money(c.entries)}</td><td>${money(c.expenses)}</td>
      <td>${money(c.expected)}</td><td>${money(c.transfer)}</td>
      <td>${money(c.cashBalance ?? c.finalAfterTransfer)}</td>
      <td>${money(c.fundDivergence ?? c.diff)}<br><span class="subtle">Abertura: ${money(c.openingDivergence || 0)}</span></td>
      <td>${tag(c.type || 'Original')}${c.type === 'Retificado' && c.originalClosingId ? `<button class="btn" style="padding:3px 8px;font-size:11px;margin-left:6px" onclick="openOriginalClosingModal('${esc(c.originalClosingId)}')">Ver original</button>` : ''}</td>
      <td>${tag(c.status)}</td>
      <td style="min-width:100px">${attHtml}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-sm" onclick="openRectifyModal('${esc(c.id)}')" title="Retificar fechamento">Retificar</button>
        <button class="btn btn-danger btn-sm" onclick="confirmDeleteClosing('${esc(c.id)}')" title="Excluir fechamento" style="margin-top:4px">Excluir</button>
      </td>
    </tr>`;
  }).join('') || emptyRow(15));

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

  /* Resumo por Fechamento */
  const allReceipts = getTransferReceipts();
  html('fechResumoBody', fechResumoFilteredClosings().map((c) =>
    buildResumoRow(c, allReceipts.find((r) => r.closingId === c.id), true)
  ).join('') || emptyRow(12));

  /* Divergências */
  const divRows = divergenceFilteredClosings();
  html('divergenceSummary',
    `<div class="kpi-alert"><strong>${divRows.length} divergência(s)</strong>
    <p class="subtle">Valor absoluto total: ${money(divRows.reduce((a,c)=>a+Math.abs(Number(c.diff||0)),0))}</p></div>`
  );
  html('divergencesBody', divRows.flatMap((c) => {
    const tolerance = Number(c.toleranceSnapshot ?? cfg(c.companyId).tolerance ?? 5);
    const fundDiv   = Number(c.fundDivergence ?? c.diff ?? 0);
    const openDiv   = Number(c.openingDivergence || 0);
    const items = [];
    if (Math.abs(fundDiv) > tolerance) {
      items.push({
        tipo: '<span style="background:#fee2e2;color:#991b1b;padding:1px 6px;border-radius:3px;font-size:11px">Fundo padrão</span>',
        esperado:   Number(c.standardFund || 0),
        encontrado: Number(c.cashBalance ?? c.finalAfterTransfer ?? 0),
        diferenca:  fundDiv,
      });
    }
    if (Math.abs(openDiv) > tolerance) {
      items.push({
        tipo: '<span style="background:#fef9c3;color:#854d0e;padding:1px 6px;border-radius:3px;font-size:11px">Abertura</span>',
        esperado:   Number(c.previousFinalAfterTransfer || 0),
        encontrado: Number(c.initial || 0),
        diferenca:  openDiv,
      });
    }
    return items.map((item) => {
      const col = item.diferenca < 0 ? 'var(--danger)' : 'var(--warning)';
      const sig = item.diferenca > 0 ? '+' : '';
      return `<tr>
        <td>${esc(companyName(c.companyId))}</td><td>${esc(storeName(c.storeId))}</td>
        <td>${esc(c.date)}</td><td>${esc(c.responsible || '-')}</td>
        <td>${item.tipo}</td>
        <td>${money(item.esperado)}</td>
        <td>${money(item.encontrado)}</td>
        <td style="color:${col};font-weight:600">${sig}${money(item.diferenca)}</td>
        <td>${tag(c.reviewStatus || 'Pendente de revisão')}</td>
      </tr>`;
    });
  }).join('') || emptyRow(9));
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

  /* Histórico de fechamentos (afech-historico) — resumo por fechamento */
  setOptions('adminMovementStoreFilter', stores.map((s) => [s.id, s.name]), 'Todas');
  const histClosings = adminMovFilteredClosings();
  html('adminMovementsDetailBody', [...histClosings].reverse().map((c) => {
    const salFinal = Number(c.cashBalance ?? c.finalAfterTransfer ?? 0);
    const div = Number(c.fundDivergence ?? c.diff ?? 0);
    return `<tr>
      <td>${esc(c.date)}</td>
      <td>${esc(storeName(c.storeId))}</td>
      <td>${esc(c.shift || 'Integral')}</td>
      <td>${esc(c.responsible || c.operator || '-')}</td>
      <td>${money(c.initial)}</td>
      <td>${money(c.entries)}</td>
      <td>${money(c.expenses)}</td>
      <td>${money(c.transfer)}</td>
      <td>${money(salFinal)}</td>
      <td style="color:${div !== 0 ? 'var(--danger)' : 'var(--success)'}">${money(div)}</td>
      <td>${tag(c.status)}</td>
    </tr>`;
  }).join('') || emptyRow(11));

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

  /* Resumo por Fechamento (amov-resumo) */
  setOptions('adminResumoStoreFilter', stores.map((s) => [s.id, s.name]), 'Todas');
  const resumoClos = adminResumoFilteredClosings();
  html('adminResumoBody', resumoClos.map((c) =>
    buildResumoRow(c, receipts.find((r) => r.closingId === c.id), false)
  ).join('') || emptyRow(11));

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
    const esperado  = Math.max(0, Number(c.expected ?? 0) - Number(c.standardFund ?? 0));
    const informado = Number(c.transfer || 0);
    const diff      = informado - esperado;
    const diffColor = diff === 0 ? 'var(--success)' : 'var(--danger)';
    const diffLabel = diff === 0 ? '0,00 R$' : (diff > 0 ? '+' : '') + money(diff);
    return `<tr>
      <td>${esc(c.date)}</td><td>${esc(storeName(c.storeId))}</td><td>${esc(c.responsible || c.operator || '-')}</td>
      <td>${money(c.initial)}</td>
      <td>${money(c.entries)}</td>
      <td>${money(c.expenses)}</td>
      <td>${money(esperado)}</td>
      <td>${money(informado)}</td>
      <td style="color:${diffColor};font-weight:600">${diffLabel}</td>
      <td>${tag(status)}</td>
      <td>${receipt ? new Date(receipt.confirmedAt).toLocaleString('pt-BR') : '-'}</td>
      <td>${esc(receipt?.confirmedBy || '-')}</td>
      <td>${status === 'Pendente'
        ? `<button class="btn btn-sm btn-primary" onclick="confirmTransferReceipt('${c.id}')">Recebido</button>`
        : '<span class="status success">✓</span>'
      }</td>
    </tr>`;
  }).filter(Boolean).join('') || emptyRow(13));

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
    const c       = state.closings.find((x) => x.id === r.closingId) || {};
    const isOpen  = (r.reviewStatus || 'Pendente') === 'Pendente';
    const isFundo = (r.divergenceType || '').toLowerCase().includes('fundo');
    const tipoBadge = isFundo
      ? `<span style="background:#fee2e2;color:#991b1b;padding:1px 6px;border-radius:3px;font-size:11px">Fundo padrão</span>`
      : `<span style="background:#fef9c3;color:#854d0e;padding:1px 6px;border-radius:3px;font-size:11px">Abertura</span>`;
    const esperado   = isFundo
      ? Number(c.standardFund || 0)
      : Number(c.previousFinalAfterTransfer || 0);
    const encontrado = isFundo
      ? Number(c.cashBalance ?? c.finalAfterTransfer ?? 0)
      : Number(c.initial || 0);
    const amount  = Number(r.divergenceAmount || 0);
    const col     = amount < 0 ? 'var(--danger)' : 'var(--warning)';
    const sig     = amount > 0 ? '+' : '';
    return `<tr>
      <td>${esc(c.date || '-')}</td><td>${esc(storeName(r.storeId))}</td><td>${esc(c.responsible || '-')}</td>
      <td>${tipoBadge}</td>
      <td>${money(esperado)}</td>
      <td>${money(encontrado)}</td>
      <td style="color:${col};font-weight:600">${sig}${money(amount)}</td>
      <td>${tag(r.reviewStatus || 'Pendente')}</td>
      <td>${isOpen
        ? `<button class="btn btn-sm" onclick="reviewDivergence('${r.id}','Revisada')">Revisada</button>
           <button class="btn btn-sm" onclick="reviewDivergence('${r.id}','Justificada')">Justificada</button>
           <button class="btn btn-sm" onclick="reviewDivergence('${r.id}','Resolvida')">Resolvida</button>`
        : `<span class="subtle">${esc(r.adminComment || '-')}</span>`
      }</td>
    </tr>`;
  }).join('') || emptyRow(9));

  /* Últimas movimentações (dashboard) */
  html('adminMovementsBody', rows.slice(-8).reverse().map((c) =>
    `<tr><td>${esc(c.date)}</td><td>${esc(storeName(c.storeId))}</td><td>${money(c.initial)}</td><td>${money(c.entries)}</td><td>${money(c.cashBalance ?? c.finalAfterTransfer ?? 0)}</td><td>${money(c.diff)}</td><td>${tag(c.status)}</td></tr>`
  ).join('') || emptyRow(7));

  /* Alerta de retificações pendentes */
  const pendingRects = (state.rectificationRequests || []).filter((r) =>
    r.companyId === currentUser?.companyId && r.status === 'Pendente'
  );
  const rectAlert = $('adminRectificationAlert');
  if (rectAlert) {
    rectAlert.style.display = pendingRects.length ? '' : 'none';
    rectAlert.textContent   = `${pendingRects.length} solicitação(ões) de retificação aguardando sua aprovação.`;
  }
  text('adminPendingRects', pendingRects.length);

  /* Tabela de retificações (sub-aba amov-retificacoes) */
  setOptions('adminRectStoreFilter', stores.map((s) => [s.id, s.name]), 'Todas');
  const rectStoreFilter  = val('adminRectStoreFilter') || '';
  const rectStatusFilter = val('adminRectStatusFilter') || 'Pendente';
  const allRects = (state.rectificationRequests || []).filter((r) =>
    r.companyId === currentUser?.companyId &&
    (!rectStoreFilter  || r.storeId === rectStoreFilter) &&
    (!rectStatusFilter || r.status === rectStatusFilter)
  );
  html('adminRectificationsBody', [...allRects].reverse().map((r) => {
    const isPending = r.status === 'Pendente';
    const diffRow = (label, orig, novo) => {
      const changed = orig !== novo;
      return `<div style="font-size:11px;${changed?'color:var(--warning);font-weight:600':''}">
        ${label}: ${money(orig)} → ${money(novo)}${changed?' ⚠':''}
      </div>`;
    };
    const repasseWarn = r.repasseChanged
      ? `<div style="font-size:11px;color:var(--danger);font-weight:600;margin-top:4px">⚠ Repasse alterado — confirme o valor com o operador</div>` : '';
    return `<tr>
      <td>${esc(r.closingDate)}</td>
      <td>${esc(storeName(r.storeId))}</td>
      <td>${esc(r.operatorName)}</td>
      <td>
        ${diffRow('Inicial',  r.originalInitial,  r.newInitial)}
        ${diffRow('Entradas', r.originalEntries,  r.newEntries)}
        ${diffRow('Saídas',   r.originalExpenses, r.newExpenses)}
        ${diffRow('Repasse',  r.originalTransfer, r.newTransfer)}
        ${repasseWarn}
      </td>
      <td style="max-width:180px;font-size:12px">${esc(r.justification)}</td>
      <td>${tag(r.status)}</td>
      <td>${isPending
        ? `<button class="btn btn-sm btn-primary" onclick="approveRectification('${r.id}')">Aprovar</button>
           <button class="btn btn-sm" style="margin-left:4px" onclick="rejectRectification('${r.id}')">Rejeitar</button>`
        : `<span class="subtle" style="font-size:11px">${esc(r.reviewedBy || '-')} ${r.reviewedAt ? '· ' + new Date(r.reviewedAt).toLocaleDateString('pt-BR') : ''}</span>${r.adminComment ? `<br><span style="font-size:11px">${esc(r.adminComment)}</span>` : ''}`
      }</td>
    </tr>`;
  }).join('') || emptyRow(7));
}

/* --- OPERADOR --- */
function renderOperatorViews() {
  const rows = operatorHistoryClosings(); /* respeita filtro de data */
  html('operatorHistoryBody', [...rows].reverse().map((c) => {
    const atts = c.attachments || [];
    const attHtml = atts.length
      ? atts.map((a) => a.path
          ? `<button class="btn btn-sm" style="font-size:11px;margin-right:4px" onclick="viewStorageFile('closing-attachments','${esc(a.path)}','${esc(a.name)}')" title="${esc(a.name)}">${esc(a.name)}</button>`
          : `<span style="font-size:11px">${esc(a.name)}</span>`
        ).join('')
      : '<span class="subtle" style="font-size:11px">—</span>';
    const req = (state.rectificationRequests || []).find((r) => r.closingId === c.id);
    let rectCell = '';
    if (req?.status === 'Pendente') {
      rectCell = '<span class="status warning" style="font-size:11px">Aguardando aprovação</span>';
    } else if (req?.status === 'Aprovada') {
      rectCell = '<span class="status success" style="font-size:11px">Aprovada</span>';
    } else if (req?.status === 'Rejeitada') {
      rectCell = `<span class="status danger" style="font-size:11px" title="${esc(req.adminComment)}">Rejeitada</span>`;
    } else if (c.type !== 'Retificado') {
      rectCell = `<button class="btn btn-sm" onclick="openOperatorRectifyModal('${esc(c.id)}')">Solicitar</button>`;
    }
    return `<tr>
      <td>${esc(c.date)}</td><td>${esc(storeName(c.storeId))}</td>
      <td>${money(c.entries)}</td><td>${money(c.expenses)}</td><td>${money(c.transfer)}</td>
      <td style="color:${Number(c.diff)<0?'var(--danger)':'var(--warning)'}">${money(c.diff)}</td>
      <td>${tag(c.type||'Original')}${c.type === 'Retificado' && c.originalClosingId ? `<button class="btn" style="padding:3px 8px;font-size:11px;margin-left:6px" onclick="openOriginalClosingModal('${esc(c.originalClosingId)}')">Ver original</button>` : ''}</td>
      <td>${tag(c.status)}</td>
      <td>${rectCell}</td>
      <td>${attHtml}</td>
    </tr>`;
  }).join('') || emptyRow(10));

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
      ${d.path ? `<button class="btn btn-sm" style="white-space:nowrap" onclick="viewStorageFile('store-documents','${esc(d.path)}','${esc(d.name)}')">Ver</button>` : ''}
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
