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

function friendlyError(req: Request, message: string, status = 400) {
  return json(req, { ok: false, error: message }, status);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return friendlyError(req, 'Método não permitido.', 405);

  const supabaseUrl = Deno.env.get('PROJECT_URL');
  const serviceKey = Deno.env.get('SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return friendlyError(req, 'Configuração da função incompleta. Verifique os secrets no Supabase.', 500);
  }

  const authHeader = req.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return friendlyError(req, 'Sessão não encontrada. Faça login novamente.', 401);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: authUser, error: authError } = await admin.auth.getUser(jwt);
  if (authError || !authUser.user) {
    return friendlyError(req, 'Sessão inválida ou expirada. Faça login novamente.', 401);
  }

  const { data: requester } = await admin
    .from('profiles')
    .select('id, user_id, role, status')
    .eq('user_id', authUser.user.id)
    .maybeSingle();

  if (!requester || !['master', 'analyst'].includes(requester.role) || requester.status === 'Inativo') {
    return friendlyError(req, 'Apenas Master ou Analista podem redefinir senhas.', 403);
  }

  let analystCompanyIds: string[] = [];
  if (requester.role === 'analyst') {
    const { data: links } = await admin
      .from('analyst_companies')
      .select('company_id')
      .eq('profile_id', requester.id);
    analystCompanyIds = (links || []).map((l: { company_id: string }) => l.company_id);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return friendlyError(req, 'Dados inválidos.');
  }

  const userId = String(body.user_id || '').trim();
  const newPassword = String(body.new_password || '').trim();

  if (!userId) return friendlyError(req, 'Usuário não informado.');
  if (!newPassword || newPassword.length < 6) return friendlyError(req, 'A nova senha precisa ter pelo menos 6 caracteres.');
  if (userId === authUser.user.id) return friendlyError(req, 'Use "Alterar senha" para redefinir sua própria senha.', 403);

  const { data: targetProfile } = await admin
    .from('profiles')
    .select('id, name, email, role, company_id, store_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (!targetProfile) return friendlyError(req, 'Usuário não encontrado.', 404);

  /* Analista só redefine senha de Admin/Operador de empresas às quais tem acesso. */
  if (requester.role === 'analyst') {
    if (!['admin', 'operator'].includes(targetProfile.role) || !analystCompanyIds.includes(targetProfile.company_id)) {
      return friendlyError(req, 'Você só pode redefinir senhas de usuários de empresas às quais tem acesso.', 403);
    }
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
  if (updateError) return friendlyError(req, 'Não foi possível redefinir a senha.', 500);

  await admin.from('audit_logs').insert({
    user_id: requester.user_id,
    company_id: targetProfile.company_id,
    store_id: targetProfile.store_id,
    action: 'Reset de senha',
    entity: 'profile',
    entity_id: targetProfile.id,
    metadata: { email: targetProfile.email, target_user_id: userId },
  }).catch(() => {});

  return json(req, { ok: true, message: 'Senha redefinida com sucesso.' });
});
