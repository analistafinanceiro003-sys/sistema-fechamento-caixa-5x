-- ============================================================
-- INTEGRAÇÃO CONTA AZUL
-- OAuth por empresa e fila futura de lançamentos aprováveis.
-- Execute este arquivo no Supabase antes de usar as funções:
--   conta-azul-auth-start
--   conta-azul-auth-callback
-- ============================================================

create table if not exists public.conta_azul_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  connected_by uuid references public.profiles(id) on delete set null,
  status text not null default 'Desconectado'
    check (status in ('Conectado','Desconectado','Erro')),
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  scope text,
  token_type text,
  last_error text,
  connected_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(company_id)
);

create table if not exists public.conta_azul_oauth_states (
  id uuid primary key default gen_random_uuid(),
  state text not null unique,
  company_id uuid not null references public.companies(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.conta_azul_launch_queue (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  closing_id uuid references public.closings(id) on delete set null,
  direction text not null check (direction in ('Entrada','Saída')),
  source_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'Pendente'
    check (status in ('Pendente','Aprovado','Enviado','Erro','Ignorado')),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  sent_at timestamptz,
  conta_azul_protocol_id text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, source_key)
);

alter table public.conta_azul_connections enable row level security;
alter table public.conta_azul_oauth_states enable row level security;
alter table public.conta_azul_launch_queue enable row level security;

drop policy if exists "conta_azul_connections_select" on public.conta_azul_connections;
drop policy if exists "conta_azul_connections_master_all" on public.conta_azul_connections;
drop policy if exists "conta_azul_oauth_states_master_all" on public.conta_azul_oauth_states;
drop policy if exists "conta_azul_launch_queue_select" on public.conta_azul_launch_queue;
drop policy if exists "conta_azul_launch_queue_master_all" on public.conta_azul_launch_queue;

create policy "conta_azul_connections_select" on public.conta_azul_connections
  for select to authenticated
  using (
    is_master()
    or exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
        and p.company_id = conta_azul_connections.company_id
    )
    or exists (
      select 1 from public.profiles p
      join public.analyst_companies ac on ac.profile_id = p.id
      where p.user_id = auth.uid()
        and p.role = 'analyst'
        and ac.company_id = conta_azul_connections.company_id
    )
  );

create policy "conta_azul_connections_master_all" on public.conta_azul_connections
  for all to authenticated
  using (is_master())
  with check (is_master());

create policy "conta_azul_oauth_states_master_all" on public.conta_azul_oauth_states
  for all to authenticated
  using (is_master())
  with check (is_master());

create policy "conta_azul_launch_queue_select" on public.conta_azul_launch_queue
  for select to authenticated
  using (
    is_master()
    or exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
        and p.company_id = conta_azul_launch_queue.company_id
    )
    or exists (
      select 1 from public.profiles p
      join public.analyst_companies ac on ac.profile_id = p.id
      where p.user_id = auth.uid()
        and p.role = 'analyst'
        and ac.company_id = conta_azul_launch_queue.company_id
    )
  );

create policy "conta_azul_launch_queue_master_all" on public.conta_azul_launch_queue
  for all to authenticated
  using (is_master())
  with check (is_master());
