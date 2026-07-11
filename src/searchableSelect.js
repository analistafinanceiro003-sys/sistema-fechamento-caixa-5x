'use strict';
/* ============================================================
   SELECT DE EMPRESA COM BUSCA — Caixa 5X
   Camada de reforço visual sobre os <select> de empresa existentes:
   mantém o <select> original no DOM (mesmo id, mesmo value, mesmo
   onchange) para não quebrar nada que já lê/popula esses campos —
   apenas sobrepõe um campo de texto com busca que sincroniza de volta
   para o <select> real. Funciona com qualquer quantidade de empresas,
   inclusive as que ainda serão cadastradas (lê as <option> ao abrir).
============================================================ */

/* IDs dos <select> de empresa espalhados pelo sistema (Cadastros,
   Operação, Fechamentos & Clientes, Relatórios e Sistema). */
const COMPANY_SELECT_IDS = [
  'storeCompany', 'editStoreCompany', 'opCompany', 'userManageCompany',
  'usersCompanyFilter', 'implantCompanyFilter', 'ruleCompany', 'ruleFilterCompany',
  'operationCompany', 'moduleCompany', 'masterMovementCompanyFilter',
  'masterExtractCompany', 'masterResumoCompany', 'masterRepasseCompany',
  'masterDivergenceCompanyFilter', 'reportCompany', 'optionCompany',
  'fcCompanyFilter', 'docFilterCompany', 'openingAdjustmentCompany',
];

function enhanceSearchableSelect(select) {
  if (!select || select.dataset.searchEnhanced) return;
  select.dataset.searchEnhanced = '1';

  const wrap = document.createElement('div');
  wrap.className = 'searchable-select-wrap';
  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(select);
  select.classList.add('searchable-select-native');
  select.tabIndex = -1;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'searchable-select-input';
  input.placeholder = 'Buscar empresa...';
  input.autocomplete = 'off';
  wrap.appendChild(input);

  const list = document.createElement('div');
  list.className = 'searchable-select-list hidden';
  wrap.appendChild(list);

  const currentLabel = () => select.options[select.selectedIndex]?.textContent || '';
  const syncInputFromSelect = () => { input.value = currentLabel(); };

  function buildList(term) {
    const q = (term || '').trim().toLowerCase();
    const opts = [...select.options];
    const matches = q ? opts.filter((o) => o.textContent.toLowerCase().includes(q)) : opts;
    list.innerHTML = matches.map((o) =>
      `<div class="searchable-select-item${o.value === select.value ? ' active' : ''}" data-value="${esc(o.value)}">${esc(o.textContent)}</div>`
    ).join('') || '<div class="searchable-select-empty">Nenhuma empresa encontrada</div>';
  }

  const openList = () => { buildList(''); list.classList.remove('hidden'); };
  const closeList = () => list.classList.add('hidden');

  input.addEventListener('focus', () => { input.select(); openList(); });
  input.addEventListener('input', () => { buildList(input.value); list.classList.remove('hidden'); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { syncInputFromSelect(); closeList(); input.blur(); }
  });

  list.addEventListener('mousedown', (e) => {
    const item = e.target.closest('.searchable-select-item');
    if (!item) return;
    e.preventDefault();
    select.value = item.dataset.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    syncInputFromSelect();
    closeList();
  });

  document.addEventListener('mousedown', (e) => {
    if (!wrap.contains(e.target)) closeList();
  });

  /* setOptions() reescreve o innerHTML do <select> a qualquer momento
     (troca de empresa cadastrada, filtro, etc.) — mantém o texto exibido
     em dia mesmo quando a mudança não passa pelo mousedown acima. */
  new MutationObserver(syncInputFromSelect).observe(select, { childList: true, attributes: true, attributeFilter: ['value'] });

  syncInputFromSelect();
}

function enhanceAllCompanySelects() {
  COMPANY_SELECT_IDS.forEach((id) => enhanceSearchableSelect($(id)));
}

Object.assign(window, { enhanceAllCompanySelects });
