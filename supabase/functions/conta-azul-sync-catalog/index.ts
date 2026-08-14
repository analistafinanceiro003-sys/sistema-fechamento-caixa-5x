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
    const data = await caFetch(accessToken, `${path}${sep}pagina=${page}&tamanho_pagina=100`);
    const items = data[itemKey] || data.items || data.itens || [];
    rows.push(...items);
    const total = Number(data.totalItems || data.itens_totais || 0);
    if (!items.length || rows.length >= total) break;
  }
  return rows;
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
  const batches = await Promise.all([
    fetchPages(accessToken, '/v1/pessoas?tipo_perfil=Cliente', 'items').then((rows) => rows.map((i) => catalogRow(companyId, 'cliente', i))),
    fetchPages(accessToken, '/v1/pessoas?tipo_perfil=Fornecedor', 'items').then((rows) => rows.map((i) => catalogRow(companyId, 'fornecedor', i))),
    fetchPages(accessToken, '/v1/categorias?tipo=RECEITA&permite_apenas_filhos=true', 'itens').then((rows) => rows.map((i) => catalogRow(companyId, 'categoria_entrada', i))),
    fetchPages(accessToken, '/v1/categorias?tipo=DESPESA&permite_apenas_filhos=true', 'itens').then((rows) => rows.map((i) => catalogRow(companyId, 'categoria_saida', i))),
    fetchPages(accessToken, '/v1/conta-financeira?apenas_ativo=true', 'itens').then((rows) => rows.map((i) => catalogRow(companyId, 'conta_financeira', i))),
    fetchPages(accessToken, '/v1/centro-de-custo?filtro_rapido=ATIVO', 'items').then((rows) => rows.map((i) => catalogRow(companyId, 'centro_custo', i))),
  ]);
  const rows = batches.flat().filter(Boolean);
  if (rows.length) {
    const { error: upsertError } = await admin.from('conta_azul_catalog_items')
      .upsert(rows, { onConflict: 'company_id,kind,external_id' });
    if (upsertError) return error(req, upsertError.message, 500);
  }

  const counts = rows.reduce((acc: Record<string, number>, row: any) => {
    acc[row.kind] = (acc[row.kind] || 0) + 1;
    return acc;
  }, {});
  return json(req, { ok: true, counts, total: rows.length });
});
