'use strict';
/* ============================================================
   CONTA AZUL — OAuth + prévia de aprovação
   O envio final fica no backend após configurar mapeamentos por ID.
============================================================ */

let contaAzulPreviewRows = [];
let contaAzulCatalogRows = [];
let contaAzulCompanyStatusCache = {};
let contaAzulCompanyStatusLoading = false;
let contaAzulCompanyStatusLoadedAt = 0;
let contaAzulFinancialAccountRows = [];

function currentContaAzulCompanyId() {
  if (role === 'admin') return currentUser?.companyId || '';
  return val('reportCompany') || '';
}

function currentContaAzulCompanyName() {
  return companyName(currentContaAzulCompanyId()) || 'empresa selecionada';
}

function setContaAzulStatus(message, kind = '') {
  ['contaAzulStatusMaster'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.textContent = message;
    el.style.color = kind === 'success' ? 'var(--success)' : kind === 'error' ? 'var(--danger)' : '';
  });
}

async function invokeContaAzulFunction(name, payload = {}) {
  if (!sb || USE_LOCAL_FALLBACK) throw new Error('Supabase é obrigatório para conectar o Conta Azul.');
  const { data, error } = await sb.functions.invoke(name, { body: payload });
  if (error) {
    let message = error.message || 'Falha na função Conta Azul.';
    if (error.context && typeof error.context.json === 'function') {
      try {
        const body = await error.context.json();
        if (body?.error) message = body.error;
      } catch (_) { /* corpo não era JSON, mantém mensagem genérica */ }
    }
    throw new Error(message);
  }
  if (data && data.ok === false) throw new Error(data.error || 'Operação Conta Azul recusada.');
  return data;
}

function refreshContaAzulSelectedCompanyStatus() {
  const companyId = currentContaAzulCompanyId();
  if (!companyId) return setContaAzulStatus('Conta Azul: selecione a empresa que deseja conectar.');
  setContaAzulStatus(`Conta Azul: pronto para conectar ${currentContaAzulCompanyName()}. Use o usuario Conta Azul desta empresa no login.`);
}

function applyContaAzulRoleControls() {
  all('.conta-azul-admin-control').forEach((el) => {
    el.style.display = role === 'analyst' ? 'none' : '';
  });
}

async function connectContaAzul() {
  const companyId = currentContaAzulCompanyId();
  const company = currentContaAzulCompanyName();
  if (!companyId) return alert('Selecione uma empresa no filtro do relatório antes de conectar.');
  const confirmed = confirm(`Conectar Conta Azul para: ${company}\n\nNa tela da Conta Azul, entre com o usuario dessa mesma empresa. Se o navegador abrir outra conta automaticamente, saia da Conta Azul e tente novamente.`);
  if (!confirmed) return;
  const popup = window.open('', '_blank', 'width=980,height=760');
  try {
    setContaAzulStatus(`Conta Azul: abrindo autorizacao para ${company}...`);
    const data = await invokeContaAzulFunction('conta-azul-auth-start', { company_id: companyId });
    if (!data?.authorization_url) throw new Error('URL de autorização não retornada.');
    if (popup && !popup.closed) {
      popup.location.href = data.authorization_url;
    } else if (!window.open(data.authorization_url, '_blank', 'width=980,height=760')) {
      throw new Error('Pop-up bloqueado pelo navegador. Permita pop-ups para este site e tente novamente.');
    }
    setContaAzulStatus(`Conta Azul: autorizacao aberta para ${company}. Conclua o login usando o usuario Conta Azul desta empresa.`);
  } catch (e) {
    if (popup && !popup.closed) popup.close();
    setContaAzulStatus('Conta Azul: ' + (e.message || 'erro ao iniciar conexão.'), 'error');
    alert('Não foi possível iniciar a conexão Conta Azul: ' + (e.message || 'tente novamente.'));
  }
}

function parseContaAzulAuthInput(input) {
  const raw = String(input || '').trim();
  if (!raw) return {};
  try {
    const parsed = new URL(raw);
    return {
      code: parsed.searchParams.get('code') || '',
      state: parsed.searchParams.get('state') || '',
    };
  } catch (_) {
    const params = new URLSearchParams(raw.replace(/^[?#]/, ''));
    return {
      code: params.get('code') || raw,
      state: params.get('state') || '',
    };
  }
}

async function finishContaAzulManualAuth() {
  const pasted = prompt('Cole aqui a URL completa da barra do navegador da Conta Azul depois do login.');
  if (!pasted) return;
  const { code, state } = parseContaAzulAuthInput(pasted);
  if (!code) return alert('Nao encontrei o code de autorizacao. Copie a URL completa que ficou na barra do navegador depois do login.');
  if (!state) return alert('Nao encontrei o state. Cole a URL completa da barra do navegador para validar a autorizacao com seguranca.');
  try {
    setContaAzulStatus('Conta Azul: validando codigo de autorizacao...');
    await invokeContaAzulFunction('conta-azul-auth-code', { code, state });
    setContaAzulStatus('Conta Azul: conectado com sucesso.', 'success');
    toast('Conta Azul conectada com sucesso.');
  } catch (e) {
    setContaAzulStatus('Conta Azul: ' + (e.message || 'erro ao validar codigo.'), 'error');
    alert('Nao foi possivel concluir a conexao Conta Azul: ' + (e.message || 'tente novamente.'));
  }
}

async function finishContaAzulAuthFromUrl() {
  const params = new URLSearchParams(window.location.search || '');
  const code = params.get('code') || '';
  const state = params.get('state') || '';
  if (!code || !state) return false;
  try {
    setContaAzulStatus('Conta Azul: finalizando conexao...');
    await invokeContaAzulFunction('conta-azul-auth-code', { code, state });
    setContaAzulStatus('Conta Azul: conectado com sucesso.', 'success');
    toast('Conta Azul conectada com sucesso.');
    window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
    return true;
  } catch (e) {
    setContaAzulStatus('Conta Azul: ' + (e.message || 'erro ao finalizar conexao.'), 'error');
    return false;
  }
}

async function checkContaAzulStatus() {
  const companyId = currentContaAzulCompanyId();
  if (!companyId) return setContaAzulStatus('Conta Azul: selecione uma empresa para verificar.', 'error');
  if (!sb || USE_LOCAL_FALLBACK) return setContaAzulStatus('Conta Azul: Supabase obrigatório para verificar conexão.', 'error');
  try {
    const { data, error } = await sb
      .from('conta_azul_connections')
      .select('status, connected_at, expires_at, last_error')
      .eq('company_id', companyId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return setContaAzulStatus('Conta Azul: empresa ainda não conectada.');
    if (data.status === 'Conectado') {
      const connectedAt = data.connected_at ? new Date(data.connected_at).toLocaleString('pt-BR') : '-';
      return setContaAzulStatus(`Conta Azul: conectado em ${connectedAt}.`, 'success');
    }
    setContaAzulStatus(`Conta Azul: ${data.status}${data.last_error ? ' — ' + data.last_error : ''}`, 'error');
  } catch (e) {
    setContaAzulStatus('Conta Azul: não foi possível consultar a conexão.', 'error');
  }
}

async function loadContaAzulCompanyStatuses() {
  if (!sb || USE_LOCAL_FALLBACK || role !== 'master' || contaAzulCompanyStatusLoading) return;
  contaAzulCompanyStatusLoading = true;
  const companyIds = visibleCompanies().map((c) => c.id);
  try {
    if (!companyIds.length) return;
    const [connections, catalog] = await Promise.all([
      sb.from('conta_azul_connections').select('company_id, status, connected_at, last_error').in('company_id', companyIds),
      sb.from('conta_azul_catalog_items').select('company_id, kind, synced_at').in('company_id', companyIds),
    ]);
    if (connections.error && catalog.error) return;
    const next = {};
    (connections.data || []).forEach((row) => {
      next[row.company_id] = { ...(next[row.company_id] || {}), connection: row };
    });
    (catalog.data || []).forEach((row) => {
      const current = next[row.company_id] || {};
      const syncedAt = current.synced_at && new Date(current.synced_at) > new Date(row.synced_at) ? current.synced_at : row.synced_at;
      next[row.company_id] = {
        ...current,
        item_count: Number(current.item_count || 0) + 1,
        synced_at: syncedAt,
      };
    });
    contaAzulCompanyStatusCache = next;
    contaAzulCompanyStatusLoadedAt = Date.now();
  } finally {
    contaAzulCompanyStatusLoading = false;
  }
}

function refreshContaAzulCompanyStatusesIfNeeded(force = false) {
  if (role !== 'master') return;
  if (!force && Date.now() - contaAzulCompanyStatusLoadedAt < 60 * 1000) return;
  loadContaAzulCompanyStatuses().then(() => {
    if (window.renderCadastros) renderCadastros();
  });
}

function contaAzulCompanyStatusHtml(companyId) {
  const data = contaAzulCompanyStatusCache[companyId] || {};
  const connection = data.connection;
  const connected = connection?.status === 'Conectado';
  const count = Number(data.item_count || 0);
  const synced = data.synced_at ? new Date(data.synced_at).toLocaleDateString('pt-BR') : '';
  const status = connected ? '<span class="status success">Conectado</span>' : '<span class="status warning">Pendente</span>';
  const syncText = count ? `${count} item(ns) sinc.${synced ? ' em ' + synced : ''}` : 'Sem sincronização';
  const syncButton = role === 'master'
    ? `<button class="btn btn-sm btn-icon" title="Sincronizar cadastros Conta Azul" onclick="syncContaAzulCatalogForCompany('${esc(companyId)}')">↻</button>`
    : '';
  return `<div class="ca-company-cell">${status}<span class="subtle">${esc(syncText)}</span>${syncButton}</div>`;
}

async function syncContaAzulCatalogForCompany(companyId) {
  if (role !== 'master') return alert('Apenas Master pode sincronizar cadastros Conta Azul.');
  if (!companyId) return;
  const previous = val('caCatalogCompany');
  if ($('caCatalogCompany')) setVal('caCatalogCompany', companyId);
  try {
    await syncContaAzulCatalog(companyId);
    await loadContaAzulCompanyStatuses();
    if (window.renderCadastros) renderCadastros();
  } finally {
    if ($('caCatalogCompany') && previous && previous !== companyId) setVal('caCatalogCompany', previous);
  }
}

function contaAzulCatalogCompanyId() {
  if (role === 'admin') return currentUser?.companyId || '';
  return val('caCatalogCompany') || '';
}

function renderContaAzulCatalog() {
  if (!$('caCatalogCompany')) return;
  setOptions('caCatalogCompany', visibleCompanies().map((c) => [c.id, c.name]), 'Selecione a empresa');
  if (role === 'admin' && currentUser?.companyId) setVal('caCatalogCompany', currentUser.companyId);
  renderContaAzulCatalogTables();
}

function setContaAzulCatalogStatus(message, kind = '') {
  const el = $('caCatalogStatus');
  if (!el) return;
  el.textContent = message;
  el.style.color = kind === 'success' ? 'var(--success)' : kind === 'error' ? 'var(--danger)' : '';
}

async function loadContaAzulCatalog() {
  const companyId = contaAzulCatalogCompanyId();
  if (!companyId) {
    contaAzulCatalogRows = [];
    setContaAzulCatalogStatus('Selecione uma empresa.');
    return renderContaAzulCatalogTables();
  }
  if (!sb || USE_LOCAL_FALLBACK) {
    setContaAzulCatalogStatus('Supabase obrigatorio para consultar cadastros Conta Azul.', 'error');
    return;
  }
  setContaAzulCatalogStatus('Carregando cadastros sincronizados...');
  const { data, error } = await sb
    .from('conta_azul_catalog_items')
    .select('id, company_id, external_id, kind, name, allowed_for_operator, active, synced_at')
    .eq('company_id', companyId)
    .order('kind', { ascending: true })
    .order('name', { ascending: true });
  if (error) {
    contaAzulCatalogRows = [];
    setContaAzulCatalogStatus('Nao foi possivel carregar cadastros Conta Azul.', 'error');
    return renderContaAzulCatalogTables();
  }
  contaAzulCatalogRows = data || [];
  setContaAzulCatalogStatus(`${contaAzulCatalogRows.length} item(ns) sincronizado(s).`, 'success');
  renderContaAzulCatalogTables();
}

async function syncContaAzulCatalog(companyIdOverride = '') {
  const companyId = companyIdOverride || contaAzulCatalogCompanyId();
  if (!companyId) return alert('Selecione a empresa para sincronizar.');
  if (!confirm(`Sincronizar cadastros do Conta Azul para ${companyName(companyId)}?\n\nIsto nao altera os cadastros operacionais atuais.`)) return;
  try {
    setContaAzulCatalogStatus('Sincronizando cadastros do Conta Azul...');
    const data = await invokeContaAzulFunction('conta-azul-sync-catalog', { company_id: companyId });
    const total = data.total || 0;
    setContaAzulCatalogStatus(`${total} item(ns) sincronizado(s) do Conta Azul.`, 'success');
    if (!companyIdOverride) await loadContaAzulCatalog();
  } catch (e) {
    setContaAzulCatalogStatus(e.message || 'Erro ao sincronizar Conta Azul.', 'error');
    alert('Nao foi possivel sincronizar cadastros Conta Azul: ' + (e.message || 'tente novamente.'));
  }
}

async function loadContaAzulFinancialAccounts(companyId) {
  const select = $('contaAzulAccountSelect');
  if (!select) return;
  select.innerHTML = '<option value="">Selecione a conta sincronizada</option>';
  contaAzulFinancialAccountRows = [];
  if (!companyId || !sb || USE_LOCAL_FALLBACK) return;
  const { data, error } = await sb
    .from('conta_azul_catalog_items')
    .select('external_id, name')
    .eq('company_id', companyId)
    .eq('kind', 'conta_financeira')
    .eq('active', true)
    .order('name', { ascending: true });
  if (error) {
    console.warn('Nao foi possivel carregar contas financeiras Conta Azul.', error);
    return;
  }
  contaAzulFinancialAccountRows = data || [];
  contaAzulFinancialAccountRows.forEach((account) => {
    const option = document.createElement('option');
    option.value = account.external_id || '';
    option.textContent = account.name || account.external_id || '';
    select.appendChild(option);
  });
}

function renderContaAzulCatalogTables() {
  const groups = [
    ['fornecedor', 'caCatalogFornecedorBody', 'caCatalogFornecedorCount', 'caCatalogFornecedorSearch', 'Nenhum fornecedor sincronizado.'],
    ['categoria_saida', 'caCatalogCategoriaSaidaBody', 'caCatalogCategoriaSaidaCount', 'caCatalogCategoriaSaidaSearch', 'Nenhuma categoria de saida sincronizada.'],
    ['cliente', 'caCatalogClienteBody', 'caCatalogClienteCount', 'caCatalogClienteSearch', 'Nenhum cliente sincronizado.'],
    ['categoria_entrada', 'caCatalogCategoriaEntradaBody', 'caCatalogCategoriaEntradaCount', 'caCatalogCategoriaEntradaSearch', 'Nenhuma categoria de entrada sincronizada.'],
    ['conta_financeira', 'caCatalogContaFinanceiraBody', 'caCatalogContaFinanceiraCount', 'caCatalogContaFinanceiraSearch', 'Nenhuma conta financeira sincronizada.'],
    ['centro_custo', 'caCatalogCentroCustoBody', 'caCatalogCentroCustoCount', 'caCatalogCentroCustoSearch', 'Nenhum centro de custo sincronizado.'],
  ];
  groups.forEach(([kind, bodyId, countId, searchId, empty]) => {
    let rows = contaAzulCatalogRows.filter((r) => r.kind === kind);
    text(countId, String(rows.length));
    const term = val(searchId).trim().toLowerCase();
    if (term) rows = rows.filter((r) => String(r.name || '').toLowerCase().includes(term));
    html(bodyId, rows.length ? rows.map((r) => `<tr>
      <td><input type="checkbox" ${r.allowed_for_operator ? 'checked' : ''} onchange="toggleContaAzulCatalogAllowed('${esc(r.id)}',this.checked)" style="width:16px;height:16px"/></td>
      <td>${esc(r.name)}<br><span class="subtle">ID Conta Azul: ${esc(r.external_id)}</span></td>
    </tr>`).join('') : emptyRow(2, empty));
  });
}

async function toggleContaAzulCatalogAllowed(id, allowed) {
  const item = contaAzulCatalogRows.find((r) => r.id === id);
  if (!item) return;
  if (item.kind === 'conta_financeira' && allowed) {
    contaAzulCatalogRows
      .filter((r) => r.kind === 'conta_financeira' && r.id !== id)
      .forEach((r) => { r.allowed_for_operator = false; });
  }
  item.allowed_for_operator = allowed;
  renderContaAzulCatalogTables();
  if (!sb || USE_LOCAL_FALLBACK) return;
  if (item.kind === 'conta_financeira' && allowed) {
    await sb
      .from('conta_azul_catalog_items')
      .update({ allowed_for_operator: false, updated_at: new Date().toISOString() })
      .eq('company_id', item.company_id)
      .eq('kind', 'conta_financeira')
      .neq('id', id);
  }
  const { error } = await sb
    .from('conta_azul_catalog_items')
    .update({ allowed_for_operator: allowed, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    item.allowed_for_operator = !allowed;
    renderContaAzulCatalogTables();
    alert('Nao foi possivel salvar a liberacao: ' + error.message);
  }
}

function contaAzulApprovalRows() {
  return allMovementRows(reportFilteredClosings())
    .filter((r) => r.Tipo === 'Entrada' || r.Tipo === 'Saída')
    .map((r, idx) => ({
      id: `preview_${idx}`,
      sourceKey: `${r['ID Fechamento'] || ''}|${r.Tipo}|${idx}|${r['Descrição'] || r['DescriÃ§Ã£o'] || ''}|${r.Valor}`,
      selected: true,
      approved: false,
      sending: false,
      sent: false,
      protocolId: '',
      error: '',
      row: contaAzulRow(r, 'Importado Central de Caixa 5X'),
      source: r,
      type: r.Tipo,
    }));
}

function contaAzulPreviewOptions(item, field) {
  const companyId = item.source?.companyId || currentContaAzulCompanyId();
  const category = field === 'Categoria'
    ? (item.type === 'Entrada' ? 'entryCategories' : 'expenseCategories')
    : (item.type === 'Entrada' ? 'clientes' : 'fornecedores');
  return optionsForCompany(companyId, category);
}

function contaAzulSelectHtml(item, field) {
  const current = item.row[field] || '';
  const options = contaAzulPreviewOptions(item, field);
  const merged = current && !options.includes(current) ? [current, ...options] : options;
  return `<select class="ca-preview-select ${current ? '' : 'is-invalid'}" onchange="updateContaAzulPreviewField('${esc(item.id)}','${esc(field)}',this.value,this)">
    <option value="">Selecione</option>
    ${merged.map((option) => `<option value="${esc(option)}" ${option === current ? 'selected' : ''}>${esc(option)}</option>`).join('')}
  </select>`;
}

function contaAzulInputHtml(item, field) {
  const current = item.row[field] || '';
  return `<input class="ca-preview-input ${current ? '' : 'is-invalid'}" value="${esc(current)}" oninput="updateContaAzulPreviewField('${esc(item.id)}','${esc(field)}',this.value,this)" placeholder="${esc(field)}"/>`;
}

function contaAzulPreviewMissingFields(item) {
  return ['Descrição', 'Categoria', 'Cliente/Fornecedor'].filter((field) => !String(item.row[field] || '').trim());
}

function renderContaAzulApprovalPreview() {
  const card = $('contaAzulApprovalCard');
  if (card) card.style.display = contaAzulPreviewRows.length ? '' : 'none';
  html('contaAzulApprovalBody', contaAzulPreviewRows.map((item) => {
    const r = item.row;
    const missing = contaAzulPreviewMissingFields(item);
    const status = missing.length
      ? '<span class="status danger">Incompleto</span>'
      : item.error ? `<span class="status danger" title="${esc(item.error)}">Erro</span>`
      : item.sent ? `<span class="status success" title="${esc(item.protocolId || '')}">Enviado</span>`
      : item.sending ? '<span class="status info">Enviando</span>'
      : item.approved ? '<span class="status success">Aprovado</span>' : '<span class="status warning">Pendente</span>';
    const feedback = item.protocolId
      ? `<div class="ca-preview-feedback">Protocolo: ${esc(item.protocolId)}</div>`
      : item.error ? `<div class="ca-preview-feedback error">${esc(item.error)}</div>` : '';
    return `<tr>
      <td><input type="checkbox" data-ca-preview-id="${esc(item.id)}" ${item.selected ? 'checked' : ''} onchange="setContaAzulPreviewSelected('${esc(item.id)}',this.checked)" style="width:16px;height:16px"/></td>
      <td>${status}${feedback}</td>
      <td>${esc(r['Data de Competência'])}</td>
      <td>${esc(item.type)}</td>
      <td>${contaAzulInputHtml(item, 'Descrição')}</td>
      <td>${contaAzulSelectHtml(item, 'Categoria')}</td>
      <td>${contaAzulSelectHtml(item, 'Cliente/Fornecedor')}</td>
      <td>${esc(r['Centro de Custo'])}</td>
      <td style="color:${Number(r.Valor) >= 0 ? 'var(--success)' : 'var(--danger)'}">${money(r.Valor)}</td>
    </tr>`;
  }).join('') || emptyRow(9));
}

async function buildContaAzulApprovalPreview() {
  contaAzulPreviewRows = contaAzulApprovalRows();
  await loadContaAzulFinancialAccounts(currentContaAzulCompanyId());
  renderContaAzulApprovalPreview();
  if (!contaAzulPreviewRows.length) toast('Nenhum lançamento de entrada ou saída no período selecionado.', 'warning');
}

function setContaAzulPreviewSelected(id, selected) {
  const item = contaAzulPreviewRows.find((r) => r.id === id);
  if (item) item.selected = selected;
}

function updateContaAzulPreviewField(id, field, value, el = null) {
  const item = contaAzulPreviewRows.find((r) => r.id === id);
  if (!item) return;
  item.row[field] = value;
  item.approved = false;
  item.sent = false;
  item.protocolId = '';
  item.error = '';
  if (el) el.classList.toggle('is-invalid', !String(value || '').trim());
}

function toggleContaAzulPreviewSelection(selected) {
  contaAzulPreviewRows.forEach((r) => { r.selected = selected; });
  renderContaAzulApprovalPreview();
}

function approveContaAzulPreview() {
  const selected = contaAzulPreviewRows.filter((r) => r.selected);
  if (!selected.length) return alert('Selecione ao menos um lançamento para aprovar.');
  const invalid = selected.filter((r) => contaAzulPreviewMissingFields(r).length);
  if (invalid.length) {
    renderContaAzulApprovalPreview();
    return alert('Preencha Descrição, Categoria e Cliente/Fornecedor em todos os lançamentos selecionados antes de aprovar.');
  }
  selected.forEach((r) => { r.approved = true; });
  renderContaAzulApprovalPreview();
  toast(`${selected.length} lançamento(s) aprovado(s) para envio Conta Azul.`);
}

async function sendApprovedContaAzulPreview() {
  const companyId = currentContaAzulCompanyId();
  if (!companyId) return alert('Selecione a empresa conectada ao Conta Azul.');
  const accountSelect = $('contaAzulAccountSelect');
  const accountId = val('contaAzulAccountSelect');
  const accountName = accountId ? (accountSelect?.selectedOptions?.[0]?.textContent || '').trim() : '';
  if (!accountId) return alert('Selecione a Conta Financeira sincronizada onde os lancamentos devem ser feitos.');
  const approved = contaAzulPreviewRows.filter((r) => r.selected && r.approved && !r.sent);
  if (!approved.length) return alert('Selecione ao menos um lancamento aprovado ainda nao enviado.');
  const invalid = approved.filter((r) => contaAzulPreviewMissingFields(r).length);
  if (invalid.length) {
    renderContaAzulApprovalPreview();
    return alert('Preencha Descricao, Categoria e Cliente/Fornecedor antes de enviar ao Conta Azul.');
  }
  const confirmed = confirm(`Enviar ${approved.length} lancamento(s) aprovado(s) para o Conta Azul de ${currentContaAzulCompanyName()}?\n\nConta financeira: ${accountName}`);
  if (!confirmed) return;

  approved.forEach((item) => {
    item.sending = true;
    item.error = '';
  });
  renderContaAzulApprovalPreview();

  try {
    const data = await invokeContaAzulFunction('conta-azul-send-approved', {
      company_id: companyId,
      account_id: accountId,
      account_name: accountName,
      rows: approved.map((item) => ({
        id: item.id,
        source_key: item.sourceKey,
        approved: item.approved,
        type: item.type,
        row: item.row,
        source: {
          companyId: item.source?.companyId || companyId,
          closingId: item.source?.closingId || item.source?.['ID Fechamento'] || '',
        },
      })),
    });
    (data.results || []).forEach((result) => {
      const item = contaAzulPreviewRows.find((r) => r.id === result.id);
      if (!item) return;
      item.sending = false;
      item.sent = !!result.ok;
      item.approved = !!result.ok;
      item.protocolId = result.protocolId || '';
      item.error = result.ok ? '' : (result.error || 'Erro ao enviar.');
    });
    const sent = (data.results || []).filter((r) => r.ok).length;
    const failed = (data.results || []).length - sent;
    renderContaAzulApprovalPreview();
    toast(`${sent} lancamento(s) enviado(s).${failed ? ` ${failed} com erro.` : ''}`, failed ? 'warning' : 'success');
  } catch (e) {
    approved.forEach((item) => {
      item.sending = false;
      item.error = e.message || 'Erro ao enviar ao Conta Azul.';
    });
    renderContaAzulApprovalPreview();
    alert('Nao foi possivel enviar ao Conta Azul: ' + (e.message || 'tente novamente.'));
  }
}

function clearContaAzulPreview() {
  contaAzulPreviewRows = [];
  renderContaAzulApprovalPreview();
}

Object.assign(window, {
  connectContaAzul, checkContaAzulStatus,
  finishContaAzulManualAuth, refreshContaAzulSelectedCompanyStatus, applyContaAzulRoleControls,
  loadContaAzulCompanyStatuses, refreshContaAzulCompanyStatusesIfNeeded,
  contaAzulCompanyStatusHtml, syncContaAzulCatalogForCompany,
  renderContaAzulCatalog, loadContaAzulCatalog, syncContaAzulCatalog,
  renderContaAzulCatalogTables, toggleContaAzulCatalogAllowed,
  buildContaAzulApprovalPreview, renderContaAzulApprovalPreview,
  setContaAzulPreviewSelected, toggleContaAzulPreviewSelection,
  updateContaAzulPreviewField,
  approveContaAzulPreview, sendApprovedContaAzulPreview, clearContaAzulPreview,
});

document.addEventListener('DOMContentLoaded', () => {
  applyContaAzulRoleControls();
  finishContaAzulAuthFromUrl();
});
