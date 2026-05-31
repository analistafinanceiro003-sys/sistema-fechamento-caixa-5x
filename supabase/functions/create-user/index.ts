import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function friendlyError(message: string, status = 400) {
  return json({ ok: false, error: message }, status);
}

function normalizeEmail(email: unknown) {
  return String(email || '').trim().toLowerCase();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return friendlyError('Método não permitido.', 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return friendlyError('Configuração da função incompleta. Verifique os secrets no Supabase.', 500);
  }

  const authHeader = req.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return friendlyError('Sessão não encontrada. Faça login novamente.', 401);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: authUser, error: authError } = await admin.auth.getUser(jwt);
  if (authError || !authUser.user) {
    return friendlyError('Sessão inválida ou expirada. Faça login novamente.', 401);
  }

  const { data: requester, error: requesterError } = await admin
    .from('profiles')
    .select('id, user_id, role, status')
    .eq('user_id', authUser.user.id)
    .maybeSingle();

  if (requesterError) return friendlyError('Não foi possível validar seu perfil.', 500);
  if (!requester || requester.role !== 'master' || requester.status === 'Inativo') {
    return friendlyError('Apenas o perfil Master pode criar usuários.', 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return friendlyError('Dados inválidos para criação do usuário.');
  }

  const name = String(body.name || '').trim();
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  const role = String(body.role || '').trim();
  const companyId = body.company_id ? String(body.company_id) : null;
  const storeId = body.store_id ? String(body.store_id) : null;

  if (!name) return friendlyError('Informe o nome do usuário.');
  if (!email || !email.includes('@')) return friendlyError('Informe um e-mail válido.');
  if (!password || password.length < 6) return friendlyError('A senha precisa ter pelo menos 6 caracteres.');
  if (!['admin', 'operator'].includes(role)) return friendlyError('Perfil inválido. Use Admin ou Operador.');
  if (role === 'admin' && !companyId) return friendlyError('Administrador precisa estar vinculado a uma empresa.');
  if (role === 'operator' && (!companyId || !storeId)) {
    return friendlyError('Operador precisa estar vinculado a uma empresa e uma loja.');
  }

  const { data: existingProfile } = await admin
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (existingProfile) return friendlyError('Já existe um perfil cadastrado com este e-mail.');

  const { data: company } = await admin
    .from('companies')
    .select('id')
    .eq('id', companyId)
    .maybeSingle();
  if (!company) return friendlyError('Empresa não encontrada.');

  if (role === 'operator') {
    const { data: store } = await admin
      .from('stores')
      .select('id')
      .eq('id', storeId)
      .eq('company_id', companyId)
      .maybeSingle();
    if (!store) return friendlyError('Loja não encontrada para esta empresa.');
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, role },
  });

  if (createError || !created.user) {
    const message = createError?.message?.includes('already')
      ? 'Já existe um usuário no Authentication com este e-mail.'
      : 'Não foi possível criar o usuário no Authentication.';
    return friendlyError(message, 400);
  }

  const profilePayload = {
    user_id: created.user.id,
    name,
    email,
    role,
    company_id: companyId,
    store_id: role === 'operator' ? storeId : null,
    status: 'Ativo',
  };

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .insert(profilePayload)
    .select('*')
    .single();

  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return friendlyError('Usuário criado no Auth, mas o perfil falhou. A criação foi desfeita.', 500);
  }

  return json({ ok: true, user_id: created.user.id, profile });
});
