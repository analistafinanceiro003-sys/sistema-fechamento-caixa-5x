'use strict';
/* ============================================================
   FECHAMENTO 5X — Lógica de cálculo e persistência

   Fórmulas validadas:
     expectedCash      = initialBalance + totalEntries - totalExpenses
     finalAfterTransfer = expectedCash - transferAmount
     fundDivergence    = finalAfterTransfer - standardFundSnapshot
     physicalCount     = cashCounterTotal + coinsTotal
     physicalDivergence = physicalCount - finalAfterTransfer

   coinsTotal NÃO entra em expectedCash.
   coinsTotal faz parte da conferência física.
============================================================ */

let closingAttachments = [];
/* Controla se o operador confirmou o repasse antes de salvar */
let transferConfirmed = false;
let confirmedValues = null; // snapshot dos valores no momento da confirmação

function resetTransferConfirmation() {
  if (!transferConfirmed) return;
  transferConfirmed = false;
  confirmedValues = null;
  const badge = $('transferConfirmedBadge');
  if (badge) badge.style.display = 'none';
  const saveBtn = $('saveClosingBtn');
  if (saveBtn) saveBtn.disabled = true;
  const confirmBtn = $('confirmTransferBtn');
  if (confirmBtn) confirmBtn.textContent = 'Confirmar repasse';
}

/* --- Helpers --- */
function selectedStore() {
  return state.stores.find((s) => s.id === val('closingStore')) || visibleStores()[0];
}

const SHIFT_ORDER = { 'Manhã': 1, 'Tarde': 2, 'Noite': 3, 'Integral': 4, 'Outro': 5 };
function selectedShift() { return val('closingShift') || 'Integral'; }
function shiftRank(shift) { return SHIFT_ORDER[shift] || 99; }
function closingSortValue(c) { return `${parseBR(c.date)}-${String(shiftRank(c.shift || 'Integral')).padStart(2, '0')}-${c.createdAt || ''}`; }

function findPreviousClosing(storeId, dateISO, shift) {
  const currentRank = shiftRank(shift);
  return [...(state.closings || [])]
    .filter((c) => {
      const d = parseBR(c.date);
      const r = shiftRank(c.shift || 'Integral');
      return c.storeId === storeId &&
        (c.type === 'Original' || c.type === 'Retificado' || !c.type) &&
        (d < dateISO || (d === dateISO && r < currentRank));
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
    .sort((a, b) => `${parseBR(b.startDate)}-${shiftRank(b.shift || 'Integral')}-${b.createdAt || ''}`.localeCompare(`${parseBR(a.startDate)}-${shiftRank(a.shift || 'Integral')}-${a.createdAt || ''}`))[0] || null;
}

function openingReference() {
  const store = selectedStore();
  const dateISO = parseBR(val('closingDate'));
  const shift = selectedShift();
  if (!store || !dateISO) return { previous: null, adjustment: null, amount: 0, origin: 'Caixa inicial' };
  const previous = findPreviousClosing(store.id, dateISO, shift);
  if (previous) {
    return {
      previous,
      adjustment: null,
      amount: Number(previous.finalAfterTransfer ?? previous.cashBalance ?? 0),
      origin: `${previous.date} / ${previous.shift || 'Integral'} / ${storeName(previous.storeId)}`,
    };
  }
  const adjustment = findOpeningAdjustment(store.id, dateISO, shift);
  if (adjustment) {
    return {
      previous: null,
      adjustment,
      amount: Number(adjustment.amount || 0),
      origin: `Saldo inicial autorizado pelo ADM em ${toBRFromISO(parseBR(adjustment.startDate))} / ${adjustment.shift || 'Integral'}`,
    };
  }
  return { previous: null, adjustment: null, amount: 0, origin: 'Caixa inicial' };
}

function openingDivergence() {
  const ref = openingReference();
  return num('initial') - Number(ref.amount || 0);
}
/* parseCurrencyBR garante que campos type="text" com máscara sejam lidos corretamente */
function totalEntries() { return all('.entry').reduce((a, e) => a + parseCurrencyBR(e.value), 0); }
function totalExpenses() { return all('.expense').reduce((a, e) => a + parseCurrencyBR(e.value), 0); }
function cashCounterTotal() {
  return all('.cash-count').reduce((a, e) => a + (Number(e.value) || 0) * (Number(e.dataset.value) || 0), 0);
}
function coinCounterTotal() {
  return all('.cash-count')
    .filter((e) => Number(e.dataset.value) <= 1)
    .reduce((a, e) => a + (Number(e.value) || 0) * (Number(e.dataset.value) || 0), 0);
}
function expectedCash() { return num('initial') + totalEntries() - totalExpenses(); }
function finalAfterTransfer() { return expectedCash() - num('transfer'); }
function fundDivergence() {
  const s = selectedStore();
  return finalAfterTransfer() - Number(s?.standardFund || 0);
}
function physicalCount() { return cashCounterTotal() + num('coinsTotal'); }
function physicalDivergence() { return physicalCount() - finalAfterTransfer(); }

function closingStatus(diff, companyId) {
  const c = cfg(companyId);
  const abs = Math.abs(diff);
  if (c.criticalDivergence && abs >= Math.abs(Number(c.criticalDivergence))) return 'Divergência crítica';
  if (abs <= Math.abs(Number(c.tolerance || 0))) return 'Dentro da tolerância';
  return 'Divergência operacional';
}

/* --- Sincroniza moedas com o contador --- */
function syncCoinCountTotal() {
  const total = cashCounterTotal();
  const coins = coinCounterTotal();
  text('cashCounterTotal', money(total));
  if (document.activeElement?.classList?.contains('cash-count')) {
    setVal('coinsTotal', coins.toFixed(2));
  }
}

/* --- Sugestão de saldo inicial --- */
function suggestInitialBalance() {
  const store = selectedStore();
  const dateISO = parseBR(val('closingDate'));
  if (!store || !dateISO) return;
  const ref = openingReference();
  setVal('initial', formatCurrencyBR(ref.amount || 0));
  const hint = $('initialBalanceHint');
  if (hint) {
    hint.textContent = ref.previous || ref.adjustment ? `Sugerido: ${ref.origin}.` : 'Sem fechamento anterior: caixa inicial.';
    hint.style.display = '';
  }
  calc();
}

/* --- Cálculo em tempo real --- */
function calc() {
  renderCashCounter();
  ensureExpenseCategories();
  const store = selectedStore();
  const fd = fundDivergence();
  const pd = physicalDivergence();
  const ref = openingReference();
  const od = openingDivergence();
  const status = closingStatus(fd, store?.companyId);
  const c = cfg(store?.companyId);

  text('previousFinalAfterTransferView', money(ref.amount || 0));
  text('openingInitialView', money(num('initial')));
  text('openingDivergenceView', money(od));
  text('openingOriginView', ref.origin || 'Caixa inicial');
  const openingAlert = $('openingDivergenceAlert');
  if (openingAlert) {
    const absOpening = Math.abs(od);
    openingAlert.style.display = absOpening > 0.009 ? '' : 'none';
    openingAlert.className = `kpi-alert ${absOpening >= Number(c.criticalDivergence || 20) ? 'danger' : 'warning'}`;
    openingAlert.textContent = 'O saldo inicial informado não bate com o último saldo fechado. Valide retirada, complemento, erro de contagem ou ajuste operacional entre os fechamentos.';
  }
  text('coinsTotalView', money(num('coinsTotal')));
  text('totalEntries', money(totalEntries()));
  text('totalExpenses', money(totalExpenses()));
  text('expectedCash', money(expectedCash()));
  text('cashBalance', money(finalAfterTransfer()));
  text('standardFundView', money(store?.standardFund || 0));
  text('fundDivergenceView', money(fd));
  text('physicalCountView', money(physicalCount()));
  text('physicalDivergenceView', money(pd));

  /* Badge de status */
  const statusEl = $('closingStatusView');
  if (statusEl) {
    statusEl.className = `status ${
      status === 'Dentro da tolerância' ? 'success'
      : status === 'Divergência crítica' ? 'danger'
      : 'warning'
    }`;
    statusEl.textContent = status;
  }

  /* Divergência física badge */
  const physEl = $('physicalDivergenceStatus');
  if (physEl) {
    const absPhys = Math.abs(pd);
    physEl.className = `status ${absPhys <= 0.01 ? 'success' : absPhys >= Number(c.criticalDivergence || 20) ? 'danger' : 'warning'}`;
    physEl.textContent = absPhys <= 0.01 ? 'Conferência ok' : pd > 0 ? 'Sobra física' : 'Falta física';
  }

  /* Leitura automática */
  const fdMsg = status === 'Dentro da tolerância'
    ? `✓ Fundo conferido. Tolerância permitida: ${money(c.tolerance)}.`
    : status === 'Divergência crítica'
    ? `⚠ Divergência crítica: ${money(fd)}. Revisar contagem, saídas e repasse. Limite: ${money(c.criticalDivergence)}.`
    : `◎ Divergência acima da tolerância (${money(c.tolerance)}): ${money(fd)}.`;

  const pdMsg = Math.abs(pd) <= 0.01
    ? 'Conferência física bate com o saldo calculado.'
    : pd > 0
    ? `Sobra física de ${money(pd)} (contou mais do que o calculado).`
    : `Falta física de ${money(Math.abs(pd))} (contou menos do que o calculado).`;

  const odMsg = Math.abs(od) <= Math.abs(Number(c.tolerance || 0))
    ? `Abertura dentro da tolerância: ${money(od)}.`
    : Math.abs(od) >= Math.abs(Number(c.criticalDivergence || 20))
    ? `Divergência de abertura crítica: ${money(od)}. Exige validação antes de salvar.`
    : `Divergência de abertura com atenção: ${money(od)}.`;

  text('closingInsight',
    `${odMsg}\n${fdMsg}\n${pdMsg}\n` +
    `Cálculo: saldo final após repasse (${money(finalAfterTransfer())}) − fundo padrão (${money(store?.standardFund || 0)}) = ${money(fd)}.`
  );

  /* Se valores mudaram após confirmar repasse, exige nova confirmação */
  if (transferConfirmed && confirmedValues) {
    if (
      Math.abs(num('initial') - confirmedValues.initial) > 0.001 ||
      Math.abs(totalEntries() - confirmedValues.entries) > 0.001 ||
      Math.abs(totalExpenses() - confirmedValues.expenses) > 0.001 ||
      Math.abs(num('transfer') - confirmedValues.transfer) > 0.001
    ) {
      resetTransferConfirmation();
    }
  }
  /* Mantém o botão "Realizar fechamento" sincronizado com o estado de confirmação */
  const saveClosingBtn = $('saveClosingBtn');
  if (saveClosingBtn) saveClosingBtn.disabled = !transferConfirmed;

  bindCurrencyInputs();
}

/* --- Linhas dinâmicas --- */
/* Atributos compartilhados para inputs monetários dinâmicos */
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
  const opts = (state.selectOptions.expenseCategories || []).map((v) => `<option>${esc(v)}</option>`).join('');
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
    const valueField = row.querySelector('.expense')?.closest('.field');
    const opts = (state.selectOptions.expenseCategories || []).map((v) => `<option>${esc(v)}</option>`).join('');
    valueField?.insertAdjacentHTML('beforebegin', `<div class="field"><label>Categoria</label><select class="expense-category">${opts}</select></div>`);
  });
}

function renderCashCounter() {
  const box = $('cashCounterGrid');
  if (!box || box.dataset.ready) return;
  const denoms = [
    ['0.01','Moeda 0,01'],['0.05','Moeda 0,05'],['0.10','Moeda 0,10'],
    ['0.25','Moeda 0,25'],['0.50','Moeda 0,50'],['1','Moeda 1,00'],
    ['2','Cédula 2'],['5','Cédula 5'],['10','Cédula 10'],
    ['20','Cédula 20'],['50','Cédula 50'],['100','Cédula 100'],['200','Cédula 200'],
  ];
  box.innerHTML = denoms.map(([v, l]) =>
    `<div class="cash-count-item">
      <label>${l}</label>
      <input class="cash-count" type="number" min="0" step="1" value="0" data-value="${v}" oninput="syncCoinCountTotal();calc()"/>
    </div>`
  ).join('');
  box.dataset.ready = '1';
}

function createDivergenceReviews(closing) {
  const tol = Math.abs(Number(closing.toleranceSnapshot || cfg(closing.companyId).tolerance || 0));
  const items = [
    ['Divergência de abertura', closing.openingDivergence],
    ['Divergência contra fundo padrão', closing.fundDivergence ?? closing.diff],
    ['Divergência física', closing.physicalDivergence],
  ].filter(([, amount]) => Math.abs(Number(amount || 0)) > tol);
  state.divergenceReviews = state.divergenceReviews || [];
  items.forEach(([type, amount]) => {
    state.divergenceReviews.push({
      id: uid('drv'),
      closingId: closing.id,
      companyId: closing.companyId,
      storeId: closing.storeId,
      divergenceType: type,
      divergenceAmount: Number(amount || 0),
      reviewStatus: 'Pendente',
      adminComment: '',
      reviewedBy: '',
      reviewedAt: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });
}

async function saveOpeningAdjustment() {
  const storeId = val('openingAdjustmentStore');
  const store = state.stores.find((s) => s.id === storeId);
  if (!store) return alert('Selecione a loja para o saldo inicial autorizado.');
  if (role === 'operator') return alert('Operador não pode definir saldo inicial autorizado.');
  if (role === 'admin' && store.companyId !== currentUser?.companyId) return alert('Esta loja não pertence ao seu acesso.');
  if ((state.closings || []).some((c) => c.storeId === storeId) && !confirm('Já existe histórico de fechamento para esta loja. Deseja registrar um ajuste autorizado?')) return;
  const amount = parseCurrencyBR(val('openingAdjustmentAmount'));
  const reason = val('openingAdjustmentReason');
  if (!reason) return alert('Informe o motivo do saldo inicial autorizado.');
  state.cashOpeningAdjustments = state.cashOpeningAdjustments || [];
  const adjustment = {
    id: uid('coa'),
    companyId: store.companyId,
    storeId,
    authorizedBy: currentUser?.id || currentUser?.name || 'master',
    startDate: val('openingAdjustmentDate') || todayISO(),
    shift: val('openingAdjustmentShift') || 'Integral',
    amount,
    reason,
    notes: val('openingAdjustmentNotes'),
    createdAt: new Date().toISOString(),
  };
  if (sb && !USE_LOCAL_FALLBACK && currentUser?.authId) {
    try {
      const row = await createCashOpeningAdjustment(adjustment);
      if (row?.id) adjustment.id = row.id;
    } catch (e) {
      return alert(`Erro ao salvar ajuste no Supabase: ${e.message}`);
    }
  } else if (!DEV_LOCAL_MODE) {
    return alert('Supabase Auth/Sessão obrigatório em produção para salvar ajuste.');
  }
  state.cashOpeningAdjustments.push(adjustment);
  addAudit('Saldo inicial autorizado', `${companyName(store.companyId)} / ${store.name} - ${money(amount)}`);
  ['openingAdjustmentAmount','openingAdjustmentNotes'].forEach((id) => setVal(id, ''));
  save();
  renderAll();
  alert('Saldo inicial autorizado registrado.');
}

async function reviewDivergence(id, status) {
  const review = (state.divergenceReviews || []).find((r) => r.id === id);
  if (!review) return;
  if (role === 'operator') return alert('Operador não pode revisar divergências.');
  if (role === 'admin' && review.companyId !== currentUser?.companyId) return alert('Esta divergência não pertence ao seu acesso.');
  const comment = prompt(`Parecer do Admin para marcar como ${status}:`);
  if (!comment || !comment.trim()) return alert('A revisão exige parecer/comentário.');
  const updatedReview = {
    ...review,
    reviewStatus: status,
    adminComment: comment.trim(),
    reviewedBy: currentUser?.name || 'Master',
    reviewedAt: new Date().toISOString(),
  };
  updatedReview.updatedAt = updatedReview.reviewedAt;
  if (sb && !USE_LOCAL_FALLBACK && currentUser?.authId) {
    try {
      await updateDivergenceReview(review.id, updatedReview);
    } catch (e) {
      return alert(`Erro ao revisar divergência no Supabase: ${e.message}`);
    }
  } else if (!DEV_LOCAL_MODE) {
    return alert('Supabase Auth/Sessão obrigatório em produção para revisar divergências.');
  }
  Object.assign(review, updatedReview);
  addAudit('Revisão de divergência', `${storeName(review.storeId)} / ${review.divergenceType} / ${status}`);
  save();
  renderAll();
}

/* --- Confirmar repasse --- */
async function confirmTransfer() {
  const store = selectedStore();
  if (!store) return alert('Selecione uma loja antes de confirmar o repasse.');
  const transfer = num('transfer');
  const expCash = expectedCash();
  if (transfer < 0) return alert('O valor do repasse não pode ser negativo.');
  if (transfer > expCash + 0.001) {
    const ok = confirm(
      `O repasse informado (${money(transfer)}) é maior que o saldo em caixa (${money(expCash)}).\n` +
      'Verifique antes de confirmar.\n\nDeseja confirmar assim mesmo?'
    );
    if (!ok) return;
  }
  transferConfirmed = true;
  confirmedValues = {
    initial: num('initial'),
    entries: totalEntries(),
    expenses: totalExpenses(),
    transfer,
  };
  const badge = $('transferConfirmedBadge');
  if (badge) badge.style.display = '';
  const saveBtn = $('saveClosingBtn');
  if (saveBtn) saveBtn.disabled = false;
  const confirmBtn = $('confirmTransferBtn');
  if (confirmBtn) confirmBtn.textContent = '✓ Repasse confirmado';
  calc();
}

/* --- Salvar fechamento --- */
async function saveClosing() {
  const store = selectedStore();
  if (!store) return alert('Selecione uma loja cadastrada.');
  if (role === 'operator' && currentUser?.storeId && store.id !== currentUser.storeId) {
    return alert('Este operador só pode lançar fechamento da loja vinculada.');
  }
  if (role === 'admin' && store.companyId !== currentUser?.companyId) {
    return alert('Esta loja não pertence ao seu acesso.');
  }

  if (!transferConfirmed) return alert('Confirme o repasse antes de realizar o fechamento.');

  const closingDate = val('closingDate') || todayISO();
  const dateISO = parseBR(closingDate);
  const shift = selectedShift();
  const responsible = val('closingResponsible') || currentUser?.name || '';

  if (!shift) return alert('Selecione o turno do fechamento.');
  if (!responsible) return alert('Selecione o responsável pelo fechamento.');

  /* Validação de entradas/saídas */
  const entryRows = all('#entries .launch-row');
  const expenseRows = all('#expenses .launch-row');
  for (const row of entryRows) {
    const v = parseCurrencyBR(row.querySelector('.entry')?.value || 0);
    const d = row.querySelector('.entry-desc')?.value?.trim();
    if (v > 0 && !d) return alert('Todas as entradas com valor > 0 precisam de descrição.');
    if (v < 0) return alert('Valores de entrada não podem ser negativos.');
  }
  for (const row of expenseRows) {
    const v = parseCurrencyBR(row.querySelector('.expense')?.value || 0);
    const d = row.querySelector('.expense-desc')?.value?.trim();
    if (v > 0 && !d) return alert('Todas as saídas com valor > 0 precisam de descrição.');
    if (v < 0) return alert('Valores de saída não podem ser negativos.');
  }

  /* Detectar fechamento duplicado */
  const existing = state.closings.find((c) =>
    c.storeId === store.id &&
    parseBR(c.date) === dateISO &&
    (c.shift || 'Integral') === shift &&
    (c.type === 'Original' || !c.type)
  );

  let closingType = 'Original';
  let originalClosingId = null;

  if (existing) {
    const ok = confirm(
      `Já existe um fechamento Original para "${store.name}" em ${toBRFromISO(dateISO)}.\n\n` +
      'Deseja registrar uma RETIFICAÇÃO? (O original será preservado.)\n\n' +
      'Clique em OK para retificar ou Cancelar para não salvar.'
    );
    if (!ok) return;
    closingType = 'Retificado';
    originalClosingId = existing.id;
  }

  /* Snapshots de fundo e tolerância */
  const c = cfg(store.companyId);
  const stdFundSnapshot = Number(store.standardFund || 0);
  const tolSnapshot = Number(c.tolerance || 5);
  const critSnapshot = Number(c.criticalDivergence || 20);

  /* Itens */
  const entries = entryRows
    .map((row) => ({
      description: row.querySelector('.entry-desc')?.value || 'Entrada',
      value: parseCurrencyBR(row.querySelector('.entry')?.value || 0),
    }))
    .filter((x) => x.value > 0 || x.description);

  const expenses = expenseRows
    .map((row) => ({
      description: row.querySelector('.expense-desc')?.value || 'Saída',
      category: row.querySelector('.expense-category')?.value || '',
      value: parseCurrencyBR(row.querySelector('.expense')?.value || 0),
    }))
    .filter((x) => x.value > 0 || x.description);

  const expCash = expectedCash();
  const finalCash = finalAfterTransfer();
  const fd = finalCash - stdFundSnapshot;
  const phCount = cashCounterTotal() + num('coinsTotal');
  const phDiv = phCount - finalCash;
  const openRef = openingReference();
  const openDiv = num('initial') - Number(openRef.amount || 0);
  const status = closingStatus(fd, store.companyId);

  /* Divergência crítica exige observação */
  if (Math.abs(fd) >= critSnapshot && !val('closingNotes').trim()) {
    return alert('Divergência crítica detectada. Preencha as observações antes de salvar.');
  }

  if (Math.abs(openDiv) > tolSnapshot && !val('closingNotes').trim()) {
    return alert('Divergência de abertura acima da tolerância. Preencha as observações antes de salvar.');
  }

  const closing = {
    id: uid('cl'),
    companyId: store.companyId,
    storeId: store.id,
    date: toBRFromISO(dateISO),
    shift,
    responsible,
    operator: currentUser?.name || '',
    initial: num('initial'),
    coinsTotal: num('coinsTotal'),
    cashCounterTotal: cashCounterTotal(),
    entries: totalEntries(),
    entryItems: entries,
    expenses: totalExpenses(),
    expenseItems: expenses,
    transfer: num('transfer'),
    expected: expCash,
    finalAfterTransfer: finalCash,
    cashBalance: finalCash,
    standardFund: stdFundSnapshot,
    toleranceSnapshot: tolSnapshot,
    criticalDivergenceSnapshot: critSnapshot,
    previousClosingId: openRef.previous?.id || null,
    previousFinalAfterTransfer: Number(openRef.amount || 0),
    openingDivergence: openDiv,
    openingReferenceOrigin: openRef.origin,
    openingAdjustmentId: openRef.adjustment?.id || null,
    diff: fd,
    fundDivergence: fd,
    physicalCount: phCount,
    physicalDivergence: phDiv,
    balance: fd,
    notes: val('closingNotes'),
    attachments: closingAttachments.slice(),
    reviewStatus: Math.abs(fd) > 0 ? 'Pendente de revisão' : 'Sem divergência',
    status,
    type: closingType,
    originalClosingId,
    createdAt: new Date().toISOString(),
  };
  state.closings.push(closing);
  createDivergenceReviews(closing);
  if (sb && !USE_LOCAL_FALLBACK && currentUser?.authId) {
    try {
      await createClosing(closing);
    } catch (e) {
      state.closings = state.closings.filter((c) => c.id !== closing.id);
      state.divergenceReviews = (state.divergenceReviews || []).filter((r) => r.closingId !== closing.id);
      return alert(`Erro ao salvar fechamento no Supabase: ${e.message}`);
    }
  } else if (!DEV_LOCAL_MODE) {
    state.closings = state.closings.filter((c) => c.id !== closing.id);
    state.divergenceReviews = (state.divergenceReviews || []).filter((r) => r.closingId !== closing.id);
    return alert('Supabase Auth/Sessão obrigatório em produção para salvar fechamento.');
  }

  addAudit(
    closingType === 'Retificado' ? 'Retificação de fechamento' : 'Fechamento salvo',
    `${companyName(store.companyId)} / ${store.name} — ${toBRFromISO(dateISO)}`
  );

  /* Limpar formulário */
  closingAttachments = [];
  clearAttachmentsUI();
  ['initial','coinsTotal','transfer','closingNotes'].forEach((id) => setVal(id, id === 'closingNotes' ? '' : formatCurrencyBR(0)));
  all('.entry').forEach((e) => { e.value = formatCurrencyBR(0); });
  all('.expense').forEach((e) => { e.value = formatCurrencyBR(0); });
  all('.cash-count').forEach((e) => { e.value = 0; });
  const hint = $('initialBalanceHint');
  if (hint) hint.style.display = 'none';
  /* Resetar estado de confirmação do repasse */
  transferConfirmed = false;
  confirmedValues = null;
  const confirmBadge = $('transferConfirmedBadge');
  if (confirmBadge) confirmBadge.style.display = 'none';
  const saveBtnEl = $('saveClosingBtn');
  if (saveBtnEl) saveBtnEl.disabled = true;
  const confirmBtnEl = $('confirmTransferBtn');
  if (confirmBtnEl) confirmBtnEl.textContent = 'Confirmar repasse';

  save();
  renderAll();
  calc();
  alert(`Fechamento ${closingType === 'Retificado' ? 'retificado' : 'salvo'} com sucesso (Conferência 5X).`);
}

/* --- Anexos --- */
function handleAttachments(files) {
  closingAttachments.push(...[...files].map((f) => ({
    name: f.name, size: f.size, type: f.type, lastModified: f.lastModified,
  })));
  renderAttachments();
}

function renderAttachments() {
  html('attachmentList', closingAttachments.length
    ? closingAttachments.map((f) => `<div class="attachment-item">${esc(f.name)} <span class="subtle">${Math.round(f.size/1024)} KB</span></div>`).join('')
    : '<span class="subtle">Nenhum anexo selecionado.</span>'
  );
}

function clearAttachmentsUI() {
  const a = $('closingAttachments');
  const cam = $('closingCamera');
  if (a) a.value = '';
  if (cam) cam.value = '';
  renderAttachments();
}

Object.assign(window, {
  closingAttachments,
  selectedStore, totalEntries, totalExpenses,
  cashCounterTotal, coinCounterTotal,
  expectedCash, finalAfterTransfer, fundDivergence,
  physicalCount, physicalDivergence, closingStatus,
  selectedShift, findPreviousClosing, findOpeningAdjustment, openingReference, openingDivergence,
  syncCoinCountTotal, suggestInitialBalance, calc,
  addEntry, addExpense, removeLaunchRow,
  ensureExpenseCategories, renderCashCounter,
  confirmTransfer, saveClosing, saveOpeningAdjustment, reviewDivergence, createDivergenceReviews,
  handleAttachments, renderAttachments, clearAttachmentsUI,
});
