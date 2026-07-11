'use strict';
/* ============================================================
   FECHAMENTO 5X — Lógica oficial de cálculo e persistência

   FÓRMULAS OFICIAIS (imutáveis):
     cashBeforeTransfer  = initialCash + entries - expenses
     finalAfterTransfer  = cashBeforeTransfer - transfer
     fundDivergence      = finalAfterTransfer - standardFund
     status              = OK se |fundDivergence| <= tolerância, senão Divergência
============================================================ */

let closingAttachments = [];

/* ================================================================
   HELPERS DE SELEÇÃO
================================================================ */
function selectedStore() {
  const stores = visibleStores();
  const selectedId = val('closingStore');
  const store = stores.find((s) => s.id === selectedId) || stores[0] || null;
  if (store && !selectedId) setVal('closingStore', store.id);
  return store;
}

function safeMoneyNumber(value) {
  const parsed = typeof value === 'string' ? parseCurrencyBR(value) : Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

const SHIFT_ORDER = { 'Manhã': 1, 'Tarde': 2, 'Noite': 3, 'Integral': 4, 'Outro': 5 };
function selectedShift()     { return val('closingShift') || 'Integral'; }
function shiftRank(shift)    { return SHIFT_ORDER[shift] || 99; }
function closingSortValue(c) {
  return `${parseBR(c.date)}-${String(shiftRank(c.shift || 'Integral')).padStart(2,'0')}-${c.createdAt || ''}`;
}

function findPreviousClosing(storeId, dateISO, shift) {
  const rank = shiftRank(shift);
  return [...(state.closings || [])]
    .filter((c) => {
      const d = parseBR(c.date), r = shiftRank(c.shift || 'Integral');
      return c.storeId === storeId &&
        (c.type === 'Original' || c.type === 'Retificado' || !c.type) &&
        (d < dateISO || (d === dateISO && r < rank));
    })
    .sort((a, b) => closingSortValue(b).localeCompare(closingSortValue(a)))[0] || null;
}

function findOpeningAdjustment(storeId, dateISO, shift) {
  return [...(state.cashOpeningAdjustments || [])]
    .filter((a) =>
      a.storeId === storeId &&
      parseBR(a.startDate) <= dateISO &&
      (!a.shift || a.shift === shift || a.shift === 'Integral')
    )
    .sort((a, b) =>
      `${parseBR(b.startDate)}-${shiftRank(b.shift||'Integral')}-${b.createdAt||''}`
        .localeCompare(`${parseBR(a.startDate)}-${shiftRank(a.shift||'Integral')}-${a.createdAt||''}`)
    )[0] || null;
}

function openingReference() {
  const store   = selectedStore();
  const dateISO = parseBR(val('closingDate'));
  const shift   = selectedShift();
  if (!store || !dateISO) return { previous: null, adjustment: null, amount: 0, origin: 'Caixa inicial' };

  const previous = findPreviousClosing(store.id, dateISO, shift);
  if (previous) return {
    previous, adjustment: null,
    amount: Number(previous.finalAfterTransfer ?? previous.cashBalance ?? 0),
    origin: `${previous.date} / ${previous.shift || 'Integral'} / ${previous.responsible || storeName(previous.storeId)}`,
  };

  const adjustment = findOpeningAdjustment(store.id, dateISO, shift);
  if (adjustment) return {
    previous: null, adjustment,
    amount: Number(adjustment.amount || 0),
    origin: `Saldo inicial autorizado em ${toBRFromISO(parseBR(adjustment.startDate))} / ${adjustment.shift || 'Integral'}`,
  };

  return { previous: null, adjustment: null, amount: 0, origin: 'Caixa inicial' };
}

/* Lê totais das linhas de lançamento */
function totalEntries()  { return all('.entry').reduce((s, e)  => s + parseCurrencyBR(e.value), 0); }
function totalExpenses() { return all('.expense').reduce((s, e) => s + parseCurrencyBR(e.value), 0); }


/* ================================================================
   FUNÇÃO CENTRAL DE CÁLCULO — única fonte de verdade
   Alimenta: tela, save, histórico, relatórios, divergências.
   FÓRMULAS OFICIAIS (imutáveis):
     cashBeforeTransfer  = initialCash + entries - expenses
     finalAfterTransfer  = cashBeforeTransfer - transfer
     fundDivergence      = finalAfterTransfer - standardFund
     status              = OK se |div| <= tolerância, senão Divergência
================================================================ */
function getClosingCalculation() {
  const store = selectedStore();
  const cfgC  = cfg(store?.companyId);

  const initialCash        = safeMoneyNumber(num('initial'));
  const entriesTotal       = safeMoneyNumber(totalEntries());
  const expensesTotal      = safeMoneyNumber(totalExpenses());
  const cashBeforeTransfer = initialCash + entriesTotal - expensesTotal;
  const transferAmount     = safeMoneyNumber(num('transfer'));
  const finalAT            = cashBeforeTransfer - transferAmount;
  const standardFund       = safeMoneyNumber(store?.standardFund);
  const fundDivergence     = finalAT - standardFund;
  const tolerance          = safeMoneyNumber(cfgC?.tolerance ?? 5);
  const transferTolerance  = safeMoneyNumber(cfgC?.transferTolerance ?? 0);

  /* Status oficial: OK se divergência dentro da tolerância de caixa, OU se o
     excesso positivo for ≤ tolerância de repasse (valor intencionalmente mantido) */
  const status = Math.abs(fundDivergence) <= tolerance
    || (fundDivergence > 0 && transferTolerance > 0 && fundDivergence <= transferTolerance)
    ? 'OK' : 'Divergência';

  const openRef    = openingReference();
  const openingDiv = initialCash - Number(openRef.amount || 0);

  return {
    store, cfgC,
    initialCash,
    entriesTotal,
    expensesTotal,
    cashBeforeTransfer,
    transferAmount,
    finalAfterTransfer: finalAT,
    standardFund,
    fundDivergence,
    tolerance,
    transferTolerance,
    status,
    openingDivergence: openingDiv,
    openingRef: openRef,
    suggestedTransfer: Math.max(0, cashBeforeTransfer - standardFund),
  };
}

/* Manter aliases para compatibilidade com relatórios/render */
function expectedCash()       { return getClosingCalculation().cashBeforeTransfer; }
function finalAfterTransfer() { return getClosingCalculation().finalAfterTransfer; }
function fundDivergence()     { return getClosingCalculation().fundDivergence; }
function suggestedTransfer()  { return getClosingCalculation().suggestedTransfer; }
function openingDivergence()  { return getClosingCalculation().openingDivergence; }

function closingStatus(diff, companyId) {
  const c = cfg(companyId);
  const tolerance         = Math.abs(safeMoneyNumber(c.tolerance));
  const transferTolerance = safeMoneyNumber(c.transferTolerance ?? 0);
  return Math.abs(diff) <= tolerance
    || (diff > 0 && transferTolerance > 0 && diff <= transferTolerance)
    ? 'OK' : 'Divergência';
}

/* ================================================================
   SUGESTÃO DE SALDO INICIAL
================================================================ */
function suggestInitialBalance() {
  const store   = selectedStore();
  const dateInput = $('closingDate');
  if (dateInput && !dateInput.value) dateInput.value = todayISO();
  const dateISO = parseBR(val('closingDate'));
  if (!store || !dateISO) return;
  const ref = openingReference();
  setVal('initial', formatCurrencyBR(ref.amount || 0));
  const hint = $('initialBalanceHint');
  if (hint) {
    hint.textContent = (ref.previous || ref.adjustment)
      ? `Sugerido: ${ref.origin}.`
      : 'Sem fechamento anterior — caixa inicial.';
    hint.style.display = '';
  }
  calc();
}

function useSuggestedTransfer() {
  setVal('transfer', formatCurrencyBR(suggestedTransfer()));
  calc();
}

function bindClosingEvents() {
  if (window.__closingEventsBound) return;
  window.__closingEventsBound = true;

  document.addEventListener('input', (e) => {
    if (!e.target.closest('#closing')) return;
    if (e.target.matches('#initial,#transfer,.entry,.expense,.entry-desc,.expense-desc')) calc();
  });

  document.addEventListener('change', (e) => {
    if (!e.target.closest('#closing')) return;
    if (e.target.matches('#closingStore')) {
      fillClosingResponsible5X();
      suggestInitialBalance();
      refreshExpenseOptionLists();
      refreshEntryOptionLists();
      calc();
      return;
    }
    if (e.target.matches('#closingDate,#closingShift')) {
      suggestInitialBalance();
      calc();
      return;
    }
    if (e.target.matches('#closingResponsible,.expense-category,.entry-category')) calc();
  });

}


/* ================================================================
   CÁLCULO EM TEMPO REAL
================================================================ */
function calc() {
  ensureExpenseCategories();
  ensureEntryCategories();

  const cc  = getClosingCalculation();
  const ref = cc.openingRef;

  /* Conferência de abertura */
  text('previousFinalAfterTransferView', money(ref.amount || 0));
  text('openingInitialView',    money(cc.initialCash));
  text('openingDivergenceView', money(cc.openingDivergence));
  text('openingOriginView',     ref.origin || 'Caixa inicial');
  const openAlert = $('openingDivergenceAlert');
  if (openAlert) {
    const abs = Math.abs(cc.openingDivergence);
    openAlert.style.display = abs > 0 ? '' : 'none';
    openAlert.className     = 'kpi-alert warning operator-hidden';
    openAlert.textContent   = `Divergência de abertura: ${money(cc.openingDivergence)}. Saldo informado difere do saldo autorizado.`;
  }

  /* Bloco 1 — Saldo em caixa (passo a passo) */
  text('totalEntries',    money(cc.entriesTotal));
  text('totalExpenses',   money(cc.expensesTotal));
  text('expectedCash',    money(cc.cashBeforeTransfer));

  /* Bloco 2 — Repasse */
  text('suggestedTransferView', money(cc.suggestedTransfer));
  text('cashBalance',           money(cc.finalAfterTransfer));

  /* Bloco 3 — Resultado */
  text('standardFundView',  money(cc.standardFund));
  text('fundDivergenceView',money(cc.fundDivergence));

  const statusEl = $('closingStatusView');
  if (statusEl) {
    const cls = cc.status === 'OK' ? 'success' : 'warning';
    statusEl.className   = `status ${cls}`;
    statusEl.textContent = cc.status;
  }

  /* Leitura automática */
  const divMsg = cc.status === 'OK'
    ? `✓ Status: OK. Tolerância: ${money(cc.tolerance)}.`
    : `◎ Status: Divergência. Diferença: ${money(cc.fundDivergence)}. Tolerância: ${money(cc.tolerance)}.`;

  const openMsg = Math.abs(cc.openingDivergence) <= cc.tolerance
    ? `Abertura: OK (${money(cc.openingDivergence)}).`
    : `Divergência de abertura: ${money(cc.openingDivergence)}.`;

  text('closingInsight',
    `${openMsg}\n${divMsg}\n` +
    `Fórmula: ${money(cc.initialCash)} + ${money(cc.entriesTotal)} − ${money(cc.expensesTotal)} = ` +
    `${money(cc.cashBeforeTransfer)} (caixa) − ${money(cc.transferAmount)} (repasse) = ` +
    `${money(cc.finalAfterTransfer)} (saldo final). Fundo: ${money(cc.standardFund)}. Dif: ${money(cc.fundDivergence)}.`
  );

}

/* ================================================================
   LINHAS DINÂMICAS — entradas e saídas
================================================================ */
const MONEY_ATTRS = `type="text" inputmode="decimal" pattern="[0-9.,]*" value="0"
  onblur="formatCurrencyInput(this)" onfocus="selectOnFocus(this)"`;

function addEntry() {
  const companyId = selectedStore()?.companyId;
  const catOpts = optionsForCompany(companyId, 'entryCategories').map((v) => `<option>${esc(v)}</option>`).join('');
  const cliOpts = optionsForCompany(companyId, 'clientes').map((v) => `<option>${esc(v)}</option>`).join('');
  $('entries')?.insertAdjacentHTML('beforeend', `
    <div class="launch-row entry-row">
      <div class="field"><label>Descrição</label><input class="entry-desc" value="Entrada em Dinheiro"/></div>
      <div class="field"><label>Categoria</label><select class="entry-category">${catOpts}</select></div>
      <div class="field"><label>Cliente</label><select class="entry-client"><option value="">Selecione</option>${cliOpts}</select></div>
      <div class="field"><label>Valor (R$)</label>
        <input class="entry" ${MONEY_ATTRS} oninput="calc()"/>
      </div>
      <button class="btn btn-icon" onclick="removeLaunchRow(this)" title="Remover">×</button>
    </div>`);
  bindCurrencyInputs($('entries'));
  calc();
}

function addExpense() {
  const companyId = selectedStore()?.companyId;
  const catOpts = optionsForCompany(companyId, 'expenseCategories').map((v) => `<option>${esc(v)}</option>`).join('');
  const supOpts = optionsForCompany(companyId, 'fornecedores').map((v) => `<option>${esc(v)}</option>`).join('');
  $('expenses')?.insertAdjacentHTML('beforeend', `
    <div class="launch-row expense-row">
      <div class="field"><label>Descrição da saída</label><input class="expense-desc" placeholder="Ex: ajuda de custo motoboy"/></div>
      <div class="field"><label>Categoria</label><select class="expense-category">${catOpts}</select></div>
      <div class="field"><label>Fornecedor</label><select class="expense-supplier"><option value="">Selecione</option>${supOpts}</select></div>
      <div class="field"><label>Valor (R$)</label>
        <input class="expense" ${MONEY_ATTRS} oninput="calc()"/>
      </div>
      <button class="btn btn-icon" onclick="removeLaunchRow(this)" title="Remover">×</button>
    </div>`);
  bindCurrencyInputs($('expenses'));
  calc();
}

function removeLaunchRow(btn) { btn.closest('.launch-row')?.remove(); calc(); }

function ensureExpenseCategories(root = document) {
  const companyId = selectedStore()?.companyId;
  all('#expenses .launch-row', root).forEach((row) => {
    if (row.querySelector('.expense-category')) return;
    const vf      = row.querySelector('.expense')?.closest('.field');
    const catOpts = optionsForCompany(companyId, 'expenseCategories').map((v) => `<option>${esc(v)}</option>`).join('');
    const supOpts = optionsForCompany(companyId, 'fornecedores').map((v) => `<option>${esc(v)}</option>`).join('');
    vf?.insertAdjacentHTML('beforebegin',
      `<div class="field"><label>Categoria</label><select class="expense-category">${catOpts}</select></div>` +
      `<div class="field"><label>Fornecedor</label><select class="expense-supplier"><option value="">Selecione</option>${supOpts}</select></div>`);
  });
}

/* Repopula as opções de Categoria/Fornecedor de todas as linhas de saída existentes
   conforme a empresa da loja selecionada (chamado ao trocar a loja do fechamento). */
function refreshExpenseOptionLists() {
  const companyId = selectedStore()?.companyId;
  const catOpts = optionsForCompany(companyId, 'expenseCategories');
  const supOpts = optionsForCompany(companyId, 'fornecedores');
  all('#expenses .launch-row').forEach((row) => {
    const catSel = row.querySelector('.expense-category');
    if (catSel) {
      const cur = catSel.value;
      catSel.innerHTML = catOpts.map((v) => `<option>${esc(v)}</option>`).join('');
      if (catOpts.includes(cur)) catSel.value = cur;
    }
    const supSel = row.querySelector('.expense-supplier');
    if (supSel) {
      const cur = supSel.value;
      supSel.innerHTML = `<option value="">Selecione</option>${supOpts.map((v) => `<option>${esc(v)}</option>`).join('')}`;
      if (supOpts.includes(cur)) supSel.value = cur;
    }
  });
}

function ensureEntryCategories(root = document) {
  const companyId = selectedStore()?.companyId;
  all('#entries .launch-row', root).forEach((row) => {
    if (row.querySelector('.entry-category')) return;
    const vf      = row.querySelector('.entry')?.closest('.field');
    const catOpts = optionsForCompany(companyId, 'entryCategories').map((v) => `<option>${esc(v)}</option>`).join('');
    const cliOpts = optionsForCompany(companyId, 'clientes').map((v) => `<option>${esc(v)}</option>`).join('');
    vf?.insertAdjacentHTML('beforebegin',
      `<div class="field"><label>Categoria</label><select class="entry-category">${catOpts}</select></div>` +
      `<div class="field"><label>Cliente</label><select class="entry-client"><option value="">Selecione</option>${cliOpts}</select></div>`);
  });
}

/* Repopula as opções de Categoria/Cliente de todas as linhas de entrada existentes
   conforme a empresa da loja selecionada (chamado ao trocar a loja do fechamento). */
function refreshEntryOptionLists() {
  const companyId = selectedStore()?.companyId;
  const catOpts = optionsForCompany(companyId, 'entryCategories');
  const cliOpts = optionsForCompany(companyId, 'clientes');
  all('#entries .launch-row').forEach((row) => {
    const catSel = row.querySelector('.entry-category');
    if (catSel) {
      const cur = catSel.value;
      catSel.innerHTML = catOpts.map((v) => `<option>${esc(v)}</option>`).join('');
      if (catOpts.includes(cur)) catSel.value = cur;
    }
    const cliSel = row.querySelector('.entry-client');
    if (cliSel) {
      const cur = cliSel.value;
      cliSel.innerHTML = `<option value="">Selecione</option>${cliOpts.map((v) => `<option>${esc(v)}</option>`).join('')}`;
      if (cliOpts.includes(cur)) cliSel.value = cur;
    }
  });
}

/* ================================================================
   DIVERGENCE REVIEWS — criação em state local
================================================================ */
function createDivergenceReviews(closing) {
  const tol         = Math.abs(Number(closing.toleranceSnapshot || cfg(closing.companyId).tolerance || 0));
  const transferTol = Number(cfg(closing.companyId)?.transferTolerance || 0);
  const fundDiv     = Number(closing.fundDivergence ?? closing.diff ?? 0);
  const items = [
    ['Divergência de abertura',         closing.openingDivergence],
    ['Divergência contra fundo padrão', fundDiv],
  ].filter(([type, v]) => {
    const abs = Math.abs(Number(v || 0));
    if (abs <= tol) return false;
    if (type === 'Divergência contra fundo padrão' && Number(v) > 0 && transferTol > 0 && Number(v) <= transferTol) return false;
    return true;
  });
  state.divergenceReviews = state.divergenceReviews || [];
  items.forEach(([type, amount]) => {
    state.divergenceReviews.push({
      id: uid('drv'),
      closingId: closing.id, companyId: closing.companyId, storeId: closing.storeId,
      divergenceType: type, divergenceAmount: Number(amount || 0),
      reviewStatus: 'Pendente', adminComment: '', reviewedBy: '', reviewedAt: '',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
  });
}

/* ================================================================
   SALDO INICIAL AUTORIZADO (admin)
================================================================ */
async function saveOpeningAdjustment() {
  const storeId = val('openingAdjustmentStore');
  const store   = state.stores.find((s) => s.id === storeId);
  if (!store)                                                          return alert('Selecione a loja para o saldo inicial autorizado.');
  if (role === 'operator')                                             return alert('Operador não pode definir saldo inicial autorizado.');
  if (role === 'admin' && store.companyId !== currentUser?.companyId) return alert('Esta loja não pertence ao seu acesso.');
  if ((state.closings || []).some((c) => c.storeId === storeId) &&
    !confirm('Já existe histórico para esta loja. Registrar ajuste assim mesmo?')) return;

  const amount = parseCurrencyBR(val('openingAdjustmentAmount'));
  const reason = val('openingAdjustmentReason');
  if (!reason) return alert('Informe o motivo do saldo inicial autorizado.');

  state.cashOpeningAdjustments = state.cashOpeningAdjustments || [];
  const adj = {
    id: uid('coa'), companyId: store.companyId, storeId,
    authorizedBy: currentUser?.id || currentUser?.name || 'master',
    startDate: val('openingAdjustmentDate') || todayISO(),
    shift: val('openingAdjustmentShift') || 'Integral',
    amount, reason, notes: val('openingAdjustmentNotes'),
    createdAt: new Date().toISOString(),
  };

  if (sb && !USE_LOCAL_FALLBACK && currentUser?.authId) {
    try {
      const row = await createCashOpeningAdjustment(adj);
      if (row?.id) adj.id = row.id;
    } catch (e) { return alert(`Erro ao salvar ajuste: ${e.message}`); }
  } else if (!DEV_LOCAL_MODE) {
    return alert('Supabase obrigatório em produção para salvar ajuste.');
  }

  state.cashOpeningAdjustments.push(adj);
  addAudit('Saldo inicial autorizado', `${companyName(store.companyId)} / ${store.name} - ${money(amount)}`);
  ['openingAdjustmentAmount','openingAdjustmentNotes'].forEach((id) => setVal(id, ''));
  save(); renderAll();
  alert('Saldo inicial autorizado registrado.');
}

/* ================================================================
   REVISÃO DE DIVERGÊNCIAS (admin)
================================================================ */
async function reviewDivergence(id, status) {
  const review = (state.divergenceReviews || []).find((r) => r.id === id);
  if (!review) return;
  if (role === 'operator')                                              return alert('Operador não pode revisar divergências.');
  if (role === 'admin' && review.companyId !== currentUser?.companyId) return alert('Esta divergência não pertence ao seu acesso.');
  const comment = prompt(`Parecer para marcar como "${status}":`);
  if (!comment?.trim()) return alert('A revisão exige parecer/comentário.');

  const updated = {
    ...review, reviewStatus: status, adminComment: comment.trim(),
    reviewedBy: currentUser?.name || 'Master',
    reviewedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };

  if (sb && !USE_LOCAL_FALLBACK && currentUser?.authId) {
    try { await updateDivergenceReview(review.id, updated); }
    catch (e) { return alert(`Erro ao revisar: ${e.message}`); }
  } else if (!DEV_LOCAL_MODE) {
    return alert('Supabase obrigatório em produção.');
  }

  Object.assign(review, updated);
  addAudit('Revisão de divergência', `${storeName(review.storeId)} / ${review.divergenceType} / ${status}`);
  save(); renderAll();
}

/* ================================================================
   CONFIRMAR REPASSE (botão auxiliar visual)
================================================================ */
function confirmTransfer() {
  const cc = getClosingCalculation();
  if (!cc.store)         return alert('Selecione uma loja primeiro.');
  if (cc.transferAmount < 0) return alert('O valor do repasse não pode ser negativo.');
  if (cc.transferAmount > cc.cashBeforeTransfer + 0.01) {
    if (!confirm(
      `O repasse (${money(cc.transferAmount)}) é maior que o saldo em caixa (${money(cc.cashBeforeTransfer)}).\n` +
      'Deseja confirmar assim mesmo?'
    )) return;
  }
  const badge = $('transferConfirmedBadge');
  if (badge) badge.style.display = '';
  const btn = $('confirmTransferBtn');
  if (btn) btn.textContent = '✓ Confirmado';
  calc();
}

/* ================================================================
   SALVAR FECHAMENTO
================================================================ */
async function handleSaveClosingClick(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const btn = $('saveClosingBtn');
  const originalText = btn ? btn.textContent : '✓ Realizar fechamento';

  try {
    console.log('[Fechamento] Clique em Realizar fechamento');

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Salvando...';
    }

    await saveClosing();
  } catch (e) {
    console.error('[Fechamento] Erro inesperado ao salvar:', e);
    alert('Erro inesperado ao realizar fechamento: ' + (e.message || e));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
}

async function saveClosing() {
  console.log('[saveClosing] Iniciando salvamento');
  const cc    = getClosingCalculation();
  console.log('[saveClosing] Cálculo:', cc);
  const store = cc.store;

  if (!store) return alert('Selecione uma loja cadastrada.');
  if (role === 'operator' && currentUser?.storeId && store.id !== currentUser.storeId)
    return alert('Este operador só pode lançar fechamento da loja vinculada.');
  if (role === 'admin' && store.companyId !== currentUser?.companyId)
    return alert('Esta loja não pertence ao seu acesso.');

  const closingDate = todayISO();
  const dateInput = $('closingDate');
  if (dateInput) dateInput.value = closingDate;
  const dateISO     = parseBR(closingDate);
  if (!dateISO) return alert('Data de fechamento inválida.');

  const shift       = selectedShift();
  const responsible = val('closingResponsible') || currentUser?.name || '';
  if (!responsible) {
    console.warn('[saveClosing] Responsável vazio', { closingResponsible: val('closingResponsible'), currentUser });
    return alert('Selecione o responsável pelo fechamento ou verifique o usuário logado.');
  }

  /* Validar entradas/saídas */
  const entryRows   = all('#entries .launch-row');
  const expenseRows = all('#expenses .launch-row');
  for (const row of entryRows) {
    const v = parseCurrencyBR(row.querySelector('.entry')?.value || '0');
    const d = row.querySelector('.entry-desc')?.value?.trim();
    if (v > 0 && !d) return alert('Toda entrada com valor precisa de descrição.');
    if (v < 0)       return alert('Valor de entrada não pode ser negativo.');
  }
  for (const row of expenseRows) {
    const v = parseCurrencyBR(row.querySelector('.expense')?.value || '0');
    const d = row.querySelector('.expense-desc')?.value?.trim();
    if (v > 0 && !d) return alert('Toda saída com valor precisa de descrição.');
    if (v < 0)       return alert('Valor de saída não pode ser negativo.');
  }

  /* Verificar duplicata */
  let existing = null;
  try {
    existing = await checkDuplicateClosing({ storeId: store.id, closingDate, shift });
  } catch (_) {
    existing = state.closings.find((c) =>
      c.storeId === store.id && parseBR(c.date) === dateISO &&
      (c.shift || 'Integral') === shift && (c.type === 'Original' || !c.type)
    );
  }

  let closingType = 'Original', originalClosingId = null;
  if (existing) {
    if (!confirm(
      `Já existe fechamento Original para "${store.name}" em ${toBRFromISO(dateISO)}.\n\n` +
      'Deseja registrar uma RETIFICAÇÃO? (Original será preservado.)\n\nOK = Retificar | Cancelar = Não salvar.'
    )) return;
    closingType = 'Retificado'; originalClosingId = existing.id;
  }

  /* Montar itens */
  const entries = entryRows
    .map((row) => ({
      description: row.querySelector('.entry-desc')?.value?.trim() || 'Entrada em Dinheiro',
      category:    row.querySelector('.entry-category')?.value || '',
      client:      row.querySelector('.entry-client')?.value || '',
      value: parseCurrencyBR(row.querySelector('.entry')?.value || '0'),
    })).filter((x) => x.value > 0);

  const expenses = expenseRows
    .map((row) => ({
      description: row.querySelector('.expense-desc')?.value?.trim() || 'Saída',
      category:    row.querySelector('.expense-category')?.value || '',
      supplier:    row.querySelector('.expense-supplier')?.value || '',
      value: parseCurrencyBR(row.querySelector('.expense')?.value || '0'),
    })).filter((x) => x.value > 0);

  const openRef = cc.openingRef;
  const attachmentUploadQueue = closingAttachments.slice();
  const attachmentMetadata = attachmentUploadQueue.map((f) => ({
    name: f.name,
    size: f.size,
    type: f.type,
    lastModified: f.lastModified,
    url: f.url || '',
  }));

  /* Objeto do fechamento — usa cc como fonte única */
  const closing = {
    id:                         uid('cl'),
    companyId:                  store.companyId,
    storeId:                    store.id,
    date:                       toBRFromISO(dateISO),
    shift, responsible,
    operator:                   currentUser?.name || '',
    initial:                    cc.initialCash,
    entries:                    cc.entriesTotal,
    entryItems:                 entries,
    expenses:                   cc.expensesTotal,
    expenseItems:               expenses,
    transfer:                   cc.transferAmount,
    expected:                   cc.cashBeforeTransfer,
    finalAfterTransfer:         cc.finalAfterTransfer,
    cashBalance:                cc.finalAfterTransfer,
    standardFund:               cc.standardFund,
    toleranceSnapshot:          cc.tolerance,
    previousClosingId:          openRef.previous?.id || null,
    previousFinalAfterTransfer: Number(openRef.amount || 0),
    openingDivergence:          cc.openingDivergence,
    openingReferenceOrigin:     openRef.origin,
    openingAdjustmentId:        openRef.adjustment?.id || null,
    diff:                       cc.fundDivergence,
    fundDivergence:             cc.fundDivergence,
    balance:                    cc.fundDivergence,
    notes:                      val('closingNotes'),
    attachments:                attachmentMetadata,
    reviewStatus:               cc.status !== 'OK' ? 'Pendente de revisão' : 'Sem divergência',
    status:                     cc.status,
    type:                       closingType, originalClosingId,
    createdAt:                  new Date().toISOString(),
  };

  state.closings.push(closing);
  createDivergenceReviews(closing);

  if (sb && !USE_LOCAL_FALLBACK && currentUser?.authId) {
    try {
      closing.attachments = attachmentUploadQueue;
      console.log('[saveClosing] Persistindo fechamento:', closing);
      await createClosing(closing);
      console.log('[saveClosing] Fechamento persistido com sucesso:', closing.id);
    } catch (e) {
      console.error('[saveClosing] Falha Supabase:', e);
      state.closings = state.closings.filter((x) => x.id !== closing.id);
      state.divergenceReviews = (state.divergenceReviews || []).filter((r) => r.closingId !== closing.id);
      renderAll();
      return alert(`Não foi possível salvar.\nErro: ${e.message || 'desconhecido'}\nConsulte F12 → Console.`);
    }
  } else if (!DEV_LOCAL_MODE) {
    state.closings = state.closings.filter((x) => x.id !== closing.id);
    state.divergenceReviews = (state.divergenceReviews || []).filter((r) => r.closingId !== closing.id);
    renderAll();
    return alert('Supabase + sessão ativa são obrigatórios em produção. Faça login novamente.');
  }

  addAudit(
    closingType === 'Retificado' ? 'Retificação de fechamento' : 'Fechamento salvo',
    `${companyName(store.companyId)} / ${store.name} — ${toBRFromISO(dateISO)}`
  );

  /* Limpar formulário */
  closingAttachments = [];
  clearAttachmentsUI();
  ['initial','transfer','closingNotes'].forEach((id) =>
    setVal(id, id === 'closingNotes' ? '' : formatCurrencyBR(0))
  );
  all('.entry').forEach((e)      => { e.value = formatCurrencyBR(0); });
  all('.expense').forEach((e)    => { e.value = formatCurrencyBR(0); });
  const hint = $('initialBalanceHint');
  if (hint) hint.style.display = 'none';
  const badge = $('transferConfirmedBadge');
  if (badge) badge.style.display = 'none';
  const cBtn = $('confirmTransferBtn');
  if (cBtn) cBtn.textContent = 'Confirmar repasse';

  save();
  renderAll();
  alert(`Fechamento ${closingType === 'Retificado' ? 'retificado' : 'salvo'} com sucesso!`);
}

/* ================================================================
   ANEXOS
================================================================ */
const ALLOWED_ATTACHMENT_MIME = ['image/jpeg', 'image/png', 'application/pdf'];
const ALLOWED_ATTACHMENT_EXT  = /\.(jpe?g|png|pdf)$/i;
const MAX_ATTACHMENT_BYTES    = 10 * 1024 * 1024; // 10 MB

function handleAttachments(files) {
  const rejected = [];
  const valid = [...files].filter((f) => {
    const typeOk = ALLOWED_ATTACHMENT_MIME.includes(f.type) || ALLOWED_ATTACHMENT_EXT.test(f.name);
    if (!typeOk) { rejected.push(`"${f.name}": tipo não permitido. Use JPG, PNG ou PDF.`); return false; }
    if (f.size > MAX_ATTACHMENT_BYTES) { rejected.push(`"${f.name}": arquivo muito grande (máx. 10 MB).`); return false; }
    return true;
  });
  if (rejected.length) {
    if (window.toast) rejected.forEach((msg) => toast(msg, 'error', 5000));
    else alert(rejected.join('\n'));
  }
  closingAttachments.push(...valid.map((f) => ({
    name: f.name, size: f.size, type: f.type, lastModified: f.lastModified, file: f,
  })));
  renderAttachments();
}

function renderAttachments() {
  html('attachmentList', closingAttachments.length
    ? closingAttachments.map((f) =>
        `<div class="attachment-item">${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)}</a>` : esc(f.name)} <span class="subtle">${Math.round((f.size || 0)/1024)} KB</span></div>`
      ).join('')
    : '<span class="subtle">Nenhum anexo selecionado.</span>'
  );
}

function clearAttachmentsUI() {
  const a = $('closingAttachments'), cam = $('closingCamera');
  if (a)   a.value = '';
  if (cam) cam.value = '';
  renderAttachments();
}

/* ================================================================
   EXCLUIR FECHAMENTO — soft delete exclusivo para Gestão 5X
================================================================ */
async function confirmDeleteClosing(id) {
  if (role !== 'master') return alert('Apenas Gestão 5X pode excluir fechamentos.');
  const closing = (state.closings || []).find((c) => c.id === id);
  if (!closing) return alert('Fechamento não encontrado.');
  const motivo = prompt(
    `Confirme a exclusão do fechamento de "${storeName(closing.storeId)}" em ${closing.date}.\n\nInforme o motivo da exclusão:`
  );
  if (!motivo?.trim()) return alert('O motivo é obrigatório para excluir um fechamento.');

  if (sb && !USE_LOCAL_FALLBACK && currentUser?.authId) {
    try {
      await softDeleteClosing(id);
    } catch (e) { return alert(`Erro ao excluir: ${e.message}`); }
  } else if (!DEV_LOCAL_MODE) {
    return alert('Supabase obrigatório em produção.');
  }

  closing.type = 'Excluído';
  addAudit('Exclusão de fechamento', `${storeName(closing.storeId)} / ${closing.date} — Motivo: ${motivo.trim()} — Valor anterior: ${money(closing.fundDivergence ?? closing.diff)}`);
  save(); renderAll();
  alert('Fechamento excluído (inativado). O registro foi preservado no banco de dados com rastreabilidade.');
}

/* ================================================================
   RETIFICAR FECHAMENTO — cria novo registro Retificado (Gestão 5X)
================================================================ */
let _rectifyTargetId = null;

/* Segue a cadeia de retificações até a versão ativa mais recente.
   Evita criar um "irmão" duplicado quando o botão Retificar é
   acionado sobre uma versão que já foi substituída (ex.: aba/estado
   desatualizado). */
function findActiveClosingVersion(id) {
  let current = (state.closings || []).find((c) => c.id === id);
  if (!current) return null;
  let next = (state.closings || []).find((c) => c.type === 'Retificado' && c.originalClosingId === current.id);
  while (next) {
    current = next;
    next = (state.closings || []).find((c) => c.type === 'Retificado' && c.originalClosingId === current.id);
  }
  return current;
}

function openRectifyModal(id) {
  if (role !== 'master') return alert('Apenas Gestão 5X pode retificar fechamentos.');
  const closing = findActiveClosingVersion(id);
  if (!closing) return alert('Fechamento não encontrado.');
  _rectifyTargetId = closing.id;
  const modal = $('rectifyClosingModal');
  const body  = $('rectifyModalBody');
  if (body) {
    body.innerHTML = `<table class="table"><tbody>
      <tr><th>Loja</th><td>${esc(storeName(closing.storeId))}</td></tr>
      <tr><th>Data</th><td>${esc(closing.date)}</td></tr>
      <tr><th>Turno</th><td>${esc(closing.shift || 'Integral')}</td></tr>
      <tr><th>Responsável</th><td>${esc(closing.responsible)}</td></tr>
      <tr><th>Status atual</th><td>${tag(closing.status)} — Divergência: ${money(closing.fundDivergence ?? closing.diff)}</td></tr>
      ${closing.notes ? `<tr><th>Obs. original</th><td>${esc(closing.notes)}</td></tr>` : ''}
    </tbody></table>
    <div class="form-grid" style="margin-top:12px">
      <div class="field"><label>Saldo inicial (R$)</label><input id="rectifyInitial" data-money="br" type="text" inputmode="decimal" pattern="[0-9.,]*"/></div>
      <div class="field"><label>Entradas (R$)</label><input id="rectifyEntries" data-money="br" type="text" inputmode="decimal" pattern="[0-9.,]*"/></div>
      <div class="field"><label>Saídas (R$)</label><input id="rectifyExpenses" data-money="br" type="text" inputmode="decimal" pattern="[0-9.,]*"/></div>
      <div class="field"><label>Repasse (R$)</label><input id="rectifyTransfer" data-money="br" type="text" inputmode="decimal" pattern="[0-9.,]*"/></div>
    </div>`;
    setVal('rectifyInitial',  formatCurrencyBR(Number(closing.initial  || 0)));
    setVal('rectifyEntries',  formatCurrencyBR(Number(closing.entries  || 0)));
    setVal('rectifyExpenses', formatCurrencyBR(Number(closing.expenses || 0)));
    setVal('rectifyTransfer', formatCurrencyBR(Number(closing.transfer || 0)));
    bindCurrencyInputs(body);
  }
  const reasonEl = $('rectifyReason');
  const notesEl  = $('rectifyNotes');
  if (reasonEl) reasonEl.value = '';
  if (notesEl)  notesEl.value  = closing.notes || '';
  if (modal) modal.style.display = 'flex';
}

function closeRectifyModal() {
  const modal = $('rectifyClosingModal');
  if (modal) modal.style.display = 'none';
  _rectifyTargetId = null;
}

async function saveRectification() {
  if (role !== 'master') return alert('Apenas Gestão 5X pode retificar fechamentos.');
  const id = _rectifyTargetId;
  if (!id) return;
  const original = (state.closings || []).find((c) => c.id === id);
  if (!original) return alert('Fechamento original não encontrado.');
  const motivo = ($('rectifyReason')?.value || '').trim();
  if (!motivo) return alert('O motivo da retificação é obrigatório.');
  const novasObs = ($('rectifyNotes')?.value || '').trim();

  const newInitial  = safeMoneyNumber(val('rectifyInitial'));
  const newEntries  = safeMoneyNumber(val('rectifyEntries'));
  const newExpenses = safeMoneyNumber(val('rectifyExpenses'));
  const newTransfer = safeMoneyNumber(val('rectifyTransfer'));

  const store              = state.stores.find((s) => s.id === original.storeId);
  const standardFund       = Number(store?.standardFund || 0);
  const cashBeforeTransfer = newInitial + newEntries - newExpenses;
  const finalAfterTransfer = cashBeforeTransfer - newTransfer;
  const fundDivergence     = finalAfterTransfer - standardFund;
  const newStatus          = closingStatus(fundDivergence, original.companyId);

  const entryItems = newEntries !== Number(original.entries || 0)
    ? [{ description: 'Valor retificado', category: '', client: '', value: newEntries }]
    : (original.entryItems || []);
  const expenseItems = newExpenses !== Number(original.expenses || 0)
    ? [{ description: 'Valor retificado', category: '', supplier: '', value: newExpenses }]
    : (original.expenseItems || []);

  const retificado = {
    ...original,
    id:               uid('cl'),
    type:             'Retificado',
    originalClosingId: original.id,
    initial:          newInitial,
    entries:          newEntries,
    expenses:         newExpenses,
    transfer:         newTransfer,
    expected:         cashBeforeTransfer,
    finalAfterTransfer,
    cashBalance:      finalAfterTransfer,
    standardFund,
    fundDivergence,
    diff:             fundDivergence,
    balance:          fundDivergence,
    status:           newStatus,
    notes:            `[Retificação por ${currentUser?.name || 'master'} em ${new Date().toLocaleDateString('pt-BR')}] Motivo: ${motivo}${novasObs ? ` | Obs: ${novasObs}` : ''}`,
    reviewStatus:     'Retificado',
    createdAt:        new Date().toISOString(),
    attachments:      [],
    entryItems,
    expenseItems,
  };

  state.closings.push(retificado);

  if (sb && !USE_LOCAL_FALLBACK && currentUser?.authId) {
    try {
      await createClosing(retificado);
    } catch (e) {
      state.closings = state.closings.filter((c) => c.id !== retificado.id);
      renderAll();
      return alert(`Erro ao salvar retificação: ${e.message}`);
    }
  } else if (!DEV_LOCAL_MODE) {
    state.closings = state.closings.filter((c) => c.id !== retificado.id);
    renderAll();
    return alert('Supabase obrigatório em produção.');
  }

  addAudit(
    'Retificação de fechamento',
    `${storeName(original.storeId)} / ${original.date} — Motivo: ${motivo} — Valor anterior: ${money(original.fundDivergence ?? original.diff)}`
  );

  closeRectifyModal();
  save(); renderAll();
  alert('Retificação salva com sucesso! O fechamento original foi preservado.');
}

/* ================================================================
   SOLICITAÇÃO DE RETIFICAÇÃO — fluxo do Operador com aprovação Admin
================================================================ */
let _opRectifyTargetId = null;

function openOperatorRectifyModal(closingId) {
  const closing = (state.closings || []).find((c) => c.id === closingId);
  if (!closing) return alert('Fechamento não encontrado.');

  const config = cfg(closing.companyId);
  const deadlineDays = Number(config.rectificationDeadlineDays ?? 0);
  const closingDate = parseBR(closing.date);
  const today = todayISO();

  if (deadlineDays === 0) {
    const cDate = new Date(closingDate); const tDate = new Date(today);
    if (cDate.getFullYear() !== tDate.getFullYear() || cDate.getMonth() !== tDate.getMonth())
      return alert('Retificação permitida apenas dentro do mês atual.');
  } else {
    const limit = new Date(today); limit.setDate(limit.getDate() - deadlineDays);
    if (closingDate < limit.toISOString().slice(0, 10))
      return alert(`Retificação permitida apenas nos últimos ${deadlineDays} dias.`);
  }

  const pending = (state.rectificationRequests || []).find((r) => r.closingId === closingId && r.status === 'Pendente');
  if (pending) return alert('Já existe uma solicitação pendente para este fechamento.');

  const adjustment = (state.cashOpeningAdjustments || []).find((a) =>
    a.storeId === closing.storeId && parseBR(a.startDate) <= closingDate
  );
  const initialBlocked = !!adjustment;
  _opRectifyTargetId = closingId;

  setVal('opRectifyInitial',  String(closing.initial  || 0));
  setVal('opRectifyEntries',  String(closing.entries  || 0));
  setVal('opRectifyExpenses', String(closing.expenses || 0));
  setVal('opRectifyTransfer', String(closing.transfer || 0));
  setVal('opRectifyJustification', '');

  const initialField = $('opRectifyInitial');
  if (initialField) initialField.disabled = initialBlocked;
  const hint = $('opRectifyInitialHint');
  if (hint) hint.style.display = initialBlocked ? '' : 'none';

  const orig = $('opRectifyOriginal');
  if (orig) orig.innerHTML = `<div class="summary" style="margin-bottom:0">
    <div class="summary-line"><span>Loja</span><strong>${esc(storeName(closing.storeId))}</strong></div>
    <div class="summary-line"><span>Data / Turno</span><strong>${esc(closing.date)} — ${esc(closing.shift||'Integral')}</strong></div>
    <div class="summary-line"><span>Saldo Inicial original</span><strong>${money(closing.initial)}</strong></div>
    <div class="summary-line"><span>Entradas originais</span><strong>${money(closing.entries)}</strong></div>
    <div class="summary-line"><span>Saídas originais</span><strong>${money(closing.expenses)}</strong></div>
    <div class="summary-line"><span>Repasse original</span><strong>${money(closing.transfer)}</strong></div>
  </div>`;

  const modal = $('operatorRectifyModal');
  if (modal) modal.style.display = 'flex';
}

function closeOperatorRectifyModal() {
  const modal = $('operatorRectifyModal');
  if (modal) modal.style.display = 'none';
  _opRectifyTargetId = null;
}

function submitRectificationRequest() {
  const closingId = _opRectifyTargetId;
  if (!closingId) return;
  const closing = (state.closings || []).find((c) => c.id === closingId);
  if (!closing) return alert('Fechamento não encontrado.');

  const justification = ($('opRectifyJustification')?.value || '').trim();
  if (!justification) return alert('A justificativa é obrigatória.');

  const initialBlocked = $('opRectifyInitial')?.disabled || false;
  const newInitial   = initialBlocked ? Number(closing.initial || 0) : safeMoneyNumber(val('opRectifyInitial'));
  const newEntries   = safeMoneyNumber(val('opRectifyEntries'));
  const newExpenses  = safeMoneyNumber(val('opRectifyExpenses'));
  const newTransfer  = safeMoneyNumber(val('opRectifyTransfer'));
  const repasseChanged = newTransfer !== Number(closing.transfer || 0);

  const req = {
    id:             uid('rect'),
    closingId,
    companyId:      closing.companyId,
    storeId:        closing.storeId,
    operatorId:     currentUser?.authId || currentUser?.id,
    operatorName:   currentUser?.name || '',
    closingDate:    closing.date,
    originalInitial:  Number(closing.initial  || 0),
    originalEntries:  Number(closing.entries  || 0),
    originalExpenses: Number(closing.expenses || 0),
    originalTransfer: Number(closing.transfer || 0),
    newInitial, newEntries, newExpenses, newTransfer,
    initialBlocked, repasseChanged, justification,
    status: 'Pendente', adminComment: '', reviewedBy: '', reviewedAt: '',
    createdAt: new Date().toISOString(),
  };

  saveRectificationRequest(req);
  addAudit('Solicitação de retificação', `${storeName(closing.storeId)} / ${closing.date} — ${justification}`);
  closeOperatorRectifyModal();
  alert('Solicitação enviada! Aguarde a aprovação do administrador.');
}

async function approveRectification(reqId) {
  const req = (state.rectificationRequests || []).find((r) => r.id === reqId);
  if (!req) return alert('Solicitação não encontrada.');
  const closing = (state.closings || []).find((c) => c.id === req.closingId);
  if (!closing) return alert('Fechamento original não encontrado.');

  const newInitial  = Number(req.newInitial  || 0);
  const newEntries  = Number(req.newEntries  || 0);
  const newExpenses = Number(req.newExpenses || 0);
  const newTransfer = Number(req.newTransfer || 0);
  const standardFund = Number(closing.standardFund || 0);
  const expected    = newInitial + newEntries - newExpenses;
  const finalBal    = expected - newTransfer;
  const diff        = finalBal - standardFund;
  const tolerance      = Number(closing.toleranceSnapshot || cfg(closing.companyId).tolerance || 5);
  const transferTol    = Number(cfg(closing.companyId)?.transferTolerance || 0);
  const newStatus      = Math.abs(diff) <= tolerance
    || (diff > 0 && transferTol > 0 && diff <= transferTol)
    ? 'OK' : 'Divergência';

  const now = new Date().toLocaleDateString('pt-BR');
  const retificadoNotes = `[Retificação aprovada por ${currentUser?.name || 'admin'} em ${now}] ${req.justification} | Original: Ini ${money(req.originalInitial)} Ent ${money(req.originalEntries)} Saí ${money(req.originalExpenses)} Rep ${money(req.originalTransfer)}`;

  const retificado = {
    ...closing,
    id:               uid('cl'),
    type:             'Retificado',
    originalClosingId: closing.id,
    initial: newInitial, entries: newEntries, expenses: newExpenses, transfer: newTransfer,
    expected, cashBeforeTransfer: expected,
    finalAfterTransfer: finalBal, cashBalance: finalBal,
    fundDivergence: diff, diff,
    status: newStatus,
    notes: retificadoNotes,
    reviewStatus: 'Retificado',
    createdAt: new Date().toISOString(),
    attachments: [], entryItems: closing.entryItems || [], expenseItems: closing.expenseItems || [],
  };

  state.closings.push(retificado);

  if (sb && !USE_LOCAL_FALLBACK && currentUser?.authId) {
    try { await createClosing(retificado); }
    catch (e) {
      state.closings = state.closings.filter((c) => c.id !== retificado.id);
      return alert(`Erro ao salvar retificação: ${e.message}`);
    }
  } else if (!DEV_LOCAL_MODE) {
    state.closings = state.closings.filter((c) => c.id !== retificado.id);
    return alert('Supabase obrigatório em produção.');
  }

  req.status = 'Aprovada';
  req.reviewedBy = currentUser?.name || 'admin';
  req.reviewedAt = new Date().toISOString();

  addAudit('Retificação aprovada', `${storeName(req.storeId)} / ${req.closingDate} — ${req.justification}`);
  save(); renderAll();
  alert('Retificação aprovada e aplicada com sucesso!');
}

function rejectRectification(reqId) {
  const req = (state.rectificationRequests || []).find((r) => r.id === reqId);
  if (!req) return alert('Solicitação não encontrada.');
  const reason = prompt('Motivo da rejeição (obrigatório):');
  if (reason === null) return;
  if (!reason.trim()) return alert('Informe o motivo da rejeição.');
  req.status = 'Rejeitada';
  req.adminComment = reason.trim();
  req.reviewedBy   = currentUser?.name || 'admin';
  req.reviewedAt   = new Date().toISOString();
  addAudit('Retificação rejeitada', `${storeName(req.storeId)} / ${req.closingDate} — ${reason.trim()}`);
  save(); renderAll();
  alert('Solicitação rejeitada.');
}

/* ================================================================
   RECALCULAÇÃO DE STATUS DOS FECHAMENTOS EXISTENTES
================================================================ */
async function recalculateClosingStatuses() {
  const updated = [];
  for (const c of (state.closings || [])) {
    if (c.type === 'Excluído') continue;
    const tol         = Number(c.toleranceSnapshot || cfg(c.companyId)?.tolerance || 5);
    const transferTol = Number(cfg(c.companyId)?.transferTolerance || 0);
    const fundDiv     = Number(c.fundDivergence ?? c.diff ?? 0);
    const newStatus   = Math.abs(fundDiv) <= tol
      || (fundDiv > 0 && transferTol > 0 && fundDiv <= transferTol)
      ? 'OK' : 'Divergência';
    if (newStatus !== c.status) {
      c.status = newStatus;
      if (newStatus === 'OK') c.reviewStatus = 'Sem divergência';
      updated.push(c);
    }
  }
  if (sb && !USE_LOCAL_FALLBACK && hasSupabaseSession()) {
    for (const c of updated) {
      try { await updateClosing(c.id, c); } catch (e) { console.warn('recalc err', c.id, e); }
    }
  }
  save();
  renderAll();
  return updated.length;
}

async function handleRecalculateStatuses() {
  if (!confirm(`Recalcular status de todos os fechamentos usando a tolerância de repasse atual?\n\nFechamentos marcados como "Divergência" por valores dentro da tolerância passarão para "OK".`)) return;
  const n = await recalculateClosingStatuses();
  alert(n > 0 ? `${n} fechamento(s) recalculado(s) com sucesso.` : 'Nenhum fechamento precisou de ajuste.');
}

/* ================================================================
   EXPOSIÇÃO GLOBAL
================================================================ */
Object.assign(window, {
  closingAttachments,
  getClosingCalculation,
  selectedStore, totalEntries, totalExpenses,
  expectedCash, finalAfterTransfer, fundDivergence,
  closingStatus,
  openingDivergence, suggestedTransfer, useSuggestedTransfer,
  bindClosingEvents,
  selectedShift, findPreviousClosing, findOpeningAdjustment, openingReference,
  suggestInitialBalance, calc,
  addEntry, addExpense, removeLaunchRow,
  ensureExpenseCategories, ensureEntryCategories,
  confirmTransfer, handleSaveClosingClick, saveClosing, saveOpeningAdjustment, reviewDivergence, createDivergenceReviews,
  recalculateClosingStatuses, handleRecalculateStatuses,
  handleAttachments, renderAttachments, clearAttachmentsUI,
  confirmDeleteClosing, openRectifyModal, closeRectifyModal, saveRectification,
  openOperatorRectifyModal, closeOperatorRectifyModal, submitRectificationRequest,
  approveRectification, rejectRectification,
});


