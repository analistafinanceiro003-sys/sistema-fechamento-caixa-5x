-- ============================================================
-- MIGRAÇÃO — Perfil Analista (multiempresa)
-- Data: 2026-07-11
-- Seguro para re-executar (usa IF NOT EXISTS / DROP POLICY IF EXISTS).
--
-- Cria o perfil "analyst": mesmo acesso de edição do Master, exceto a aba
-- Sistema (configurações gerais, escrita em fornecedores/categorias,
-- backup, logs de auditoria, documentos). Diferente de Admin/Operador, o
-- Analista não é vinculado a uma única empresa — o Master escolhe um
-- conjunto de empresas (tabela analyst_companies) ao criar o acesso, pela
-- aba Sistema → Analistas.
--
-- Este arquivo é o mesmo bloco já incluído em schema.sql (seção "PERFIL
-- ANALISTA"), disponibilizado separadamente para quem já tem o banco em
-- produção e só precisa aplicar a diferença.
-- ============================================================

-- Libera o novo valor de role em profiles
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('master', 'admin', 'operator', 'analyst'));

-- Tabela de vínculo Analista ↔ Empresas (muitos-para-muitos)
create table if not exists public.analyst_companies (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (profile_id, company_id)
);
create index if not exists idx_analyst_companies_profile on public.analyst_companies(profile_id);
create index if not exists idx_analyst_companies_company on public.analyst_companies(company_id);

alter table public.analyst_companies enable row level security;

-- Funções auxiliares de RLS
create or replace function is_analyst()
returns boolean
language sql security definer stable
as $$
  select exists(
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'analyst'
  );
$$;

create or replace function current_analyst_company_ids()
returns uuid[]
language sql security definer stable
as $$
  select coalesce(array_agg(ac.company_id), '{}')
  from public.analyst_companies ac
  join public.profiles p on p.id = ac.profile_id
  where p.user_id = auth.uid();
$$;

-- Policies: analyst_companies (só Master gerencia; analista lê os próprios vínculos)
drop policy if exists "analyst_companies_master_all" on public.analyst_companies;
drop policy if exists "analyst_companies_own_read"   on public.analyst_companies;

create policy "analyst_companies_master_all" on public.analyst_companies
  for all to authenticated using (is_master()) with check (is_master());

create policy "analyst_companies_own_read" on public.analyst_companies
  for select to authenticated
  using (
    profile_id = (select id from public.profiles where user_id = auth.uid() limit 1)
  );

-- Policies: acesso do Analista às tabelas operacionais (mesmo nível de
-- edição do Master, restrito às empresas vinculadas em analyst_companies).
-- Ficam de fora deliberadamente: audit_logs, store_documents (telas
-- exclusivas de Sistema → Logs de Auditoria / Documentos) e a ESCRITA em
-- select_options (gestão de Fornecedores e Categorias também é exclusiva
-- de Sistema — o Analista só lê, para usar nos formulários de fechamento).

drop policy if exists "companies_analyst_all" on public.companies;
create policy "companies_analyst_all" on public.companies
  for all to authenticated
  using (is_analyst() and id = any(current_analyst_company_ids()))
  with check (is_analyst() and id = any(current_analyst_company_ids()));

drop policy if exists "stores_analyst_all" on public.stores;
create policy "stores_analyst_all" on public.stores
  for all to authenticated
  using (is_analyst() and company_id = any(current_analyst_company_ids()))
  with check (is_analyst() and company_id = any(current_analyst_company_ids()));

drop policy if exists "profiles_analyst_all" on public.profiles;
create policy "profiles_analyst_all" on public.profiles
  for all to authenticated
  using (is_analyst() and role in ('admin','operator') and company_id = any(current_analyst_company_ids()))
  with check (is_analyst() and role in ('admin','operator') and company_id = any(current_analyst_company_ids()));

drop policy if exists "modperms_analyst_all" on public.module_permissions;
create policy "modperms_analyst_all" on public.module_permissions
  for all to authenticated
  using (is_analyst() and company_id = any(current_analyst_company_ids()))
  with check (is_analyst() and company_id = any(current_analyst_company_ids()));

drop policy if exists "op_rules_analyst_all" on public.operation_rules;
create policy "op_rules_analyst_all" on public.operation_rules
  for all to authenticated
  using (is_analyst() and company_id = any(current_analyst_company_ids()))
  with check (is_analyst() and company_id = any(current_analyst_company_ids()));

drop policy if exists "op_configs_analyst_all" on public.operation_configs;
create policy "op_configs_analyst_all" on public.operation_configs
  for all to authenticated
  using (is_analyst() and company_id = any(current_analyst_company_ids()))
  with check (is_analyst() and company_id = any(current_analyst_company_ids()));

drop policy if exists "closings_analyst_all" on public.closings;
create policy "closings_analyst_all" on public.closings
  for all to authenticated
  using (is_analyst() and company_id = any(current_analyst_company_ids()))
  with check (is_analyst() and company_id = any(current_analyst_company_ids()));

drop policy if exists "entries_analyst_all" on public.closing_entries;
create policy "entries_analyst_all" on public.closing_entries
  for all to authenticated
  using (
    is_analyst() and exists(
      select 1 from public.closings c
      where c.id = closing_id and c.company_id = any(current_analyst_company_ids())
    )
  )
  with check (
    is_analyst() and exists(
      select 1 from public.closings c
      where c.id = closing_id and c.company_id = any(current_analyst_company_ids())
    )
  );

drop policy if exists "expenses_analyst_all" on public.closing_expenses;
create policy "expenses_analyst_all" on public.closing_expenses
  for all to authenticated
  using (
    is_analyst() and exists(
      select 1 from public.closings c
      where c.id = closing_id and c.company_id = any(current_analyst_company_ids())
    )
  )
  with check (
    is_analyst() and exists(
      select 1 from public.closings c
      where c.id = closing_id and c.company_id = any(current_analyst_company_ids())
    )
  );

drop policy if exists "attachments_analyst_all" on public.closing_attachments;
create policy "attachments_analyst_all" on public.closing_attachments
  for all to authenticated
  using (
    is_analyst() and exists(
      select 1 from public.closings c
      where c.id = closing_id and c.company_id = any(current_analyst_company_ids())
    )
  )
  with check (
    is_analyst() and exists(
      select 1 from public.closings c
      where c.id = closing_id and c.company_id = any(current_analyst_company_ids())
    )
  );

drop policy if exists "opening_adj_analyst_all" on public.cash_opening_adjustments;
create policy "opening_adj_analyst_all" on public.cash_opening_adjustments
  for all to authenticated
  using (is_analyst() and company_id = any(current_analyst_company_ids()))
  with check (is_analyst() and company_id = any(current_analyst_company_ids()));

drop policy if exists "reviews_analyst_all" on public.divergence_reviews;
create policy "reviews_analyst_all" on public.divergence_reviews
  for all to authenticated
  using (is_analyst() and company_id = any(current_analyst_company_ids()))
  with check (is_analyst() and company_id = any(current_analyst_company_ids()));

drop policy if exists "implant_analyst_all" on public.implant_steps;
create policy "implant_analyst_all" on public.implant_steps
  for all to authenticated
  using (is_analyst() and company_id = any(current_analyst_company_ids()))
  with check (is_analyst() and company_id = any(current_analyst_company_ids()));

drop policy if exists "selopts_analyst_read" on public.select_options;
create policy "selopts_analyst_read" on public.select_options
  for select to authenticated
  using (is_analyst() and company_id = any(current_analyst_company_ids()));
