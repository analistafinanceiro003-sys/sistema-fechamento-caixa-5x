'use strict';
/* ============================================================
   UTILITÁRIOS COMPARTILHADOS — Caixa 5X
   Funções puras sem dependências de estado global.
============================================================ */

/* --- DOM helpers --- */
const $ = (id) => document.getElementById(id);
const all = (sel, root = document) => [...root.querySelectorAll(sel)];
const val = (id) => $(id)?.value ?? '';
const setVal = (id, value) => {
  const el = $(id);
  if (!el) return;
  el.value = value ?? '';
  /* Selects de empresa com busca (searchableSelect.js) têm um input visual
     separado do <select> real — sem isso, ele ficaria mostrando o valor
     antigo quando o valor é setado por código (não por clique do usuário). */
  if (window.syncSearchableSelectDisplay) syncSearchableSelectDisplay(id);
};
const html = (id, value) => { const el = $(id); if (el) el.innerHTML = value ?? ''; };
const text = (id, value) => { const el = $(id); if (el) el.textContent = value ?? ''; };
const clear = (id) => setVal(id, '');

/* ============================================================
   FUNÇÕES DE MOEDA
   Padrão: 1.234,56 R$ na interface; 1234.56 nos cálculos.
============================================================ */

/* Converte qualquer valor de texto em número limpo.
   Aceita: "1.234,56 R$" / "R$ 1.234,56" / "1234,56" / "1234.56" / 1234.56 / "" */
function parseCurrencyBR(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return isNaN(value) ? 0 : value;

  let s = String(value).replace(/R\$\s?/g, '').replace(/\s/g, '').replace(/[^\d,.-]/g, '').trim();
  if (!s) return 0;
  const negative = s.startsWith('-');
  s = s.replace(/-/g, '');

  /* "1.234,56" → ponto é milhar, vírgula é decimal */
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes('.')) {
    /* "1.234" (sem vírgula): ponto é milhar se ≥ 4 chars antes do ponto */
    const parts = s.split('.');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3)) {
      s = s.replace(/\./g, ''); // remove ponto de milhar
    }
    /* senão: "123.45" → ponto é decimal → deixa como está */
  }

  const n = parseFloat(s);
  return isNaN(n) ? 0 : (negative ? -n : n);
}

/* Alias normalizado: qualquer entrada → número seguro */
function normalizeMoney(value) {
  return parseCurrencyBR(value);
}

/* Formata número como "1.234,56 R$" */
function formatCurrencyBR(value) {
  return Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' R$';
}

/* Alias: money() continua sendo a função principal */
const money = formatCurrencyBR;

/* Lê o campo pelo id e retorna número limpo (suporta formatação de moeda) */
const num = (id) => parseCurrencyBR(val(id));

/* Handler de blur: formata o campo como "1.234,56" (sem R$) para facilitar edição */
function formatCurrencyInput(input) {
  const v = parseCurrencyBR(input.value);
  if (v < 0) { input.value = formatCurrencyBR(0); return; }
  input.value = formatCurrencyBR(v);
  /* Dispara oninput para recalcular se houver listener */
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/* Handler de focus: seleciona o conteúdo para facilitar substituição */
function selectOnFocus(input) {
  setTimeout(() => input.select(), 0);
}

function bindCurrencyInputs(root = document) {
  all('input[data-money="br"], input.entry, input.expense', root).forEach((input) => {
    input.type = 'text';
    input.inputMode = 'decimal';
    input.pattern = '[0-9]*[,.]?[0-9]*';
    if (!input.dataset.moneyBound) {
      input.addEventListener('blur', () => formatCurrencyInput(input));
      input.addEventListener('focus', () => selectOnFocus(input));
      input.dataset.moneyBound = '1';
    }
    if (!input.value) input.value = formatCurrencyBR(0);
  });
}

/* ============================================================
   FUNÇÕES DE DATA
   Interface: dd/mm/aaaa  |  Banco/cálculo: yyyy-mm-dd
============================================================ */
/* Constrói um Date à meia-noite LOCAL a partir de "yyyy-mm-dd". Usar
   `new Date('yyyy-mm-dd')` diretamente interpreta a string como UTC e
   desalinha em fusos negativos (ex: Brasil, GMT-3) — à noite, o dia UTC já
   virou o seguinte. */
const dateFromISO = (iso) => {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  return (y && m && d) ? new Date(y, m - 1, d) : new Date(NaN);
};
/* Date → "yyyy-mm-dd" pelo calendário LOCAL (não toISOString(), que é UTC). */
const dateToISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayISO = () => dateToISO(new Date());
const todayBR  = () => new Date().toLocaleDateString('pt-BR');

/* dd/mm/aaaa ou yyyy-mm-dd → yyyy-mm-dd */
const parseBR = (date) => {
  if (!date) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const [d, m, y] = String(date).split('/');
  return y && m && d ? `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}` : '';
};

/* yyyy-mm-dd → dd/mm/aaaa */
const toBRFromISO = (date) =>
  date ? new Date(`${date}T00:00:00`).toLocaleDateString('pt-BR') : todayBR();

/* Aliases explícitos pedidos no spec */
const formatDateBR  = toBRFromISO;
const parseDateBR   = parseBR;
const toISODate     = parseBR;

/* Valida intervalo de datas. Retorna mensagem de erro ou null se OK. */
function validateDateRange(startISO, endISO) {
  if (!startISO || !endISO) return null;
  if (startISO > endISO) return 'A data inicial não pode ser maior que a data final.';
  return null;
}

/* Lê dois campos de data e retorna {startISO, endISO, error} */
function readDateRange(startId, endId) {
  const startISO = parseBR(val(startId));
  const endISO   = parseBR(val(endId));
  const error    = validateDateRange(startISO, endISO);
  return { startISO, endISO, error };
}

/* ============================================================
   GERAÇÃO DE IDs
============================================================ */
const uid = (prefix = 'id') =>
  `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

/* ============================================================
   SEGURANÇA HTML
============================================================ */
const esc = (v) =>
  String(v ?? '').replace(/[&<>'"]/g, (c) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', "'": '&#39;', '"':'&quot;',
  }[c]));

/* ============================================================
   TABELAS / BADGES
============================================================ */
const emptyRow = (cols, msg = 'Nenhum registro encontrado.') =>
  `<tr><td colspan="${cols}" class="subtle" style="text-align:center;padding:20px">${msg}</td></tr>`;

const tag = (value) => {
  const s = String(value || '-');
  const cls = /crítica|inativo|reprovado/i.test(s) ? 'danger'
    : /divergência|pendente|implantação|pausada/i.test(s) ? 'warning'
    : /ativo|concluído|sem divergência|tolerância/i.test(s) ? 'success'
    : 'info';
  return `<span class="status ${cls}">${esc(s)}</span>`;
};

/* ============================================================
   FLASH / DOWNLOAD / CSV
============================================================ */
function flash(message = 'Salvo') {
  text('autosaveStatus', message);
  setTimeout(() => text('autosaveStatus', 'Autosave ativo'), 1800);
}

function toast(message, type = 'success', duration = 3500) {
  const container = $('toastContainer');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-visible'));
  setTimeout(() => {
    el.classList.remove('toast-visible');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
  }, duration);
}

function downloadFile(filename, content, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function csvCell(v) {
  const s = String(v ?? '').replace(/"/g, '""');
  return `"${s}"`;
}

function buildCSV(headers, rows) {
  const lines = [headers.map(csvCell).join(';')];
  rows.forEach((r) => lines.push(headers.map((h) => csvCell(r[h])).join(';')));
  return `﻿${lines.join('\n')}`;
}

function exportGenericCSV(filename, headers, rows) {
  downloadFile(filename, buildCSV(headers, rows), 'text/csv;charset=utf-8');
}

/* ============================================================
   NAVEGAÇÃO ENTRE SUB-ABAS
   (a versão com proteção de permissão fica em permissions.js)
   Esta versão simples é usada quando permissions ainda não carregou.
============================================================ */
function showSubTab(pageId, tabId, btn) {
  /* Delega para a versão segura em permissions.js se disponível */
  if (window._safeShowSubTab) { window._safeShowSubTab(pageId, tabId, btn); return; }
  const page = $(pageId); if (!page) return;
  page.querySelectorAll('.inner-tab-panel').forEach((p) => p.classList.add('hidden'));
  $(tabId)?.classList.remove('hidden');
  page.querySelectorAll('.inner-tab-btn').forEach((b) => b.classList.remove('active'));
  btn?.classList.add('active');
}

/* Tooltip flutuante — usado pelo botão ⓘ nas tabelas */
function showInfoTooltip(el) {
  const tip = document.getElementById('infoTooltip');
  if (!tip) return;
  tip.textContent = el.dataset.tooltip || '';
  tip.style.display = 'block';
  const rect = el.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  if (left < 8) left = 8;
  if (left + tipRect.width > window.innerWidth - 8) left = window.innerWidth - tipRect.width - 8;
  let top = rect.top - tipRect.height - 10;
  if (top < 8) top = rect.bottom + 10;
  tip.style.left = left + 'px';
  tip.style.top  = top + 'px';
}
function hideInfoTooltip() {
  const tip = document.getElementById('infoTooltip');
  if (tip) tip.style.display = 'none';
}

/* Exposição global */
Object.assign(window, {
  $, all, val, setVal, html, text, clear, num,
  money, formatCurrencyBR, parseCurrencyBR, normalizeMoney,
  formatCurrencyInput, selectOnFocus, bindCurrencyInputs,
  todayISO, todayBR, parseBR, toBRFromISO, dateFromISO, dateToISO,
  formatDateBR, parseDateBR, toISODate,
  validateDateRange, readDateRange,
  uid, esc, emptyRow, tag, flash, toast, downloadFile,
  csvCell, buildCSV, exportGenericCSV, showSubTab,
  showInfoTooltip, hideInfoTooltip,
});
