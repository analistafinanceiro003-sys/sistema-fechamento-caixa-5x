import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function corsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '*';
  const isAllowedOrigin =
    origin === '*' ||
    /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);

  return {
    'Access-Control-Allow-Origin': isAllowedOrigin ? origin : 'https://sistema-fechamento-caixa-5x.vercel.app',
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

function normalizeEmail(email: unknown) {
  return String(email || '').trim().toLowerCase();
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
    .select('id, user_id, role, status')
    .eq('user_id', authUser.user.id)
    .maybeSingle();

  if (requesterError) return friendlyError(req, 'Não foi possível validar seu perfil.', 500);
  if (!requester || requester.role !== 'master' || requester.status === 'Inativo') {
    return friendlyError(req, 'Apenas o perfil Master pode criar usuários.', 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return friendlyError(req, 'Dados inválidos para criação do usuário.');
  }

  const name = String(body.name || '').trim();
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  const role = String(body.role || '').trim();
  const companyId = body.company_id ? String(body.company_id) : null;
  const storeId = body.store_id ? String(body.store_id) : null;
  const status = String(body.status || 'Ativo').trim() || 'Ativo';

  if (!name) return friendlyError(req, 'Informe o nome do usuário.');
  if (!email || !email.includes('@')) return friendlyError(req, 'Informe um e-mail válido.');
  if (!password || password.length < 6) return friendlyError(req, 'A senha precisa ter pelo menos 6 caracteres.');
  if (!['admin', 'operator'].includes(role)) return friendlyError(req, 'Perfil inválido. Use Admin ou Operador.');
  if (!['Ativo', 'Inativo'].includes(status)) return friendlyError(req, 'Status inválido para o usuário.');
  if (role === 'admin' && !companyId) return friendlyError(req, 'Administrador precisa estar vinculado a uma empresa.');
  if (role === 'operator' && (!companyId || !storeId)) {
    return friendlyError(req, 'Operador precisa estar vinculado a uma empresa e uma loja.');
  }

  const { data: existingProfile } = await admin
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (existingProfile) return friendlyError(req, 'Já existe um perfil cadastrado com este e-mail.');

  const { data: company } = await admin
    .from('companies')
    .select('id')
    .eq('id', companyId)
    .maybeSingle();
  if (!company) return friendlyError(req, 'Empresa não encontrada.');

  if (role === 'operator') {
    const { data: store } = await admin
      .from('stores')
      .select('id')
      .eq('id', storeId)
      .eq('company_id', companyId)
      .maybeSingle();
    if (!store) return friendlyError(req, 'Loja não encontrada para esta empresa.');
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
    return friendlyError(req, message, 400);
  }

  const profilePayload = {
    user_id: created.user.id,
    name,
    email,
    role,
    company_id: companyId,
    store_id: role === 'operator' ? storeId : null,
    status,
  };

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .insert(profilePayload)
    .select('*')
    .single();

  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return friendlyError(req, 'Usuário criado no Auth, mas o perfil falhou. A criação foi desfeita.', 500);
  }

  return json(req, { ok: true, user_id: created.user.id, profile });
});
