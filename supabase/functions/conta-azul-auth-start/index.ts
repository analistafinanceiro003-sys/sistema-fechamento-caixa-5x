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

function randomState() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return error(req, 'Método não permitido.', 405);

  const supabaseUrl = Deno.env.get('PROJECT_URL');
  const serviceKey = Deno.env.get('SERVICE_ROLE_KEY');
  const clientId = Deno.env.get('CONTA_AZUL_CLIENT_ID');
  const configuredRedirectUri = Deno.env.get('CONTA_AZUL_REDIRECT_URI');
  const appRedirectUri = Deno.env.get('CONTA_AZUL_APP_REDIRECT_URI');
  const authUrl = Deno.env.get('CONTA_AZUL_AUTH_URL') || 'https://auth.contaazul.com/login';
  const scope = Deno.env.get('CONTA_AZUL_SCOPE') || 'openid profile aws.cognito.signin.user.admin';
  const redirectUri = appRedirectUri || configuredRedirectUri;
  if (!supabaseUrl || !serviceKey || !clientId || !redirectUri) {
    return error(req, 'Secrets da integração Conta Azul incompletos.', 500);
  }

  const authHeader = req.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return error(req, 'Sessão não encontrada. Faça login novamente.', 401);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: authUser, error: authError } = await admin.auth.getUser(jwt);
  if (authError || !authUser.user) return error(req, 'Sessão inválida ou expirada.', 401);

  const { data: requester } = await admin
    .from('profiles')
    .select('id, role, company_id, status')
    .eq('user_id', authUser.user.id)
    .maybeSingle();
  if (!requester || requester.status === 'Inativo') return error(req, 'Perfil sem permissão.', 403);

  const body = await req.json().catch(() => ({}));
  const companyId = String(body.company_id || requester.company_id || '').trim();
  if (!companyId) return error(req, 'Selecione a empresa para conectar ao Conta Azul.');

  let allowed = requester.role === 'master';
  if (!allowed && requester.role === 'admin') allowed = requester.company_id === companyId;
  if (!allowed && requester.role === 'analyst') {
    const { data: link } = await admin
      .from('analyst_companies')
      .select('id')
      .eq('profile_id', requester.id)
      .eq('company_id', companyId)
      .maybeSingle();
    allowed = !!link;
  }
  if (!allowed) return error(req, 'Você não tem permissão para conectar esta empresa.', 403);

  const state = randomState();
  const expiresAt = new Date(Date.now() + 3 * 60 * 1000).toISOString();
  const { error: stateError } = await admin.from('conta_azul_oauth_states').insert({
    state,
    company_id: companyId,
    requested_by: requester.id,
    expires_at: expiresAt,
  });
  if (stateError) return error(req, 'Não foi possível iniciar a autorização.', 500);

  const url = new URL(authUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', scope);

  return json(req, { ok: true, authorization_url: url.toString() });
});
