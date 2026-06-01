'use strict';
/* ============================================================
   ORQUESTRADOR PRINCIPAL — Caixa 5X
   Este arquivo apenas inicializa e conecta os módulos.
   Toda a lógica está distribuída em:
     utils.js | supabaseClient.js | auth.js | permissions.js
     db.js    | closing.js        | reports.js | render.js
============================================================ */

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
  saveImplantStep, saveOperationConfig,
  addSelectOption, removeSelectOption, resetSelectOptions,
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
  exportContaAzulCSV, exportConsolidadoCSV,
});

/* PWA: registra o service worker com segurança — não bloqueia nem quebra o app */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  });
}
