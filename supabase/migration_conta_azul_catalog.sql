-- ============================================================
-- CATALOGO CONTA AZUL
-- Espelho dos cadastros vindos da API, separado das opcoes
-- operacionais atuais para nao alterar o fechamento diario.
-- ============================================================

create table if not exists public.conta_azul_catalog_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  external_id text not null,
  kind text not null check (kind in (
    'cliente',
    'fornecedor',
    'categoria_entrada',
    'categoria_saida',
    'conta_financeira',
    'centro_custo'
  )),
  name text not null,
  allowed_for_operator boolean not null default false,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, kind, external_id)
);

create index if not exists conta_azul_catalog_company_kind_idx
  on public.conta_azul_catalog_items(company_id, kind);

alter table public.conta_azul_catalog_items enable row level security;

drop policy if exists "conta_azul_catalog_select" on public.conta_azul_catalog_items;
drop policy if exists "conta_azul_catalog_master_all" on public.conta_azul_catalog_items;
drop policy if exists "conta_azul_catalog_admin_update" on public.conta_azul_catalog_items;

create policy "conta_azul_catalog_select" on public.conta_azul_catalog_items
  for select to authenticated
  using (
    is_master()
    or exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
        and p.company_id = conta_azul_catalog_items.company_id
    )
    or exists (
      select 1 from public.profiles p
      join public.analyst_companies ac on ac.profile_id = p.id
      where p.user_id = auth.uid()
        and p.role = 'analyst'
        and ac.company_id = conta_azul_catalog_items.company_id
    )
  );

create policy "conta_azul_catalog_master_all" on public.conta_azul_catalog_items
  for all to authenticated
  using (is_master())
  with check (is_master());

create policy "conta_azul_catalog_admin_update" on public.conta_azul_catalog_items
  for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
        and p.company_id = conta_azul_catalog_items.company_id
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
        and p.company_id = conta_azul_catalog_items.company_id
    )
  );
