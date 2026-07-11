'use strict';
/* ============================================================
   ORQUESTRADOR PRINCIPAL — Caixa 5X
   Este arquivo apenas inicializa e conecta os módulos.
   Toda a lógica está distribuída em:
     utils.js | supabaseClient.js | auth.js | permissions.js
     db.js    | closing.js        | reports.js | render.js
============================================================ */

/* --- Modal: fechamento original (retificações) --- */
function openOriginalClosingModal(originalId) {
  const modal = $('originalClosingModal');
  if (!modal) return;
  const orig = (state?.closings || []).find((c) => c.id === originalId);
  const body = $('origModalBody');
  if (body) {
    body.innerHTML = orig
      ? `<table class="table"><tbody>
          <tr><th>Data</th><td>${esc(orig.date)}</td></tr>
          <tr><th>Loja</th><td>${esc(storeName(orig.storeId))}</td></tr>
          <tr><th>Turno</th><td>${esc(orig.shift || 'Integral')}</td></tr>
          <tr><th>Responsável</th><td>${esc(orig.responsible)}</td></tr>
          <tr><th>Saldo inicial</th><td>${money(orig.initial)}</td></tr>
          <tr><th>Entradas</th><td>${money(orig.entries)}</td></tr>
          <tr><th>Saídas</th><td>${money(orig.expenses)}</td></tr>
          <tr><th>Repasse</th><td>${money(orig.transfer)}</td></tr>
          <tr><th>Saldo final</th><td>${money(orig.finalAfterTransfer)}</td></tr>
          <tr><th>Divergência</th><td>${money(orig.fundDivergence ?? orig.diff)}</td></tr>
          <tr><th>Status</th><td>${tag(orig.status)}</td></tr>
          ${orig.notes ? `<tr><th>Observações</th><td>${esc(orig.notes)}</td></tr>` : ''}
        </tbody></table>`
      : '<p class="subtle">Fechamento original não encontrado neste dispositivo.</p>';
  }
  modal.style.display = 'flex';
}

function closeOriginalClosingModal() {
  const modal = $('originalClosingModal');
  if (modal) modal.style.display = 'none';
}

async function init() {
  text('autosaveStatus', 'Carregando...');

  /* Carrega dados */
  await load();

  /* Fecha eventos globais */
  bindGlobalEvents();

  /* Restaura login lembrado (sem senha) */
  const remembered = localStorage.getItem('caixa5x_remember');
  if (remembered) setVal('loginUser', remembered);

  /* Data padrão do fechamento */
  setVal('closingDate', todayISO());

  /* Popula selects estáticos */
  fillSelects();
  renderAll();
  bindCurrencyInputs();
  if (window.bindClosingEvents) bindClosingEvents();

  /* Status de conexão */
  text('autosaveStatus', sb ? 'Supabase conectado' : 'Modo local');
  setTimeout(() => text('autosaveStatus', 'Autosave ativo'), 1500);

  /* Tenta retomar sessão Supabase ativa */
  if (sb) {
    const prof = await checkActiveSession();
    if (prof && prof.status !== 'Inativo') {
      /* Sessão ativa: entra direto sem exibir login */
      window.role = prof.role;
      document.body.classList.toggle('role-operator', prof.role === 'operator');
      window.currentUser = {
        id: prof.id, authId: prof.user_id,
        name: prof.name, email: prof.email,
        role: prof.role, companyId: prof.company_id, storeId: prof.store_id,
      };
      await load();
      $('loginScreen').style.display = 'none';
      $('app').style.display = 'grid';
      /* botão toggle agora está inline no header — sem referência ao mobileMenuBtn */
      setupMenu();
      setupRealtimeSync();
      renderAll();
      bindCurrencyInputs();
      if (window.bindClosingEvents) bindClosingEvents();
      const page = role === 'master' ? 'dashboard' : firstAllowedPage();
      if (page) showPage(page, document.querySelector(`.nav button[data-page="${page}"]`));
    }
  }

  window.isBooting = false;
}

function bindGlobalEvents() {
  /* Autosave em qualquer input fora do login */
  document.addEventListener('input', (e) => {
    if (e.target.closest('#loginScreen')) return;
    if (e.target.matches('input,textarea,select')) autosave();
    if (window.resetSessionTimer) resetSessionTimer();
  });

  /* Draftmodule no change de módulos */
  document.addEventListener('change', (e) => {
    if (e.target.closest('#loginScreen')) return;
    if (e.target.matches('[data-module-key],#moduleAccessStatus')) draftModules();
  });

  /* Tecla Enter no login */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && $('loginScreen')?.style.display !== 'none') {
      enterApp();
    }
  });

  /* Editar/Excluir de Fornecedores, Categorias e Clientes (aba Sistema → Configurações).
     Usa data-attributes (HTML-escapados) em vez de onclick com o valor interpolado,
     para não quebrar quando o nome cadastrado tem aspas/apóstrofo. */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-opt-action]');
    if (!btn) return;
    const { optAction, optCategory, optCompany, optValue } = btn.dataset;
    if (optAction === 'remove') removeCompanyOption(optCategory, optCompany, optValue);
    else if (optAction === 'edit') promptRenameCompanyOption(optCategory, optCompany, optValue);
  });

  /* Editar/Excluir na tela genérica "Opções das caixas de seleção" (Sistema → Configurações). */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-gopt-action]');
    if (!btn) return;
    const { goptAction, goptKey, goptValue } = btn.dataset;
    if (goptAction === 'remove') removeSelectOption(goptKey, goptValue);
    else if (goptAction === 'edit') promptRenameSelectOption(goptKey, goptValue);
  });
}

/* Sidebar compacta (hover) por padrão no desktop */
function initSidebarBehavior() {
  if (window.innerWidth > 1100) {
    document.querySelector('.app')?.classList.add('sidebar-hover');
  }
}

/* Carrega a app quando o DOM estiver pronto */
document.addEventListener('DOMContentLoaded', () => { init(); initSidebarBehavior(); });

/* ============================================================
   EXPOSIÇÃO GLOBAL EXPLÍCITA
   Necessário para onclick inline no HTML.
============================================================ */
Object.assign(window, {
  /* Auth */
  enterApp, logout, togglePassword, toggleRemember, forgotPassword, openSupport,
  changePassword, submitChangePassword, closeChangePasswordModal,

  /* Modais */
  openOriginalClosingModal, closeOriginalClosingModal,

  /* Navegação + módulos (permissions.js) */
  showPage, showSubTab, toggleSidebar, closeSidebar, switchCentral,
  renderSidebarByPermissions, applyModuleAccess, setupMenu,
  onParentModuleChange, draftModules, saveModules,
  manualRefresh,

  /* DB / CRUD */
  save,
  saveClientSetup, clearClientSetup, toggleCompany, deleteCompany,
  createStore, updateStoreFund, deleteStore, loadStoreToEdit, saveStoreEdit, closeEditStoreModal,
  createUserFromMaster, toggleUserStore, fillStoreSelect, fillUserManageSelect,
  loadUserToEdit, fillEditUserStore, saveUserEdit,
  resetSelectedUserPassword, deleteSelectedUser, deleteUser,
  createRule, deleteRule, renderRulesByCompany: renderOperacao,
  saveImplantStep, upsertImplantStep, saveOperationConfig,
  addSelectOption, removeSelectOption, resetSelectOptions,
  openLimparDadosModal, closeLimparDadosModal, clearCompanyData,
  exportBackup, importBackup, resetSystem,

  /* Selects */
  fillMasterDivergenceStore, fillMasterExtractStore, fillMasterMovementStore,
  fillReportStore, fillClosingResponsible5X,

  /* Render */
  renderAll, renderModuleManager, renderUsersByCompany,
  renderMasterMovementsExtract: () => renderFechamentos(),

  /* Repasses */
  confirmTransferReceipt, getTransferReceipts,

  /* Fechamento */
  addEntry, addExpense, removeLaunchRow, calc,
  suggestInitialBalance, suggestedTransfer, useSuggestedTransfer,
  bindClosingEvents,
  confirmTransfer, handleSaveClosingClick, saveClosing, saveOpeningAdjustment, reviewDivergence, handleAttachments,
  /* Formatação — usadas por onblur/onfocus inline */
  formatCurrencyInput, selectOnFocus, parseCurrencyBR, bindCurrencyInputs,

  /* Exportações */
  exportCSV, exportDivergencesCSV, exportTransfersCSV, exportExpensesCSV,
  exportAuditCSV, exportClientMovementsCSV, exportClientDivergencesCSV,
  exportContaAzulXLSX, exportConsolidadoCSV,
});

/* PWA: registra o service worker com segurança — não bloqueia nem quebra o app */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  });
}
