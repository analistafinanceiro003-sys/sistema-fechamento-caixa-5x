'use strict';
/* ============================================================
   FECHAMENTO 5X — Lógica de cálculo e persistência

   Fórmulas 5X (imutáveis):
     expectedCash       = initialBalance + totalEntries - totalExpenses
     finalAfterTransfer = expectedCash - transferAmount
     fundDivergence     = finalAfterTransfer - standardFundSnapshot
     physicalCount      = cashCounterTotal + coinsTotal
     physicalDivergence = physicalCount - finalAfterTransfer

   coinsTotal NÃO entra em expectedCash.
   coinsTotal faz parte SOMENTE da conferência física.
============================================================ */

let closingAttachments = [];

/* ================================================================
   HELPERS DE CÁLCULO
================================================================ */
function selectedStore() {
  return state.stores.find((s) => s.id === val('closingStore')) || visibleStores()[0];
}

const SHIFT_ORDER = { 'Manhã': 1, 'Tarde': 2, 'Noite': 3, 'Integral': 4, 'Outro': 5 };
function selectedShift()            { return val('closingShift') || 'Integral'; }
function shiftRank(shift)           { return SHIFT_ORDER[shift] || 99; }
function closingSortValue(c)        { return `${parseBR(c.date)}-${String(shiftRank(c.shift || 'Integral')).padStart(2, '0')}-${c.createdAt || ''}`; }

function findPreviousClosing(storeId, dateISO, shift) {
  const rank = shiftRank(shift);
  return [...(state.closings || [])]
    .filter((c) => {
      const d = parseBR(c.date);
      const r = shiftRank(c.shift || 'Integral');
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
      `${parseBR(b.startDate)}-${shiftRank(b.shift || 'Integral')}-${b.createdAt || ''}`
        .localeCompare(`${parseBR(a.startDate)}-${shiftRank(a.shift || 'Integral')}-${a.createdAt || ''}`)
    )[0] || null;
}

function openingReference() {
  const store   = selectedStore();
  const dateISO = parseBR(val('closingDate'));
  const shift   = selectedShift();
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
  return num('initial') - Number(openingReference().amount || 0);
}

/* Totais de linhas de lançamento */
function totalEntries()  { return all('.entry').reduce((s, e) => s + parseCurrencyBR(e.value), 0); }
function totalExpenses() { return all('.expense').reduce((s, e) => s + parseCurrencyBR(e.value), 0); }

/* Simulador de cédulas/moedas */
function cashCounterTotal() {
  return all('.cash-count').reduce((s, e) => s + (Number(e.value) || 0) * (Number(e.dataset.value) || 0), 0);
}
function coinCounterTotal() {
  return all('.cash-count')
    .filter((e) => Number(e.dataset.value) <= 1)
    .reduce((s, e) => s + (Number(e.value) || 0) * (Number(e.dataset.value) || 0), 0);
}

/* ── FÓRMULAS 5X ────────────────────────────────────────────── */
function expectedCash()        { return num('initial') + totalEntries() - totalExpenses(); }
function finalAfterTransfer()  { return expectedCash() - num('transfer'); }
function fundDivergence()      { return finalAfterTransfer() - Number(selectedStore()?.standardFund || 0); }
function physicalCount()       { return cashCounterTotal() + num('coinsTotal'); }
function physicalDivergence()  { return physicalCount() - finalAfterTransfer(); }

/* Repasse sugerido = saldo esperado − fundo padrão (o que deve sair para o caixa central) */
function suggestedTransfer() {
  return Math.max(0, expectedCash() - Number(selectedStore()?.standardFund || 0));
}

function closingStatus(diff, companyId) {
  const c   = cfg(companyId);
  const abs = Math.abs(diff);
  if (c.criticalDivergence && abs >= Math.abs(Number(c.criticalDivergence))) return 'Divergência crítica';
  if (abs <= Math.abs(Number(c.tolerance || 0)))                             return 'Dentro da tolerância';
  return 'Divergência operacional';
}

/* ================================================================
   SINCRONISMO — simulador de moedas
================================================================ */
function syncCoinCountTotal() {
  text('cashCounterTotal', money(cashCounterTotal()));
  if (document.activeElement?.classList?.contains('cash-count')) {
    setVal('coinsTotal', coinCounterTotal().toFixed(2));
  }
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

/* Preenche o campo repasse com o valor sugerido */
function useSuggestedTransfer() {
  setVal('transfer', formatCurrencyBR(suggestedTransfer()));
  calc();
}

/* ================================================================
   CÁLCULO EM TEMPO REAL
================================================================ */
function calc() {
  renderCashCounter();
  ensureExpenseCategories();

  const store  = selectedStore();
  const fd     = fundDivergence();
  const pd     = physicalDivergence();
  const ref    = openingReference();
  const od     = openingDivergence();
  const status = closingStatus(fd, store?.companyId);
  const c      = cfg(store?.companyId);

  /* Conferência de abertura */
  text('previousFinalAfterTransferView', money(ref.amount || 0));
  text('openingInitialView',    money(num('initial')));
  text('openingDivergenceView', money(od));
  text('openingOriginView',     ref.origin || 'Caixa inicial');

  const openingAlert = $('openingDivergenceAlert');
  if (openingAlert) {
    const abs = Math.abs(od);
    openingAlert.style.display = abs > 0.009 ? '' : 'none';
    openingAlert.className     = `kpi-alert ${abs >= Number(c.criticalDivergence || 20) ? 'danger' : 'warning'}`;
    openingAlert.textContent   = 'O saldo inicial não bate com o último saldo fechado. Valide retirada, complemento ou erro de contagem.';
  }

  /* Movimento calculado */
  text('coinsTotalView',         money(num('coinsTotal')));
  text('totalEntries',           money(totalEntries()));
  text('totalExpenses',          money(totalExpenses()));
  text('expectedCash',           money(expectedCash()));
  text('suggestedTransferView',  money(suggestedTransfer()));
  text('cashBalance',            money(finalAfterTransfer()));
  text('standardFundView',       money(store?.standardFund || 0));
  text('fundDivergenceView',     money(fd));
  text('physicalCountView',      money(physicalCount()));
  text('physicalDivergenceView', money(pd));

  /* Badge de status do fundo */
  const statusEl = $('closingStatusView');
  if (statusEl) {
    statusEl.className   = `status ${status === 'Dentro da tolerância' ? 'success' : status === 'Divergência crítica' ? 'danger' : 'warning'}`;
    statusEl.textContent = status;
  }

  /* Badge de divergência física */
  const physEl = $('physicalDivergenceStatus');
  if (physEl) {
    const absPd = Math.abs(pd);
    physEl.className   = `status ${absPd <= 0.01 ? 'success' : absPd >= Number(c.criticalDivergence || 20) ? 'danger' : 'warning'}`;
    physEl.textContent = absPd <= 0.01 ? 'Conferência ok' : pd > 0 ? 'Sobra física' : 'Falta física';
  }

  /* Leitura automática 5X */
  const fdMsg = status === 'Dentro da tolerância'
    ? `✓ Fundo conferido. Tolerância: ${money(c.tolerance)}.`
    : status === 'Divergência crítica'
    ? `⚠ Divergência crítica: ${money(fd)}. Revisar contagem, saídas e repasse. Limite: ${money(c.criticalDivergence)}.`
    : `◎ Divergência acima da tolerância (${money(c.tolerance)}): ${money(fd)}.`;

  const pdMsg = Math.abs(pd) <= 0.01
    ? 'Conferência física bate com o calculado.'
    : pd > 0
      ? `Sobra física de ${money(pd)} (contou mais que o calculado).`
      : `Falta física de ${money(Math.abs(pd))} (contou menos que o calculado).`;

  const odMsg = Math.abs(od) <= Math.abs(Number(c.tolerance || 0))
    ? `Abertura dentro da tolerância: ${money(od)}.`
    : Math.abs(od) >= Math.abs(Number(c.criticalDivergence || 20))
    ? `Divergência de abertura crítica: ${money(od)}. Exige validação antes de salvar.`
    : `Divergência de abertura com atenção: ${money(od)}.`;

  text('closingInsight',
    `${odMsg}\n${fdMsg}\n${pdMsg}\n` +
    `Cálculo: saldo final (${money(finalAfterTransfer())}) − fundo padrão (${money(store?.standardFund || 0)}) = ${money(fd)}.`
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
    ['0.01','Moeda 0,01'],['0.05','Moeda 0,05'],['0.10','Moeda 0,10'],
    ['0.25','Moeda 0,25'],['0.50','Moeda 0,50'],['1','Moeda 1,00'],
    ['2','Cédula 2'],['5','Cédula 5'],['10','Cédula 10'],
    ['20','Cédula 20'],['50','Cédula 50'],['100','Cédula 100'],['200','Cédula 200'],
  ];
  box.innerHTML = denoms.map(([v, l]) =>
    `<div class="cash-count-item">
      <label>${l}</label>
      <input class="cash-count" type="number" min="0" step="1" value="0" data-value="${v}"
        oninput="syncCoinCountTotal();calc()"/>
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
    ['Divergência de abertura',           closing.openingDivergence],
    ['Divergência contra fundo padrão',   closing.fundDivergence ?? closing.diff],
    ['Divergência física',                closing.physicalDivergence],
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
  save();
  renderAll();
  alert('Saldo inicial autorizado registrado.');
}

/* ================================================================
   REVISÃO DE DIVERGÊNCIAS (admin)
================================================================ */
async function reviewDivergence(id, status) {
  const review = (state.divergenceReviews || []).find((r) => r.id === id);
  if (!review) return;
  if (role === 'operator')                                               return alert('Operador não pode revisar divergências.');
  if (role === 'admin' && review.companyId !== currentUser?.companyId)  return alert('Esta divergência não pertence ao seu acesso.');
  const comment = prompt(`Parecer para marcar como "${status}":`);
  if (!comment?.trim()) return alert('A revisão exige parecer/comentário.');

  const updated = {
    ...review,
    reviewStatus: status,
    adminComment: comment.trim(),
    reviewedBy:   currentUser?.name || 'Master',
    reviewedAt:   new Date().toISOString(),
    updatedAt:    new Date().toISOString(),
  };

  if (sb && !USE_LOCAL_FALLBACK && currentUser?.authId) {
    try { await updateDivergenceReview(review.id, updated); }
    catch (e) { return alert(`Erro ao revisar divergência: ${e.message}`); }
  } else if (!DEV_LOCAL_MODE) {
    return alert('Supabase obrigatório em produção para revisar divergências.');
  }

  Object.assign(review, updated);
  addAudit('Revisão de divergência', `${storeName(review.storeId)} / ${review.divergenceType} / ${status}`);
  save();
  renderAll();
}

/* ================================================================
   CONFIRMAR REPASSE (botão auxiliar — não bloqueia o salvar)
================================================================ */
function confirmTransfer() {
  const store   = selectedStore();
  const transfer = num('transfer');
  const expCash  = expectedCash();

  if (!store)      return alert('Selecione uma loja primeiro.');
  if (transfer < 0) return alert('O valor do repasse não pode ser negativo.');

  if (transfer > expCash + 0.01) {
    if (!confirm(
      `O repasse (${money(transfer)}) é maior que o saldo em caixa (${money(expCash)}).\n` +
      'Verifique antes de continuar.\n\nDeseja confirmar assim mesmo?'
    )) return;
  }

  const badge = $('transferConfirmedBadge');
  if (badge) badge.style.display = '';
  const btn = $('confirmTransferBtn');
  if (btn) btn.textContent = '✓ Repasse confirmado';
}

/* ================================================================
   SALVAR FECHAMENTO — função principal
================================================================ */
async function saveClosing() {
  /* ── 1. Validações básicas ─────────────────────────────────── */
  const store = selectedStore();
  if (!store) return alert('Selecione uma loja cadastrada.');

  if (role === 'operator' && currentUser?.storeId && store.id !== currentUser.storeId) {
    return alert('Este operador só pode lançar fechamento da loja vinculada.');
  }
  if (role === 'admin' && store.companyId !== currentUser?.companyId) {
    return alert('Esta loja não pertence ao seu acesso.');
  }

  const closingDate = val('closingDate') || todayISO();
  const dateISO     = parseBR(closingDate);
  if (!dateISO) return alert('Data de fechamento inválida.');

  const shift       = selectedShift();
  const responsible = val('closingResponsible') || currentUser?.name || '';
  if (!responsible) return alert('Selecione o responsável pelo fechamento.');

  /* ── 2. Validação de entradas/saídas ─────────────────────── */
  const entryRows   = all('#entries .launch-row');
  const expenseRows = all('#expenses .launch-row');

  for (const row of entryRows) {
    const v = parseCurrencyBR(row.querySelector('.entry')?.value || '0');
    const d = row.querySelector('.entry-desc')?.value?.trim();
    if (v > 0 && !d) return alert('Todas as entradas com valor precisam de descrição.');
    if (v < 0)       return alert('Valor de entrada não pode ser negativo.');
  }
  for (const row of expenseRows) {
    const v = parseCurrencyBR(row.querySelector('.expense')?.value || '0');
    const d = row.querySelector('.expense-desc')?.value?.trim();
    if (v > 0 && !d) return alert('Todas as saídas com valor precisam de descrição.');
    if (v < 0)       return alert('Valor de saída não pode ser negativo.');
  }

  /* ── 3. Verificar duplicata ───────────────────────────────── */
  let existing = null;
  try {
    existing = await checkDuplicateClosing({ storeId: store.id, closingDate, shift });
  } catch (_) {
    existing = state.closings.find((c) =>
      c.storeId === store.id &&
      parseBR(c.date) === dateISO &&
      (c.shift || 'Integral') === shift &&
      (c.type === 'Original' || !c.type)
    );
  }

  let closingType      = 'Original';
  let originalClosingId = null;
  if (existing) {
    if (!confirm(
      `Já existe fechamento Original para "${store.name}" em ${toBRFromISO(dateISO)}.\n\n` +
      'Deseja registrar uma RETIFICAÇÃO?\n(Original será preservado.)\n\nOK = Retificar | Cancelar = Não salvar.'
    )) return;
    closingType      = 'Retificado';
    originalClosingId = existing.id;
  }

  /* ── 4. Snapshots e cálculos ──────────────────────────────── */
  const c              = cfg(store.companyId);
  const stdFund        = Number(store.standardFund || 0);
  const tolSnapshot    = Number(c.tolerance || 5);
  const critSnapshot   = Number(c.criticalDivergence || 20);

  const expCash  = expectedCash();
  const finalCash = finalAfterTransfer();
  const fd       = finalCash - stdFund;
  const phCount  = cashCounterTotal() + num('coinsTotal');
  const phDiv    = phCount - finalCash;
  const openRef  = openingReference();
  const openDiv  = num('initial') - Number(openRef.amount || 0);
  const status   = closingStatus(fd, store.companyId);

  /* ── 5. Divergência crítica exige observação ─────────────── */
  if (Math.abs(fd) >= critSnapshot && !val('closingNotes').trim()) {
    return alert('Divergência crítica detectada. Preencha as observações antes de salvar.');
  }
  if (Math.abs(openDiv) > tolSnapshot && !val('closingNotes').trim()) {
    return alert('Divergência de abertura acima da tolerância. Preencha as observações antes de salvar.');
  }

  /* ── 6. Montar objeto do fechamento ───────────────────────── */
  const entries = entryRows
    .map((row) => ({
      description: row.querySelector('.entry-desc')?.value?.trim() || 'Entrada em Dinheiro',
      value:       parseCurrencyBR(row.querySelector('.entry')?.value || '0'),
    }))
    .filter((x) => x.value > 0);

  const expenses = expenseRows
    .map((row) => ({
      description: row.querySelector('.expense-desc')?.value?.trim() || 'Saída',
      category:    row.querySelector('.expense-category')?.value || '',
      value:       parseCurrencyBR(row.querySelector('.expense')?.value || '0'),
    }))
    .filter((x) => x.value > 0);

  const closing = {
    id:                          uid('cl'),
    companyId:                   store.companyId,
    storeId:                     store.id,
    date:                        toBRFromISO(dateISO),
    shift,
    responsible,
    operator:                    currentUser?.name || '',
    initial:                     num('initial'),
    coinsTotal:                  num('coinsTotal'),
    cashCounterTotal:            cashCounterTotal(),
    entries:                     totalEntries(),
    entryItems:                  entries,
    expenses:                    totalExpenses(),
    expenseItems:                expenses,
    transfer:                    num('transfer'),
    expected:                    expCash,
    finalAfterTransfer:          finalCash,
    cashBalance:                 finalCash,
    standardFund:                stdFund,
    toleranceSnapshot:           tolSnapshot,
    criticalDivergenceSnapshot:  critSnapshot,
    previousClosingId:           openRef.previous?.id || null,
    previousFinalAfterTransfer:  Number(openRef.amount || 0),
    openingDivergence:           openDiv,
    openingReferenceOrigin:      openRef.origin,
    openingAdjustmentId:         openRef.adjustment?.id || null,
    diff:                        fd,
    fundDivergence:              fd,
    physicalCount:               phCount,
    physicalDivergence:          phDiv,
    balance:                     fd,
    notes:                       val('closingNotes'),
    attachments:                 closingAttachments.slice(),
    reviewStatus:                Math.abs(fd) > 0 ? 'Pendente de revisão' : 'Sem divergência',
    status,
    type:                        closingType,
    originalClosingId,
    createdAt:                   new Date().toISOString(),
  };

  /* ── 7. Salvar no state e Supabase ────────────────────────── */
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
      return alert(
        `Não foi possível salvar o fechamento.\n\n` +
        `Erro: ${e.message || 'desconhecido'}\n\n` +
        `Abra o Console do navegador (F12) para mais detalhes.`
      );
    }
  } else if (!DEV_LOCAL_MODE) {
    state.closings = state.closings.filter((x) => x.id !== closing.id);
    state.divergenceReviews = (state.divergenceReviews || []).filter((r) => r.closingId !== closing.id);
    return alert('Supabase + sessão ativa são obrigatórios em produção para salvar fechamento.');
  }

  addAudit(
    closingType === 'Retificado' ? 'Retificação de fechamento' : 'Fechamento salvo',
    `${companyName(store.companyId)} / ${store.name} — ${toBRFromISO(dateISO)}`
  );

  /* ── 8. Limpar formulário ─────────────────────────────────── */
  closingAttachments = [];
  clearAttachmentsUI();
  ['initial','coinsTotal','transfer','closingNotes'].forEach((id) =>
    setVal(id, id === 'closingNotes' ? '' : formatCurrencyBR(0))
  );
  all('.entry').forEach((e)      => { e.value = formatCurrencyBR(0); });
  all('.expense').forEach((e)    => { e.value = formatCurrencyBR(0); });
  all('.cash-count').forEach((e) => { e.value = 0; });
  const hint = $('initialBalanceHint');
  if (hint) hint.style.display = 'none';
  const badge = $('transferConfirmedBadge');
  if (badge) badge.style.display = 'none';
  const confirmBtn = $('confirmTransferBtn');
  if (confirmBtn) confirmBtn.textContent = 'Confirmar repasse';

  save();
  renderAll();
  calc();
  alert(`Fechamento ${closingType === 'Retificado' ? 'retificado' : 'salvo'} com sucesso! (Conferência 5X)`);
}

/* ================================================================
   ANEXOS
================================================================ */
function handleAttachments(files) {
  closingAttachments.push(...[...files].map((f) => ({
    name: f.name, size: f.size, type: f.type, lastModified: f.lastModified,
  })));
  renderAttachments();
}

function renderAttachments() {
  html('attachmentList', closingAttachments.length
    ? closingAttachments.map((f) =>
        `<div class="attachment-item">${esc(f.name)} <span class="subtle">${Math.round(f.size / 1024)} KB</span></div>`
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
  selectedStore, totalEntries, totalExpenses,
  cashCounterTotal, coinCounterTotal,
  expectedCash, finalAfterTransfer, fundDivergence,
  physicalCount, physicalDivergence, closingStatus,
  suggestedTransfer, useSuggestedTransfer,
  selectedShift, findPreviousClosing, findOpeningAdjustment, openingReference, openingDivergence,
  syncCoinCountTotal, suggestInitialBalance, calc,
  addEntry, addExpense, removeLaunchRow,
  ensureExpenseCategories, renderCashCounter,
  confirmTransfer, saveClosing, saveOpeningAdjustment, reviewDivergence, createDivergenceReviews,
  handleAttachments, renderAttachments, clearAttachmentsUI,
});
