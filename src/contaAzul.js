'use strict';
/* ============================================================
   CONTA AZUL — OAuth + prévia de aprovação
   O envio final fica no backend após configurar mapeamentos por ID.
============================================================ */

let contaAzulPreviewRows = [];

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

function contaAzulApprovalRows(includeCostCenter) {
  return allMovementRows(reportFilteredClosings())
    .filter((r) => r.Tipo === 'Entrada' || r.Tipo === 'Saída')
    .map((r, idx) => ({
      id: `preview_${idx}`,
      selected: true,
      approved: false,
      row: contaAzulRow(r, 'Importado Central de Caixa 5X', includeCostCenter),
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
      : item.approved ? '<span class="status success">Aprovado</span>' : '<span class="status warning">Pendente</span>';
    return `<tr>
      <td><input type="checkbox" data-ca-preview-id="${esc(item.id)}" ${item.selected ? 'checked' : ''} onchange="setContaAzulPreviewSelected('${esc(item.id)}',this.checked)" style="width:16px;height:16px"/></td>
      <td>${status}</td>
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

function buildContaAzulApprovalPreview() {
  const includeCostCenter = shouldFillContaAzulCostCenter();
  contaAzulPreviewRows = contaAzulApprovalRows(includeCostCenter);
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

function clearContaAzulPreview() {
  contaAzulPreviewRows = [];
  renderContaAzulApprovalPreview();
}

Object.assign(window, {
  connectContaAzul, checkContaAzulStatus,
  finishContaAzulManualAuth, refreshContaAzulSelectedCompanyStatus, applyContaAzulRoleControls,
  buildContaAzulApprovalPreview, renderContaAzulApprovalPreview,
  setContaAzulPreviewSelected, toggleContaAzulPreviewSelection,
  updateContaAzulPreviewField,
  approveContaAzulPreview, clearContaAzulPreview,
});

document.addEventListener('DOMContentLoaded', () => {
  applyContaAzulRoleControls();
  finishContaAzulAuthFromUrl();
});
