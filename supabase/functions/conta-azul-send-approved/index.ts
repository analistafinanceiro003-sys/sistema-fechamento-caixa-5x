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

async function findFirstCatalogExternalId(admin: any, companyId: string, kind: string) {
  const { data, error } = await admin.from('conta_azul_catalog_items')
    .select('external_id')
    .eq('company_id', companyId)
    .eq('kind', kind)
    .eq('active', true)
    .order('allowed_for_operator', { ascending: false })
    .order('name', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data?.external_id) return '';
  return data.external_id;
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

  const accessToken = await ensureAccessToken(admin, connection);
  const accountName = clean(payload.account_name || Deno.env.get('CONTA_AZUL_DEFAULT_ACCOUNT_NAME'));
  const accountId = accountName
    ? (await findCatalogExternalId(admin, companyId, accountName, 'conta_financeira') || await findContaFinanceira(accessToken, accountName))
    : (await findFirstCatalogExternalId(admin, companyId, 'conta_financeira') || await findContaFinanceira(accessToken, accountName));
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
      const protocolId = clean(created.protocolId || created.protocolo || created.id);

      await admin.from('conta_azul_launch_queue').upsert({
        company_id: companyId,
        closing_id: clean(item.source?.closingId) || null,
        direction,
        source_key: sourceKey,
        payload: eventPayload,
        status: 'Enviado',
        approved_by: requester.id,
        approved_at: new Date().toISOString(),
        sent_at: new Date().toISOString(),
        conta_azul_protocol_id: protocolId,
        error_message: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'company_id,source_key' });
      results.push({ id: item.id, ok: true, status: 'Enviado', protocolId });
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
