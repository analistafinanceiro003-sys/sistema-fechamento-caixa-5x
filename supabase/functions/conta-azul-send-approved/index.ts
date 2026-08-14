import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type PreviewRow = {
  id?: string;
  approved?: boolean;
  type?: string;
  source_key?: string;
  row?: Record<string, unknown>;
  source?: Record<string, unknown>;
};

function corsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });
}

function error(req: Request, message: string, status = 400) {
  return json(req, { ok: false, error: message }, status);
}

function basicAuth(clientId: string, clientSecret: string) {
  return btoa(`${clientId}:${clientSecret}`);
}

function clean(value: unknown) {
  return String(value || '').trim();
}

function normalize(value: unknown) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function toISODate(value: unknown) {
  const raw = clean(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  return raw;
}

function moneyNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

function rowValue(row: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
  }
  return '';
}

async function ensureAccessToken(admin: any, connection: any) {
  const clientId = Deno.env.get('CONTA_AZUL_CLIENT_ID');
  const clientSecret = Deno.env.get('CONTA_AZUL_CLIENT_SECRET');
  const tokenUrl = Deno.env.get('CONTA_AZUL_TOKEN_URL') || 'https://auth.contaazul.com/oauth2/token';
  const expiresAt = connection.expires_at ? new Date(connection.expires_at).getTime() : 0;
  if (connection.access_token && expiresAt > Date.now() + 2 * 60 * 1000) return connection.access_token;
  if (!connection.refresh_token || !clientId || !clientSecret) throw new Error('Conexao Conta Azul expirada. Reconecte a empresa.');

  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('refresh_token', connection.refresh_token);
  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth(clientId, clientSecret)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const token = await resp.json().catch(() => ({}));
  if (!resp.ok || !token.access_token) throw new Error(token.error_description || token.error || 'Falha ao renovar token Conta Azul.');

  const expiresIn = Number(token.expires_in || 3600);
  await admin.from('conta_azul_connections').update({
    access_token: token.access_token,
    refresh_token: token.refresh_token || connection.refresh_token,
    expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    token_type: token.token_type || connection.token_type || 'Bearer',
    last_error: null,
    status: 'Conectado',
    updated_at: new Date().toISOString(),
  }).eq('id', connection.id);
  return token.access_token;
}

async function caFetch(accessToken: string, path: string, init: RequestInit = {}) {
  const apiBase = (Deno.env.get('CONTA_AZUL_API_URL') || 'https://api-v2.contaazul.com').replace(/\/$/, '');
  const resp = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = body?.message || body?.error_description || body?.error || body?.descricao || `Conta Azul HTTP ${resp.status}`;
    throw new Error(Array.isArray(msg) ? msg.join(', ') : String(msg));
  }
  return body;
}

function firstArray(value: any, keys: string[]) {
  for (const key of keys) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function objectId(value: any) {
  return clean(value?.id || value?.uuid || value?.id_evento || value?.idEvento || value?.evento_id || value?.eventoId);
}

function findNestedEventId(value: any): string {
  if (!value || typeof value !== 'object') return '';
  const direct = clean(value.id_evento || value.idEvento || value.evento_id || value.eventoId || value.eventoFinanceiroId || value.idEventoFinanceiro);
  if (direct) return direct;
  const eventId = objectId(value.evento || value.evento_financeiro || value.eventoFinanceiro);
  if (eventId) return eventId;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNestedEventId(item);
      if (found) return found;
    }
  } else {
    for (const item of Object.values(value)) {
      const found = findNestedEventId(item);
      if (found) return found;
    }
  }
  return '';
}

function parcelaId(parcela: any) {
  return clean(parcela?.id || parcela?.uuid || parcela?.id_parcela || parcela?.idParcela);
}

function looksLikeParcela(value: any) {
  return !!value && typeof value === 'object' && (
    value.data_vencimento ||
    value.vencimento ||
    value.valor_composicao ||
    value.detalhe_valor ||
    value.conta_financeira ||
    value.id_conta_financeira ||
    value.baixas ||
    value.baixa_agendada ||
    value.evento
  );
}

function createdRefs(created: any) {
  const first = Array.isArray(created) ? created[0] : created;
  const eventId = clean(
    first?.evento?.id ||
    first?.evento_financeiro?.id ||
    first?.eventoFinanceiro?.id ||
    first?.id_evento ||
    first?.idEvento ||
    first?.evento_id ||
    first?.eventoId ||
    first?.eventId
  );
  const parcela = first?.parcela || first?.parcelas?.[0] || (looksLikeParcela(first) ? first : null);
  const parcelaIdValue = parcela ? parcelaId(parcela) : '';
  const protocolId = clean(first?.protocolId || first?.protocolo || first?.id_protocolo || first?.protocolo_id);
  return { eventId, parcelaId: parcelaIdValue && parcelaIdValue !== eventId ? parcelaIdValue : '', protocolId };
}

async function findPessoa(accessToken: string, name: string, profile: 'Cliente' | 'Fornecedor') {
  const params = new URLSearchParams({
    pagina: '1',
    tamanho_pagina: '10',
    busca: name,
    tipo_perfil: profile,
  });
  const data = await caFetch(accessToken, `/v1/pessoas?${params.toString()}`, { method: 'GET' });
  const items = data.items || data.itens || [];
  const wanted = normalize(name);
  const match = items.find((p: any) => normalize(p.nome) === wanted || normalize(p.nome_fantasia) === wanted)
    || items.find((p: any) => normalize(p.nome).includes(wanted) || normalize(p.nome_fantasia).includes(wanted))
    || items[0];
  if (!match) throw new Error(`${profile} nao encontrado no Conta Azul: ${name}`);
  return match.id || match.uuid;
}

async function findCategoria(accessToken: string, name: string, type: 'RECEITA' | 'DESPESA') {
  const params = new URLSearchParams({
    pagina: '1',
    tamanho_pagina: '20',
    busca: name,
    tipo: type,
    permite_apenas_filhos: 'true',
  });
  const data = await caFetch(accessToken, `/v1/categorias?${params.toString()}`, { method: 'GET' });
  const items = data.items || data.itens || [];
  const wanted = normalize(name);
  const match = items.find((c: any) => normalize(c.nome) === wanted)
    || items.find((c: any) => normalize(c.nome).includes(wanted))
    || items[0];
  if (!match) throw new Error(`Categoria nao encontrada no Conta Azul: ${name}`);
  return match.id || match.uuid;
}

async function findContaFinanceira(accessToken: string, preferredName = '') {
  const params = new URLSearchParams({ pagina: '1', tamanho_pagina: '50', apenas_ativo: 'true' });
  if (preferredName) params.set('nome', preferredName);
  const data = await caFetch(accessToken, `/v1/conta-financeira?${params.toString()}`, { method: 'GET' });
  const items = data.items || data.itens || [];
  const wanted = normalize(preferredName);
  const match = wanted
    ? (items.find((a: any) => normalize(a.nome) === wanted) || items[0])
    : items[0];
  if (!match) throw new Error('Conta financeira ativa nao encontrada no Conta Azul.');
  return match.id || match.uuid;
}

async function findCentroCusto(accessToken: string, name: string) {
  if (!name) return '';
  const params = new URLSearchParams({ pagina: '1', tamanho_pagina: '20', busca: name, filtro_rapido: 'ATIVO' });
  const data = await caFetch(accessToken, `/v1/centro-de-custo?${params.toString()}`, { method: 'GET' });
  const items = data.items || data.itens || [];
  const wanted = normalize(name);
  const match = items.find((c: any) => normalize(c.nome) === wanted)
    || items.find((c: any) => normalize(c.nome).includes(wanted))
    || items[0];
  return match ? (match.id || match.uuid) : '';
}

async function searchCreatedEvent(accessToken: string, row: Record<string, unknown>, direction: string) {
  const date = toISODate(rowValue(row, 'Data de CompetÃªncia', 'Data de CompetÃƒÂªncia'));
  const description = clean(rowValue(row, 'DescriÃ§Ã£o', 'DescriÃƒÂ§ÃƒÂ£o'));
  const value = moneyNumber(row.Valor);
  const params = new URLSearchParams({
    pagina: '1',
    tamanho_pagina: '20',
    data_vencimento_de: date,
    data_vencimento_ate: date,
    data_competencia_de: date,
    data_competencia_ate: date,
  });
  if (description) params.set('descricao', description);
  const path = direction === 'Entrada'
    ? `/v1/financeiro/eventos-financeiros/contas-a-receber/buscar?${params.toString()}`
    : `/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar?${params.toString()}`;
  const data = await caFetch(accessToken, path, { method: 'GET' });
  const items = firstArray(data, ['itens', 'items', 'data']);
  const wantedDescription = normalize(description);
  const match = items.find((item: any) => {
    const desc = normalize(item.descricao || item.description || item.nome);
    const amount = Number(item.valor || item.valor_total || item.total || item.valor_bruto || 0);
    return (!wantedDescription || desc.includes(wantedDescription) || wantedDescription.includes(desc)) &&
      (!Number.isFinite(amount) || !amount || Math.abs(Math.abs(amount) - value) < 0.01);
  }) || items[0];
  return objectId(match);
}

function extractParcelas(data: any): any[] {
  if (!data) return [];
  if (Array.isArray(data)) return data.flatMap(extractParcelas);
  const direct = firstArray(data, ['parcelas', 'itens', 'items', 'data']);
  if (direct.length) return direct.flatMap(extractParcelas);
  if (parcelaId(data) && (data.status || data.data_vencimento || data.vencimento || data.valor_composicao || data.conta_financeira)) return [data];
  return [];
}

async function findParcelas(accessToken: string, eventId: string) {
  const data = await caFetch(accessToken, `/v1/financeiro/eventos-financeiros/${eventId}/parcelas`, { method: 'GET' });
  const parcelas = extractParcelas(data);
  if (!parcelas.length) throw new Error('Lancamento criado, mas a parcela para baixa nao foi encontrada no Conta Azul.');
  return parcelas;
}

async function createBaixa(accessToken: string, parcelaIdValue: string, row: Record<string, unknown>, direction: string, accountId: string, observation: string) {
  const date = toISODate(rowValue(row, 'Data de CompetÃªncia', 'Data de CompetÃƒÂªncia'));
  const value = moneyNumber(row.Valor);
  if (!parcelaIdValue) throw new Error('Lancamento criado, mas o ID da parcela para baixa nao foi retornado pelo Conta Azul.');
  return await caFetch(accessToken, `/v1/financeiro/eventos-financeiros/parcelas/${parcelaIdValue}/baixa`, {
    method: 'POST',
    body: JSON.stringify({
      data_pagamento: date,
      composicao_valor: {
        multa: 0,
        juros: 0,
        valor_bruto: value,
        desconto: 0,
        taxa: 0,
      },
      conta_financeira: accountId,
      metodo_pagamento: 'DINHEIRO',
      observacao: observation || `Baixa automatica Central de Caixa 5X - ${direction}`,
    }),
  });
}

async function markPaid(accessToken: string, row: Record<string, unknown>, direction: string, refs: { eventId?: string; parcelaId?: string }, accountId: string, observation: string) {
  if (refs.parcelaId) return await createBaixa(accessToken, refs.parcelaId, row, direction, accountId, observation);
  if (!refs.eventId) throw new Error('Lancamento criado, mas nao foi possivel localizar a parcela para marcar como pago/recebido.');
  const parcelas = await findParcelas(accessToken, refs.eventId);
  const pending = parcelas.find((p: any) => clean(p.status).toUpperCase() !== 'QUITADO') || parcelas[0];
  if (clean(pending.status).toUpperCase() === 'QUITADO') return { skipped: true, status: 'QUITADO' };
  return await createBaixa(accessToken, parcelaId(pending), row, direction, accountId, observation);
}

async function findCatalogExternalId(admin: any, companyId: string, name: string, kind: string) {
  if (!name) return '';
  const { data, error } = await admin.from('conta_azul_catalog_items')
    .select('external_id, name, allowed_for_operator')
    .eq('company_id', companyId)
    .eq('kind', kind)
    .eq('active', true);
  if (error || !data?.length) return '';
  const wanted = normalize(name);
  const exactAllowed = data.find((item: any) => item.allowed_for_operator && normalize(item.name) === wanted);
  if (exactAllowed?.external_id) return exactAllowed.external_id;
  const exact = data.find((item: any) => normalize(item.name) === wanted);
  if (exact?.external_id) return exact.external_id;
  return '';
}

async function findSyncedFinancialAccount(admin: any, companyId: string, externalId: string) {
  if (!externalId) return null;
  const { data, error } = await admin.from('conta_azul_catalog_items')
    .select('external_id, name')
    .eq('company_id', companyId)
    .eq('kind', 'conta_financeira')
    .eq('active', true)
    .eq('external_id', externalId)
    .maybeSingle();
  if (error || !data?.external_id) return null;
  return data;
}

function buildPayload(row: Record<string, unknown>, ids: { pessoa: string; categoria: string; conta: string; centro?: string }, direction: string) {
  const value = moneyNumber(row.Valor);
  const date = toISODate(rowValue(row, 'Data de Competência', 'Data de CompetÃªncia'));
  const description = clean(rowValue(row, 'Descrição', 'DescriÃ§Ã£o'));
  const observation = clean(rowValue(row, 'Observações', 'ObservaÃ§Ãµes')) || `Importado Central de Caixa 5X - ${description}`;
  const rateio: Record<string, unknown> = {
    id_categoria: ids.categoria,
    valor: value,
  };
  if (ids.centro) rateio.rateio_centro_custo = [{ id_centro_custo: ids.centro, valor: value }];
  return {
    data_competencia: date,
    valor: value,
    observacao: observation,
    descricao: description,
    contato: ids.pessoa,
    conta_financeira: ids.conta,
    rateio: [rateio],
    condicao_pagamento: {
      parcelas: [{
        descricao: description,
        data_vencimento: date,
        data_pagamento_previsto: date,
        nota: observation,
        conta_financeira: ids.conta,
        detalhe_valor: {
          valor_bruto: value,
          valor_liquido: value,
          desconto: 0,
          taxa: 0,
          juros: 0,
          multa: 0,
        },
        metodo_pagamento: 'DINHEIRO',
      }],
    },
    tipo: direction,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return error(req, 'Metodo nao permitido.', 405);

  const supabaseUrl = Deno.env.get('PROJECT_URL');
  const serviceKey = Deno.env.get('SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return error(req, 'Secrets do Supabase incompletos.', 500);

  const authHeader = req.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return error(req, 'Sessao nao encontrada. Faca login novamente.', 401);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authUser, error: authError } = await admin.auth.getUser(jwt);
  if (authError || !authUser.user) return error(req, 'Sessao invalida ou expirada.', 401);

  const { data: requester } = await admin
    .from('profiles')
    .select('id, role, company_id, status')
    .eq('user_id', authUser.user.id)
    .maybeSingle();
  if (!requester || requester.status === 'Inativo') return error(req, 'Perfil sem permissao.', 403);

  const payload = await req.json().catch(() => ({}));
  const companyId = clean(payload.company_id || requester.company_id);
  const rows = Array.isArray(payload.rows) ? payload.rows as PreviewRow[] : [];
  if (!companyId) return error(req, 'Selecione a empresa para enviar ao Conta Azul.', 400);
  if (!rows.length) return error(req, 'Nenhum lancamento aprovado para enviar.', 400);

  let allowed = requester.role === 'master';
  if (!allowed && requester.role === 'admin') allowed = requester.company_id === companyId;
  if (!allowed && requester.role === 'analyst') {
    const { data: link } = await admin.from('analyst_companies')
      .select('id')
      .eq('profile_id', requester.id)
      .eq('company_id', companyId)
      .maybeSingle();
    allowed = !!link;
  }
  if (!allowed) return error(req, 'Voce nao tem permissao para enviar lancamentos desta empresa.', 403);

  const { data: connection, error: connError } = await admin.from('conta_azul_connections')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle();
  if (connError || !connection || connection.status !== 'Conectado') {
    return error(req, 'Empresa sem conexao Conta Azul ativa.', 400);
  }

  const accountIdInput = clean(payload.account_id);
  const accountNameInput = clean(payload.account_name);
  if (!accountIdInput) return error(req, 'Selecione a Conta Financeira sincronizada antes de enviar.', 400);
  const syncedAccount = await findSyncedFinancialAccount(admin, companyId, accountIdInput);
  if (!syncedAccount) return error(req, 'Conta Financeira nao encontrada nos cadastros sincronizados desta empresa. Sincronize o Conta Azul e selecione a conta novamente.', 400);
  const accessToken = await ensureAccessToken(admin, connection);
  const accountId = syncedAccount.external_id;
  const results = [];

  for (const item of rows) {
    const row = item.row || {};
    const direction = clean(item.type || row.Tipo);
    const sourceKey = clean(item.source_key || item.id || crypto.randomUUID());
    try {
      const { data: existing } = await admin.from('conta_azul_launch_queue')
        .select('status, conta_azul_protocol_id')
        .eq('company_id', companyId)
        .eq('source_key', sourceKey)
        .maybeSingle();
      if (existing?.status === 'Enviado') {
        results.push({ id: item.id, ok: true, status: 'Enviado', protocolId: existing.conta_azul_protocol_id || '', skipped: true });
        continue;
      }

      const isIncome = direction === 'Entrada';
      const personName = clean(row['Cliente/Fornecedor']);
      const categoryName = clean(row.Categoria);
      const centerName = clean(row['Centro de Custo']);
      if (!personName || !categoryName || !clean(rowValue(row, 'Descrição', 'DescriÃ§Ã£o'))) {
        throw new Error('Descricao, Categoria e Cliente/Fornecedor sao obrigatorios.');
      }
      const pessoaKind = isIncome ? 'cliente' : 'fornecedor';
      const categoriaKind = isIncome ? 'categoria_entrada' : 'categoria_saida';
      const pessoa = await findCatalogExternalId(admin, companyId, personName, pessoaKind)
        || await findPessoa(accessToken, personName, isIncome ? 'Cliente' : 'Fornecedor');
      const categoria = await findCatalogExternalId(admin, companyId, categoryName, categoriaKind)
        || await findCategoria(accessToken, categoryName, isIncome ? 'RECEITA' : 'DESPESA');
      const centro = centerName
        ? (await findCatalogExternalId(admin, companyId, centerName, 'centro_custo') || await findCentroCusto(accessToken, centerName))
        : '';
      const eventPayload = buildPayload(row, { pessoa, categoria, conta: accountId, centro }, direction);
      const path = isIncome
        ? '/v1/financeiro/eventos-financeiros/contas-a-receber'
        : '/v1/financeiro/eventos-financeiros/contas-a-pagar';
      const created = await caFetch(accessToken, path, { method: 'POST', body: JSON.stringify(eventPayload) });
      const refs = createdRefs(created);
      const eventId = refs.eventId || await searchCreatedEvent(accessToken, row, direction);
      const baixa = await markPaid(accessToken, row, direction, { eventId, parcelaId: refs.parcelaId }, accountId, clean(eventPayload.observacao));
      const protocolId = refs.protocolId || clean(created?.protocolId || created?.protocolo || created?.id);

      await admin.from('conta_azul_launch_queue').upsert({
        company_id: companyId,
        closing_id: clean(item.source?.closingId) || null,
        direction,
        source_key: sourceKey,
        payload: {
          ...eventPayload,
          auditoria_origem: row,
          conta_financeira_nome: accountNameInput || syncedAccount.name || '',
          conta_azul_event_id: eventId,
          conta_azul_baixa: baixa,
        },
        status: 'Enviado',
        approved_by: requester.id,
        approved_at: new Date().toISOString(),
        sent_at: new Date().toISOString(),
        conta_azul_protocol_id: protocolId,
        error_message: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'company_id,source_key' });
      results.push({ id: item.id, ok: true, status: 'Enviado', protocolId, eventId, paid: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Erro ao enviar lancamento.';
      await admin.from('conta_azul_launch_queue').upsert({
        company_id: companyId,
        closing_id: clean(item.source?.closingId) || null,
        direction: direction || 'Entrada',
        source_key: sourceKey,
        payload: row,
        status: 'Erro',
        approved_by: requester.id,
        approved_at: new Date().toISOString(),
        error_message: message,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'company_id,source_key' });
      results.push({ id: item.id, ok: false, status: 'Erro', error: message });
    }
  }

  return json(req, { ok: true, results });
});
