'use strict';
/* ============================================================
   FECHAMENTO 5X — Lógica oficial de cálculo e persistência

   FÓRMULAS OFICIAIS (imutáveis):
     cashBeforeTransfer  = initialCash + entries - expenses
     finalAfterTransfer  = cashBeforeTransfer - transfer
     fundDivergence      = finalAfterTransfer - standardFund
     status              = f(fundDivergence, tolerance, criticalDivergence)

   AUXILIAR DE CONTAGEM (informativo — não afeta cálculo oficial):
     auxBills = soma das cédulas no simulador
     auxCoins = soma das moedas no simulador
     auxTotal = auxBills + auxCoins
     physicalDivergence = auxTotal - finalAfterTransfer  (informativo)
============================================================ */

let closingAttachments = [];

/* ================================================================
   HELPERS DE SELEÇÃO
================================================================ */
function selectedStore() {
  return state.stores.find((s) => s.id === val('closingStore')) || visibleStores()[0];
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
    origin: `${previous.date} / ${previous.shift || 'Integral'} / ${storeName(previous.storeId)}`,
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

/* Simulador auxiliar */
function cashCounterTotal() {
  return all('.cash-count').reduce((s, e) => s + (Number(e.value)||0) * (Number(e.dataset.value)||0), 0);
}
function coinCounterTotal() {
  return all('.cash-count')
    .filter((e) => Number(e.dataset.value) <= 1)
    .reduce((s, e) => s + (Number(e.value)||0) * (Number(e.dataset.value)||0), 0);
}

/* ================================================================
   FUNÇÃO CENTRAL DE CÁLCULO — única fonte de verdade
   Alimenta: tela, save, histórico, relatórios, divergências.
================================================================ */
function getClosingCalculation() {
  const store = selectedStore();
  const cfgC  = cfg(store?.companyId);

  const initialCash       = num('initial');
  const entriesTotal      = totalEntries();
  const expensesTotal     = totalExpenses();
  const cashBeforeTransfer = initialCash + entriesTotal - expensesTotal;
  const transferAmount    = num('transfer');
  const finalAT           = cashBeforeTransfer - transferAmount;
  const standardFund      = Number(store?.standardFund || 0);
  const fundDivergence    = finalAT - standardFund;
  const tolerance         = Number(cfgC?.tolerance || 5);
  const critDivergence    = Number(cfgC?.criticalDivergence || 20);

  /* Status oficial */
  const absFundDiv = Math.abs(fundDivergence);
  let status;
  if (absFundDiv <= tolerance) {
    status = 'OK';
  } else if (critDivergence > 0 && absFundDiv > critDivergence) {
    status = 'Crítico';
  } else {
    status = 'Divergência';
  }

  const openRef       = openingReference();
  const openingDiv    = initialCash - Number(openRef.amount || 0);

  /* Auxiliar de contagem (informativo) */
  const auxCoins      = coinCounterTotal();
  const auxBills      = cashCounterTotal() - auxCoins;
  const auxTotal      = cashCounterTotal();
  const physicalDiv   = auxTotal - finalAT;

  return {
    store, cfgC,
    initialCash,
    entriesTotal,
    expensesTotal,
    cashBeforeTransfer,       /* = saldo em caixa antes do repasse */
    transferAmount,
    finalAfterTransfer: finalAT,
    standardFund,
    fundDivergence,
    tolerance,
    criticalDivergence: critDivergence,
    status,
    openingDivergence: openingDiv,
    openingRef,
    suggestedTransfer: Math.max(0, cashBeforeTransfer - standardFund),
    auxBills,
    auxCoins,
    auxTotal,
    physicalDivergence: physicalDiv,
  };
}

/* Manter aliases para compatibilidade com relatórios/render */
function expectedCash()       { return getClosingCalculation().cashBeforeTransfer; }
function finalAfterTransfer() { return getClosingCalculation().finalAfterTransfer; }
function fundDivergence()     { return getClosingCalculation().fundDivergence; }
function physicalCount()      { return getClosingCalculation().auxTotal; }
function physicalDivergence() { return getClosingCalculation().physicalDivergence; }
function suggestedTransfer()  { return getClosingCalculation().suggestedTransfer; }
function openingDivergence()  { return getClosingCalculation().openingDivergence; }

function closingStatus(diff, companyId) {
  const c   = cfg(companyId);
  const abs = Math.abs(diff);
  if (abs <= Math.abs(Number(c.tolerance || 0)))                                   return 'OK';
  if (c.criticalDivergence && abs > Math.abs(Number(c.criticalDivergence || 20))) return 'Crítico';
  return 'Divergência';
}

/* ================================================================
   SUGESTÃO DE SALDO INICIAL
================================================================ */
function suggestInitialBalance() {
  const store   = selectedStore();
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

/* ================================================================
   SINCRONISMO DO AUXILIAR DE CONTAGEM
   Atualiza apenas os displays do auxiliar.
   NÃO preenche nenhum campo do formulário principal.
================================================================ */
function syncCoinCountTotal() {
  const cc = getClosingCalculation();
  all('.cash-count-item').forEach((item) => {
    const input = item.querySelector('.cash-count');
    const total = item.querySelector('.cash-count-total');
    if (input && total) total.textContent = money((Number(input.value) || 0) * (Number(input.dataset.value) || 0));
  });
  text('cashCounterTotal', money(cc.auxTotal));  /* compat */
  text('auxBillsView',     money(cc.auxBills));
  text('auxCoinsView',     money(cc.auxCoins));
  text('auxTotalView',     money(cc.auxTotal));
  text('physicalDivergenceView', money(cc.physicalDivergence));
  const physEl = $('physicalDivergenceStatus');
  if (physEl) {
    const abs = Math.abs(cc.physicalDivergence);
    physEl.className   = `status ${abs <= 0.01 ? 'success' : 'warning'}`;
    physEl.textContent = abs <= 0.01 ? 'Confere' : cc.physicalDivergence > 0 ? 'Sobra' : 'Falta';
  }
}

/* ================================================================
   CÁLCULO EM TEMPO REAL
================================================================ */
function calc() {
  renderCashCounter();
  ensureExpenseCategories();

  const cc  = getClosingCalculation();
  const c   = cc.cfgC;
  const ref = cc.openingRef;

  /* Conferência de abertura */
  text('previousFinalAfterTransferView', money(ref.amount || 0));
  text('openingInitialView',    money(cc.initialCash));
  text('openingDivergenceView', money(cc.openingDivergence));
  text('openingOriginView',     ref.origin || 'Caixa inicial');
  const openAlert = $('openingDivergenceAlert');
  if (openAlert) {
    const abs = Math.abs(cc.openingDivergence);
    openAlert.style.display = abs > 0.009 ? '' : 'none';
    openAlert.className     = `kpi-alert ${abs > cc.criticalDivergence ? 'danger' : 'warning'}`;
    openAlert.textContent   = 'O saldo inicial não bate com o último saldo fechado.';
  }

  /* Bloco 1 — Saldo em caixa (passo a passo) */
  text('initialCashView', money(cc.initialCash));
  text('totalEntries',    money(cc.entriesTotal));
  text('totalExpenses',   money(cc.expensesTotal));
  text('expectedCash',    money(cc.cashBeforeTransfer));

  /* Bloco 2 — Repasse */
  text('suggestedTransferView', money(cc.suggestedTransfer));
  text('cashBalance',           money(cc.finalAfterTransfer));

  /* Bloco 3 — Resultado */
  text('standardFundView',  money(cc.standardFund));
  text('fundDivergenceView',money(cc.fundDivergence));
  text('toleranceView',     money(cc.tolerance));

  const statusEl = $('closingStatusView');
  if (statusEl) {
    const cls = cc.status === 'OK' ? 'success' : cc.status === 'Crítico' ? 'danger' : 'warning';
    statusEl.className   = `status ${cls}`;
    statusEl.textContent = cc.status;
  }

  /* Bloco 4 — Auxiliar de contagem */
  text('auxBillsView', money(cc.auxBills));
  text('auxCoinsView', money(cc.auxCoins));
  text('auxTotalView', money(cc.auxTotal));
  text('physicalDivergenceView', money(cc.physicalDivergence));
  const physEl = $('physicalDivergenceStatus');
  if (physEl) {
    const abs = Math.abs(cc.physicalDivergence);
    physEl.className   = `status ${abs <= 0.01 ? 'success' : 'warning'}`;
    physEl.textContent = abs <= 0.01 ? 'Confere' : cc.physicalDivergence > 0 ? 'Sobra' : 'Falta';
  }

  /* Leitura automática */
  const divMsg = cc.status === 'OK'
    ? `✓ Status: OK. Tolerância: ${money(cc.tolerance)}.`
    : cc.status === 'Crítico'
    ? `⚠ Status: CRÍTICO. Divergência: ${money(cc.fundDivergence)}. Limite: ${money(cc.criticalDivergence)}.`
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

  bindCurrencyInputs();
}

/* ================================================================
   LINHAS DINÂMICAS — entradas e saídas
================================================================ */
const MONEY_ATTRS = `type="text" inputmode="decimal" pattern="[0-9.,]*" value="0"
  onblur="formatCurrencyInput(this)" onfocus="selectOnFocus(this)"`;

function addEntry() {
  $('entries')?.insertAdjacentHTML('beforeend', `
    <div class="launch-row">
      <div class="field"><label>Descrição</label><input class="entry-desc" value="Entrada em Dinheiro"/></div>
      <div class="field"><label>Valor (R$)</label>
        <input class="entry" ${MONEY_ATTRS} oninput="calc()"/>
      </div>
      <button class="btn btn-icon" onclick="removeLaunchRow(this)" title="Remover">×</button>
    </div>`);
}

function addExpense() {
  const opts = (state.selectOptions?.expenseCategories || []).map((v) => `<option>${esc(v)}</option>`).join('');
  $('expenses')?.insertAdjacentHTML('beforeend', `
    <div class="launch-row expense-row">
      <div class="field"><label>Descrição da saída</label><input class="expense-desc" placeholder="Ex: ajuda de custo motoboy"/></div>
      <div class="field"><label>Categoria</label><select class="expense-category">${opts}</select></div>
      <div class="field"><label>Valor (R$)</label>
        <input class="expense" ${MONEY_ATTRS} oninput="calc()"/>
      </div>
      <button class="btn btn-icon" onclick="removeLaunchRow(this)" title="Remover">×</button>
    </div>`);
}

function removeLaunchRow(btn) { btn.closest('.launch-row')?.remove(); calc(); }

function ensureExpenseCategories(root = document) {
  all('#expenses .launch-row', root).forEach((row) => {
    if (row.querySelector('.expense-category')) return;
    const vf   = row.querySelector('.expense')?.closest('.field');
    const opts = (state.selectOptions?.expenseCategories || []).map((v) => `<option>${esc(v)}</option>`).join('');
    vf?.insertAdjacentHTML('beforebegin', `<div class="field"><label>Categoria</label><select class="expense-category">${opts}</select></div>`);
  });
}

function renderCashCounter() {
  const box = $('cashCounterGrid');
  if (!box || box.dataset.ready) return;
  const denoms = [
    ['200','Cédula R$ 200'],['100','Cédula R$ 100'],['50','Cédula R$ 50'],
    ['20','Cédula R$ 20'],['10','Cédula R$ 10'],['5','Cédula R$ 5'],['2','Cédula R$ 2'],
    ['1','Moeda R$ 1,00'],['0.50','Moeda R$ 0,50'],['0.25','Moeda R$ 0,25'],
    ['0.10','Moeda R$ 0,10'],['0.05','Moeda R$ 0,05'],['0.01','Moeda R$ 0,01'],
  ];
  box.innerHTML = denoms.map(([v, l]) =>
    `<div class="cash-count-item">
      <label>${l}</label>
      <input class="cash-count" type="number" min="0" step="1" value="0" data-value="${v}"
        oninput="syncCoinCountTotal()"/>
      <strong class="cash-count-total">R$ 0,00</strong>
    </div>`
  ).join('');
  box.dataset.ready = '1';
}

/* ================================================================
   DIVERGENCE REVIEWS — criação em state local
================================================================ */
function createDivergenceReviews(closing) {
  const tol = Math.abs(Number(closing.toleranceSnapshot || cfg(closing.companyId).tolerance || 0));
  const items = [
    ['Divergência de abertura',         closing.openingDivergence],
    ['Divergência contra fundo padrão', closing.fundDivergence ?? closing.diff],
  ].filter(([, v]) => Math.abs(Number(v || 0)) > tol);
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
}

/* ================================================================
   SALVAR FECHAMENTO
================================================================ */
async function saveClosing() {
  const cc    = getClosingCalculation();
  const store = cc.store;

  if (!store) return alert('Selecione uma loja cadastrada.');
  if (role === 'operator' && currentUser?.storeId && store.id !== currentUser.storeId)
    return alert('Este operador só pode lançar fechamento da loja vinculada.');
  if (role === 'admin' && store.companyId !== currentUser?.companyId)
    return alert('Esta loja não pertence ao seu acesso.');

  const closingDate = val('closingDate') || todayISO();
  const dateISO     = parseBR(closingDate);
  if (!dateISO) return alert('Data de fechamento inválida.');

  const shift       = selectedShift();
  const responsible = val('closingResponsible') || currentUser?.name || '';
  if (!responsible) return alert('Selecione o responsável pelo fechamento.');

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

  /* Divergência crítica exige observação */
  if (cc.status === 'Crítico' && !val('closingNotes').trim())
    return alert('Divergência crítica. Preencha as observações antes de salvar.');
  if (Math.abs(cc.openingDivergence) > cc.tolerance && !val('closingNotes').trim())
    return alert('Divergência de abertura acima da tolerância. Preencha as observações.');

  /* Montar itens */
  const entries = entryRows
    .map((row) => ({
      description: row.querySelector('.entry-desc')?.value?.trim() || 'Entrada em Dinheiro',
      value: parseCurrencyBR(row.querySelector('.entry')?.value || '0'),
    })).filter((x) => x.value > 0);

  const expenses = expenseRows
    .map((row) => ({
      description: row.querySelector('.expense-desc')?.value?.trim() || 'Saída',
      category:    row.querySelector('.expense-category')?.value || '',
      value: parseCurrencyBR(row.querySelector('.expense')?.value || '0'),
    })).filter((x) => x.value > 0);

  const openRef = cc.openingRef;

  /* Objeto do fechamento — usa cc como fonte única */
  const closing = {
    id:                         uid('cl'),
    companyId:                  store.companyId,
    storeId:                    store.id,
    date:                       toBRFromISO(dateISO),
    shift, responsible,
    operator:                   currentUser?.name || '',
    initial:                    cc.initialCash,
    coinsTotal:                 cc.auxCoins,
    cashCounterTotal:           cc.auxTotal,
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
    criticalDivergenceSnapshot: cc.criticalDivergence,
    previousClosingId:          openRef.previous?.id || null,
    previousFinalAfterTransfer: Number(openRef.amount || 0),
    openingDivergence:          cc.openingDivergence,
    openingReferenceOrigin:     openRef.origin,
    openingAdjustmentId:        openRef.adjustment?.id || null,
    diff:                       cc.fundDivergence,
    fundDivergence:             cc.fundDivergence,
    physicalCount:              cc.auxTotal,
    physicalDivergence:         cc.physicalDivergence,
    balance:                    cc.fundDivergence,
    notes:                      val('closingNotes'),
    attachments:                closingAttachments.slice(),
    reviewStatus:               cc.status !== 'OK' ? 'Pendente de revisão' : 'Sem divergência',
    status:                     cc.status,
    type:                       closingType, originalClosingId,
    createdAt:                  new Date().toISOString(),
  };

  state.closings.push(closing);
  createDivergenceReviews(closing);

  if (sb && !USE_LOCAL_FALLBACK && currentUser?.authId) {
    try {
      await createClosing(closing);
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
    return alert('Supabase + sessão ativa são obrigatórios em produção.');
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
  all('.cash-count').forEach((e) => { e.value = 0; });
  const hint = $('initialBalanceHint');
  if (hint) hint.style.display = 'none';
  const badge = $('transferConfirmedBadge');
  if (badge) badge.style.display = 'none';
  const cBtn = $('confirmTransferBtn');
  if (cBtn) cBtn.textContent = 'Confirmar repasse';

  /* Resetar auxiliar de contagem */
  text('auxBillsView', money(0));
  text('auxCoinsView', money(0));
  text('auxTotalView', money(0));
  text('cashCounterTotal', money(0));

  save(); renderAll(); calc();
  alert(`Fechamento ${closingType === 'Retificado' ? 'retificado' : 'salvo'} com sucesso!`);
}

/* ================================================================
   ANEXOS
================================================================ */
function handleAttachments(files) {
  closingAttachments.push(...[...files].map((f) => ({
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
   EXPOSIÇÃO GLOBAL
================================================================ */
Object.assign(window, {
  closingAttachments,
  getClosingCalculation,
  selectedStore, totalEntries, totalExpenses,
  cashCounterTotal, coinCounterTotal,
  expectedCash, finalAfterTransfer, fundDivergence,
  physicalCount, physicalDivergence, closingStatus,
  openingDivergence, suggestedTransfer, useSuggestedTransfer,
  selectedShift, findPreviousClosing, findOpeningAdjustment, openingReference,
  syncCoinCountTotal, suggestInitialBalance, calc,
  addEntry, addExpense, removeLaunchRow,
  ensureExpenseCategories, renderCashCounter,
  confirmTransfer, saveClosing, saveOpeningAdjustment, reviewDivergence, createDivergenceReviews,
  handleAttachments, renderAttachments, clearAttachmentsUI,
});
