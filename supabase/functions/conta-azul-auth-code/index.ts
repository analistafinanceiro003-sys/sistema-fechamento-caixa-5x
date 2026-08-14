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

function basicAuth(clientId: string, clientSecret: string) {
  return btoa(`${clientId}:${clientSecret}`);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return error(req, 'Metodo nao permitido.', 405);

  const supabaseUrl = Deno.env.get('PROJECT_URL');
  const serviceKey = Deno.env.get('SERVICE_ROLE_KEY');
  const clientId = Deno.env.get('CONTA_AZUL_CLIENT_ID');
  const clientSecret = Deno.env.get('CONTA_AZUL_CLIENT_SECRET');
  const configuredRedirectUri = Deno.env.get('CONTA_AZUL_REDIRECT_URI');
  const appRedirectUri = Deno.env.get('CONTA_AZUL_APP_REDIRECT_URI');
  const redirectUri = appRedirectUri || configuredRedirectUri;
  const tokenUrl = Deno.env.get('CONTA_AZUL_TOKEN_URL') || 'https://auth.contaazul.com/oauth2/token';
  if (!supabaseUrl || !serviceKey || !clientId || !clientSecret || !redirectUri) {
    return error(req, 'Secrets da integracao Conta Azul incompletos.', 500);
  }

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
  const code = String(payload.code || '').trim();
  const state = String(payload.state || '').trim();
  if (!code || !state) return error(req, 'Code e state sao obrigatorios.', 400);

  const { data: oauthState, error: stateError } = await admin
    .from('conta_azul_oauth_states')
    .select('id, company_id, requested_by, expires_at')
    .eq('state', state)
    .maybeSingle();
  if (stateError || !oauthState) return error(req, 'Autorizacao expirada. Inicie a conexao novamente pelo sistema.', 400);
  if (new Date(oauthState.expires_at).getTime() < Date.now()) {
    return error(req, 'O codigo expirou. Inicie a conexao novamente pelo sistema.', 400);
  }

  const isOwner = oauthState.requested_by === requester.id;
  if (!isOwner && requester.role !== 'master') return error(req, 'Esta autorizacao pertence a outro usuario.', 403);

  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('code', code);
  body.set('redirect_uri', redirectUri);

  const tokenResp = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth(clientId, clientSecret)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const token = await tokenResp.json().catch(() => ({}));
  if (!tokenResp.ok || !token.access_token) {
    await admin.from('conta_azul_connections').upsert({
      company_id: oauthState.company_id,
      connected_by: oauthState.requested_by,
      status: 'Erro',
      last_error: token.error_description || token.error || 'Falha ao trocar code por token.',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id' });
    return error(req, token.error_description || token.error || 'Falha ao trocar code por token.', 400);
  }

  const expiresIn = Number(token.expires_in || 3600);
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  await admin.from('conta_azul_connections').upsert({
    company_id: oauthState.company_id,
    connected_by: oauthState.requested_by,
    status: 'Conectado',
    access_token: token.access_token,
    refresh_token: token.refresh_token || null,
    expires_at: expiresAt,
    scope: token.scope || null,
    token_type: token.token_type || 'Bearer',
    last_error: null,
    connected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'company_id' });
  await admin.from('conta_azul_oauth_states').delete().eq('id', oauthState.id);

  return json(req, { ok: true });
});
