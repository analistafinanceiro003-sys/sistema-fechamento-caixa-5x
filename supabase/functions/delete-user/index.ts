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

  const { data: requester, error: requesterError } = await admin
    .from('profiles')
    .select('id, user_id, role, status, is_owner')
    .eq('user_id', authUser.user.id)
    .maybeSingle();

  if (requesterError) return friendlyError(req, 'Não foi possível validar seu perfil.', 500);
  if (!requester || !['master', 'analyst'].includes(requester.role) || requester.status === 'Inativo') {
    return friendlyError(req, 'Apenas Master ou Analista podem excluir usuários.', 403);
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
    return friendlyError(req, 'Dados inválidos para exclusão do usuário.');
  }

  const userId = String(body.user_id || '').trim();
  const profileId = String(body.profile_id || '').trim();
  if (!userId || !profileId) return friendlyError(req, 'Usuário não informado para exclusão.');
  if (userId === authUser.user.id) return friendlyError(req, 'Você não pode excluir seu próprio usuário.', 403);

  const { data: targetProfile, error: targetError } = await admin
    .from('profiles')
    .select('id, user_id, name, email, role, company_id, store_id')
    .eq('id', profileId)
    .eq('user_id', userId)
    .maybeSingle();

  if (targetError) return friendlyError(req, 'Não foi possível localizar o usuário.', 500);
  if (!targetProfile) return friendlyError(req, 'Usuário não encontrado.', 404);

  /* Excluir outro acesso Master (Coordenador) é exclusivo de quem já é dono
     (is_owner) — um coordenador não pode remover o dono nem outro coordenador. */
  if (targetProfile.role === 'master' && !requester.is_owner) {
    return friendlyError(req, 'Apenas o dono da conta pode excluir outro acesso Master.', 403);
  }

  /* Analista só exclui Admin/Operador de empresas às quais tem acesso —
     nunca outro Analista ou o Master. */
  if (requester.role === 'analyst') {
    if (!['admin', 'operator'].includes(targetProfile.role) || !analystCompanyIds.includes(targetProfile.company_id)) {
      return friendlyError(req, 'Você só pode excluir usuários de empresas às quais tem acesso.', 403);
    }
  }

  await admin.from('audit_logs').insert({
    user_id: requester.user_id,
    company_id: targetProfile.company_id,
    store_id: targetProfile.store_id,
    action: 'Exclusão de usuário',
    entity: 'profile',
    entity_id: targetProfile.id,
    metadata: {
      target_user_id: targetProfile.user_id,
      email: targetProfile.email,
      role: targetProfile.role,
    },
  });

  const { error: deleteAuthError } = await admin.auth.admin.deleteUser(userId);
  if (deleteAuthError) return friendlyError(req, 'Não foi possível excluir o usuário.', 500);

  await admin.from('profiles').delete().eq('id', profileId);

  return json(req, { ok: true, message: 'Usuário excluído com sucesso.' });
});
