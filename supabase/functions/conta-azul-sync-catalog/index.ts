import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

function clean(value: unknown) {
  return String(value || '').trim();
}

function basicAuth(clientId: string, clientSecret: string) {
  return btoa(`${clientId}:${clientSecret}`);
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

async function caFetch(accessToken: string, path: string) {
  const apiBase = (Deno.env.get('CONTA_AZUL_API_URL') || 'https://api-v2.contaazul.com').replace(/\/$/, '');
  const resp = await fetch(`${apiBase}${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = body?.message || body?.error_description || body?.error || `Conta Azul HTTP ${resp.status}`;
    throw new Error(Array.isArray(msg) ? msg.join(', ') : String(msg));
  }
  return body;
}

async function fetchPages(accessToken: string, path: string, itemKey = 'items') {
  const rows = [];
  for (let page = 1; page <= 20; page += 1) {
    const sep = path.includes('?') ? '&' : '?';
    const data = await caFetch(accessToken, `${path}${sep}pagina=${page}&tamanho_pagina=200`);
    const items = data[itemKey] || data.items || data.itens || [];
    rows.push(...items);
    const total = Number(data.totalItems || data.itens_totais || 0);
    if (!items.length || rows.length >= total) break;
  }
  return rows;
}

async function fetchCategorias(accessToken: string, tipo: 'RECEITA' | 'DESPESA') {
  const paths = [
    `/v1/categorias?tipo=${tipo}&permite_apenas_filhos=false`,
    `/v1/categorias?tipo=${tipo}&permite_apenas_filhos=true`,
    `/v1/categorias?tipo=${tipo}&apenas_filhos=true&permite_apenas_filhos=true`,
  ];
  const byId = new Map<string, any>();
  let success = false;
  let firstError = '';
  for (const path of paths) {
    try {
      const items = await fetchPages(accessToken, path, 'itens');
      success = true;
      for (const item of items) {
        const id = clean(item.id || item.uuid);
        if (id) byId.set(id, item);
      }
    } catch (e) {
      if (!firstError) firstError = e instanceof Error ? e.message : `Falha ao buscar categorias ${tipo}.`;
    }
  }
  if (!success) throw new Error(firstError || `Falha ao buscar categorias ${tipo}.`);
  return Array.from(byId.values());
}

async function catalogBatch(companyId: string, kind: string, items: any[]) {
  const byId = new Map<string, any>();
  for (const item of items) {
    const row = catalogRow(companyId, kind, item);
    if (row?.external_id) byId.set(row.external_id, row);
  }
  return Array.from(byId.values());
}

async function upsertBatch(admin: any, rows: any[]) {
  if (!rows.length) return;
  const { error: upsertError } = await admin.from('conta_azul_catalog_items')
    .upsert(rows, { onConflict: 'company_id,kind,external_id' });
  if (upsertError) throw upsertError;
}

function addCounts(counts: Record<string, number>, rows: any[]) {
  for (const row of rows) {
    counts[row.kind] = (counts[row.kind] || 0) + 1;
  }
}

async function syncStep(admin: any, counts: Record<string, number>, label: string, loadRows: () => Promise<any[]>) {
  try {
    const rows = await loadRows();
    await upsertBatch(admin, rows);
    addCounts(counts, rows);
    return rows.length;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'erro desconhecido';
    throw new Error(`${label}: ${message}`);
  }
}

function catalogRow(companyId: string, kind: string, item: any) {
  const externalId = clean(item.id || item.uuid);
  const name = clean(item.nome || item.nome_fantasia || item.razao_social);
  if (!externalId || !name) return null;
  return {
    company_id: companyId,
    external_id: externalId,
    kind,
    name,
    active: item.ativo !== false,
    metadata: item,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
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
  if (!companyId) return error(req, 'Selecione a empresa para sincronizar.', 400);
  const allowed = requester.role === 'master';
  if (!allowed) return error(req, 'Apenas Master pode sincronizar cadastros Conta Azul.', 403);

  const { data: connection, error: connError } = await admin.from('conta_azul_connections')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle();
  if (connError || !connection || connection.status !== 'Conectado') {
    return error(req, 'Empresa sem conexao Conta Azul ativa.', 400);
  }

  const accessToken = await ensureAccessToken(admin, connection);
  const counts: Record<string, number> = {};
  const steps: Array<{ label: string; count: number }> = [];
  try {
    steps.push({
      label: 'Clientes',
      count: await syncStep(admin, counts, 'Clientes', async () =>
        catalogBatch(companyId, 'cliente', await fetchPages(accessToken, '/v1/pessoas?tipo_perfil=Cliente', 'items'))),
    });
    steps.push({
      label: 'Fornecedores',
      count: await syncStep(admin, counts, 'Fornecedores', async () =>
        catalogBatch(companyId, 'fornecedor', await fetchPages(accessToken, '/v1/pessoas?tipo_perfil=Fornecedor', 'items'))),
    });
    steps.push({
      label: 'Categorias de entrada',
      count: await syncStep(admin, counts, 'Categorias de entrada', async () =>
        catalogBatch(companyId, 'categoria_entrada', await fetchCategorias(accessToken, 'RECEITA'))),
    });
    steps.push({
      label: 'Categorias de saida',
      count: await syncStep(admin, counts, 'Categorias de saida', async () =>
        catalogBatch(companyId, 'categoria_saida', await fetchCategorias(accessToken, 'DESPESA'))),
    });
    steps.push({
      label: 'Contas financeiras',
      count: await syncStep(admin, counts, 'Contas financeiras', async () =>
        catalogBatch(companyId, 'conta_financeira', await fetchPages(accessToken, '/v1/conta-financeira?apenas_ativo=true', 'itens'))),
    });
    steps.push({
      label: 'Centros de custo',
      count: await syncStep(admin, counts, 'Centros de custo', async () =>
        catalogBatch(companyId, 'centro_custo', await fetchPages(accessToken, '/v1/centro-de-custo?filtro_rapido=ATIVO', 'items'))),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro ao sincronizar cadastros Conta Azul.';
    return error(req, message, 500);
  }

  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return json(req, { ok: true, counts, steps, total });
});
