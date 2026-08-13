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
  if (error) throw new Error(error.message || 'Falha na função Conta Azul.');
  if (data && data.ok === false) throw new Error(data.error || 'Operação Conta Azul recusada.');
  return data;
}

async function connectContaAzul() {
  const companyId = currentContaAzulCompanyId();
  if (!companyId) return alert('Selecione uma empresa no filtro do relatório antes de conectar.');
  try {
    setContaAzulStatus('Conta Azul: abrindo autorização...');
    const data = await invokeContaAzulFunction('conta-azul-auth-start', { company_id: companyId });
    if (!data?.authorization_url) throw new Error('URL de autorização não retornada.');
    window.open(data.authorization_url, '_blank', 'noopener,noreferrer,width=980,height=760');
    setContaAzulStatus('Conta Azul: autorização aberta. Conclua o login na aba da Conta Azul.');
  } catch (e) {
    setContaAzulStatus('Conta Azul: ' + (e.message || 'erro ao iniciar conexão.'), 'error');
    alert('Não foi possível iniciar a conexão Conta Azul: ' + (e.message || 'tente novamente.'));
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
      type: r.Tipo,
    }));
}

function renderContaAzulApprovalPreview() {
  const card = $('contaAzulApprovalCard');
  if (card) card.style.display = contaAzulPreviewRows.length ? '' : 'none';
  html('contaAzulApprovalBody', contaAzulPreviewRows.map((item) => {
    const r = item.row;
    const status = item.approved ? '<span class="status success">Aprovado</span>' : '<span class="status warning">Pendente</span>';
    return `<tr>
      <td><input type="checkbox" data-ca-preview-id="${esc(item.id)}" ${item.selected ? 'checked' : ''} onchange="setContaAzulPreviewSelected('${esc(item.id)}',this.checked)" style="width:16px;height:16px"/></td>
      <td>${status}</td>
      <td>${esc(r['Data de Competência'])}</td>
      <td>${esc(item.type)}</td>
      <td>${esc(r.Descrição)}</td>
      <td>${esc(r.Categoria)}</td>
      <td>${esc(r['Cliente/Fornecedor'])}</td>
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

function toggleContaAzulPreviewSelection(selected) {
  contaAzulPreviewRows.forEach((r) => { r.selected = selected; });
  renderContaAzulApprovalPreview();
}

function approveContaAzulPreview() {
  const selected = contaAzulPreviewRows.filter((r) => r.selected);
  if (!selected.length) return alert('Selecione ao menos um lançamento para aprovar.');
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
  buildContaAzulApprovalPreview, renderContaAzulApprovalPreview,
  setContaAzulPreviewSelected, toggleContaAzulPreviewSelection,
  approveContaAzulPreview, clearContaAzulPreview,
});
