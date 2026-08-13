import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function html(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function basicAuth(clientId: string, clientSecret: string) {
  return btoa(`${clientId}:${clientSecret}`);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  const oauthError = url.searchParams.get('error') || '';

  const supabaseUrl = Deno.env.get('PROJECT_URL');
  const serviceKey = Deno.env.get('SERVICE_ROLE_KEY');
  const clientId = Deno.env.get('CONTA_AZUL_CLIENT_ID');
  const clientSecret = Deno.env.get('CONTA_AZUL_CLIENT_SECRET');
  const redirectUri = Deno.env.get('CONTA_AZUL_REDIRECT_URI');
  const tokenUrl = Deno.env.get('CONTA_AZUL_TOKEN_URL') || 'https://auth.contaazul.com/oauth2/token';
  if (!supabaseUrl || !serviceKey || !clientId || !clientSecret || !redirectUri) {
    return html('<h2>Configuração incompleta</h2><p>Verifique os secrets da integração Conta Azul no Supabase.</p>', 500);
  }
  if (oauthError) return html(`<h2>Autorização cancelada</h2><p>${oauthError}</p>`, 400);
  if (!code || !state) return html('<h2>Retorno inválido</h2><p>Code ou state ausente.</p>', 400);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: oauthState, error: stateError } = await admin
    .from('conta_azul_oauth_states')
    .select('id, company_id, requested_by, expires_at')
    .eq('state', state)
    .maybeSingle();
  if (stateError || !oauthState) return html('<h2>Autorização expirada</h2><p>Inicie a conexão novamente pelo sistema.</p>', 400);
  if (new Date(oauthState.expires_at).getTime() < Date.now()) {
    return html('<h2>Autorização expirada</h2><p>O código deve ser usado em poucos minutos. Inicie novamente.</p>', 400);
  }

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
    return html('<h2>Não foi possível conectar</h2><p>Falha ao trocar a autorização por token.</p>', 400);
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

  return html(`
    <h2>Conta Azul conectada com sucesso</h2>
    <p>Você já pode fechar esta aba e voltar ao sistema Gestão 5X.</p>
    <script>setTimeout(() => window.close(), 1200);</script>
  `);
});
