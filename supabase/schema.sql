-- ============================================================
-- SCHEMA COMPLETO — Sistema Fechamento de Caixa 5X
-- Execute no SQL Editor do Supabase (Dashboard → SQL Editor)
-- ============================================================

-- ============================================================
-- EXTENSÕES
-- ============================================================
create extension if not exists "pgcrypto";

-- TRIGGER: updated_at automático
-- ============================================================
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- TABELA: companies
-- ============================================================
create table if not exists public.companies (
  id                        uuid primary key default gen_random_uuid(),
  name                      text not null,
  legal_name                text,
  cnpj                      text,
  segment                   text,
  plan                      text,
  status                    text not null default 'Implantação',
  default_standard_fund     numeric not null default 100,
  default_tolerance         numeric not null default 5,
  default_critical_divergence numeric not null default 20,
  notes                     text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists idx_companies_status on public.companies(status);

create trigger trg_companies_updated_at
  before update on public.companies
  for each row execute function set_updated_at();

-- ============================================================
-- TABELA: stores
-- ============================================================
create table if not exists public.stores (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  name                text not null,
  code                text,
  cash_type           text,
  status              text not null default 'Ativa',
  standard_fund       numeric,
  tolerance           numeric,
  critical_divergence numeric,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_stores_company_id on public.stores(company_id);
create index if not exists idx_stores_status on public.stores(status);

create trigger trg_stores_updated_at
  before update on public.stores
  for each row execute function set_updated_at();

-- ============================================================
-- TABELA: profiles
-- (Vincula auth.users ao sistema de permissões)
-- ============================================================
create table if not exists public.profiles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade unique,
  name        text not null,
  email       text not null,
  role        text not null check (role in ('master', 'admin', 'operator')),
  company_id  uuid references public.companies(id) on delete set null,
  store_id    uuid references public.stores(id) on delete set null,
  status      text not null default 'Ativo',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_profiles_user_id on public.profiles(user_id);
create index if not exists idx_profiles_company_id on public.profiles(company_id);
create index if not exists idx_profiles_store_id on public.profiles(store_id);
create index if not exists idx_profiles_role on public.profiles(role);

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function set_updated_at();

-- ============================================================
-- FUNÇÕES AUXILIARES DE RLS
-- ============================================================

-- Retorna o perfil completo do usuário autenticado
create or replace function get_current_profile()
returns table(
  id uuid, user_id uuid, name text, email text,
  role text, company_id uuid, store_id uuid, status text
)
language sql security definer stable
as $$
  select id, user_id, name, email, role, company_id, store_id, status
  from public.profiles
  where user_id = auth.uid()
  limit 1;
$$;

-- Retorna true se o usuário autenticado é Master
create or replace function is_master()
returns boolean
language sql security definer stable
as $$
  select exists(
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'master'
  );
$$;

-- Retorna a company_id do usuário autenticado
create or replace function current_company_id()
returns uuid
language sql security definer stable
as $$
  select company_id from public.profiles
  where user_id = auth.uid()
  limit 1;
$$;

-- Retorna a store_id do usuário autenticado
create or replace function current_store_id()
returns uuid
language sql security definer stable
as $$
  select store_id from public.profiles
  where user_id = auth.uid()
  limit 1;
$$;

-- Retorna o role do usuário autenticado
create or replace function current_user_role()
returns text
language sql security definer stable
as $$
  select role from public.profiles
  where user_id = auth.uid()
  limit 1;
$$;

-- ============================================================


-- ============================================================
-- TABELA: module_permissions
-- ============================================================
create table if not exists public.module_permissions (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  role           text not null check (role in ('admin', 'operator')),
  page_key       text not null,
  submodule_key  text not null default '',
  is_enabled     boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (company_id, role, page_key, submodule_key)
);

create index if not exists idx_module_perms_company on public.module_permissions(company_id);
create index if not exists idx_module_perms_role on public.module_permissions(role);
create index if not exists idx_module_perms_page on public.module_permissions(page_key);

create trigger trg_module_perms_updated_at
  before update on public.module_permissions
  for each row execute function set_updated_at();

-- ============================================================
-- TABELA: operation_rules
-- ============================================================
create table if not exists public.operation_rules (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  store_id    uuid references public.stores(id) on delete cascade,
  type        text not null,
  rule_text   text not null,
  status      text not null default 'Ativa',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_op_rules_company on public.operation_rules(company_id);
create index if not exists idx_op_rules_store on public.operation_rules(store_id);

create trigger trg_op_rules_updated_at
  before update on public.operation_rules
  for each row execute function set_updated_at();

-- ============================================================
-- TABELA: operation_configs
-- ============================================================
create table if not exists public.operation_configs (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id) on delete cascade unique,
  tolerance            numeric not null default 5,
  critical_divergence  numeric not null default 20,
  transfer_tolerance   numeric not null default 0,
  operation_mode       text not null default 'Diário',
  transfer_receiver    text,
  allowed_expenses     text,
  operator_message     text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_op_configs_company on public.operation_configs(company_id);

create trigger trg_op_configs_updated_at
  before update on public.operation_configs
  for each row execute function set_updated_at();

-- ============================================================
-- TABELA: closings
-- ============================================================
create table if not exists public.closings (
  id                          uuid primary key default gen_random_uuid(),
  company_id                  uuid not null references public.companies(id) on delete cascade,
  store_id                    uuid not null references public.stores(id) on delete cascade,
  operator_user_id            uuid references auth.users(id) on delete set null,
  responsible_name            text,
  closing_date                date not null,
  shift                       text not null default 'Integral',
  initial_balance             numeric not null default 0,
  coins_total                 numeric not null default 0,
  cash_counter_total          numeric not null default 0,
  total_entries               numeric not null default 0,
  total_expenses              numeric not null default 0,
  expected_cash               numeric not null default 0,
  transfer_amount             numeric not null default 0,
  final_after_transfer        numeric not null default 0,
  standard_fund_snapshot      numeric not null default 0,
  tolerance_snapshot          numeric not null default 5,
  critical_divergence_snapshot numeric not null default 20,
  previous_closing_id         uuid references public.closings(id) on delete set null,
  previous_final_after_transfer numeric not null default 0,
  opening_divergence          numeric not null default 0,
  fund_divergence             numeric not null default 0,
  physical_count              numeric not null default 0,
  physical_divergence         numeric not null default 0,
  status                      text,
  review_status               text not null default 'Pendente',
  notes                       text,
  type                        text not null default 'Original'
                                check (type in ('Original', 'Retificado', 'Excluído')),
  original_closing_id         uuid references public.closings(id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index if not exists idx_closings_company on public.closings(company_id);
create index if not exists idx_closings_store on public.closings(store_id);
create index if not exists idx_closings_date on public.closings(closing_date);
create index if not exists idx_closings_shift on public.closings(shift);
create index if not exists idx_closings_scope on public.closings(company_id, store_id, closing_date, shift);
create unique index if not exists uq_closings_original_store_date_shift
  on public.closings(store_id, closing_date, shift)
  where type = 'Original';
create index if not exists idx_closings_operator on public.closings(operator_user_id);
create index if not exists idx_closings_type on public.closings(type);

create trigger trg_closings_updated_at
  before update on public.closings
  for each row execute function set_updated_at();

-- ============================================================
-- TABELA: closing_entries
-- ============================================================
create table if not exists public.closing_entries (
  id          uuid primary key default gen_random_uuid(),
  closing_id  uuid not null references public.closings(id) on delete cascade,
  description text not null,
  category    text,
  client      text,
  amount      numeric not null check (amount >= 0),
  created_at  timestamptz not null default now()
);
-- Migração: adiciona category/client se a tabela já existia sem elas
alter table public.closing_entries add column if not exists category text;
alter table public.closing_entries add column if not exists client text;

create index if not exists idx_entries_closing on public.closing_entries(closing_id);

-- ============================================================
-- TABELA: closing_expenses
-- ============================================================
create table if not exists public.closing_expenses (
  id          uuid primary key default gen_random_uuid(),
  closing_id  uuid not null references public.closings(id) on delete cascade,
  description text not null,
  category    text,
  supplier    text,
  amount      numeric not null check (amount >= 0),
  created_at  timestamptz not null default now()
);
-- Migração: adiciona supplier se a tabela já existia sem ela
alter table public.closing_expenses add column if not exists supplier text;

create index if not exists idx_expenses_closing on public.closing_expenses(closing_id);

-- ============================================================
-- TABELA: closing_attachments
-- ============================================================
create table if not exists public.closing_attachments (
  id          uuid primary key default gen_random_uuid(),
  closing_id  uuid not null references public.closings(id) on delete cascade,
  file_name   text,
  file_path   text,
  file_url    text,
  file_type   text,
  file_size   bigint,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
-- Migração: adiciona file_path se a tabela já existia sem ela
alter table public.closing_attachments add column if not exists file_path text;

create index if not exists idx_attachments_closing on public.closing_attachments(closing_id);

-- ============================================================
-- TABELA: cash_opening_adjustments
-- ============================================================
create table if not exists public.cash_opening_adjustments (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  store_id    uuid not null references public.stores(id) on delete cascade,
  authorized_by uuid references auth.users(id) on delete set null,
  start_date  date not null,
  shift       text,
  amount      numeric not null,
  reason      text not null,
  notes       text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_opening_adj_store_date on public.cash_opening_adjustments(store_id, start_date, shift);

-- ============================================================
-- TABELA: divergence_reviews
-- ============================================================
create table if not exists public.divergence_reviews (
  id          uuid primary key default gen_random_uuid(),
  closing_id  uuid not null references public.closings(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  store_id    uuid not null references public.stores(id) on delete cascade,
  divergence_type text not null,
  divergence_amount numeric not null,
  review_status text not null default 'Pendente',
  admin_comment text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_divergence_reviews_closing on public.divergence_reviews(closing_id);
create index if not exists idx_divergence_reviews_status on public.divergence_reviews(company_id, review_status);
create index if not exists idx_divergence_reviews_store on public.divergence_reviews(store_id);

-- ============================================================
-- TABELA: audit_logs
-- ============================================================
create table if not exists public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  company_id  uuid references public.companies(id) on delete set null,
  store_id    uuid references public.stores(id) on delete set null,
  action      text not null,
  entity      text,
  entity_id   uuid,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_audit_user on public.audit_logs(user_id);
create index if not exists idx_audit_company on public.audit_logs(company_id);
create index if not exists idx_audit_store on public.audit_logs(store_id);
create index if not exists idx_audit_created on public.audit_logs(created_at desc);

-- ============================================================
-- TABELA: select_options
-- ============================================================
create table if not exists public.select_options (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references public.companies(id) on delete cascade,
  category    text not null,
  value       text not null,
  is_global   boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (company_id, category, value)
);

create index if not exists idx_select_opts_category on public.select_options(category);
create index if not exists idx_select_opts_company on public.select_options(company_id);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

alter table public.companies          enable row level security;
alter table public.stores             enable row level security;
alter table public.profiles           enable row level security;
alter table public.module_permissions enable row level security;
alter table public.operation_rules    enable row level security;
alter table public.operation_configs  enable row level security;
alter table public.closings           enable row level security;
alter table public.closing_entries    enable row level security;
alter table public.closing_expenses   enable row level security;
alter table public.closing_attachments enable row level security;
alter table public.cash_opening_adjustments enable row level security;
alter table public.divergence_reviews enable row level security;
alter table public.audit_logs         enable row level security;
alter table public.select_options     enable row level security;

-- ============================================================
-- POLICIES: companies
-- ============================================================
drop policy if exists "companies_master_all"  on public.companies;
drop policy if exists "companies_admin_read"  on public.companies;
drop policy if exists "companies_op_read"     on public.companies;

create policy "companies_master_all" on public.companies
  for all to authenticated
  using (is_master())
  with check (is_master());

create policy "companies_admin_read" on public.companies
  for select to authenticated
  using (
    current_user_role() = 'admin'
    and id = current_company_id()
  );

create policy "companies_op_read" on public.companies
  for select to authenticated
  using (
    current_user_role() = 'operator'
    and id = (
      select company_id from public.stores
      where id = current_store_id() limit 1
    )
  );

-- ============================================================
-- POLICIES: stores
-- ============================================================
drop policy if exists "stores_master_all"  on public.stores;
drop policy if exists "stores_admin_read"  on public.stores;
drop policy if exists "stores_op_read"     on public.stores;

create policy "stores_master_all" on public.stores
  for all to authenticated
  using (is_master())
  with check (is_master());

create policy "stores_admin_read" on public.stores
  for select to authenticated
  using (
    current_user_role() = 'admin'
    and company_id = current_company_id()
  );

create policy "stores_op_read" on public.stores
  for select to authenticated
  using (
    current_user_role() = 'operator'
    and id = current_store_id()
  );

-- ============================================================
-- POLICIES: profiles
-- ============================================================
drop policy if exists "profiles_master_all"   on public.profiles;
drop policy if exists "profiles_own_read"     on public.profiles;
drop policy if exists "profiles_admin_read"   on public.profiles;

create policy "profiles_master_all" on public.profiles
  for all to authenticated
  using (is_master())
  with check (is_master());

create policy "profiles_own_read" on public.profiles
  for select to authenticated
  using (user_id = auth.uid());

create policy "profiles_admin_read" on public.profiles
  for select to authenticated
  using (
    current_user_role() = 'admin'
    and company_id = current_company_id()
  );

-- ============================================================
-- POLICIES: module_permissions
-- ============================================================
drop policy if exists "modperms_master_all"  on public.module_permissions;
drop policy if exists "modperms_admin_read"  on public.module_permissions;
drop policy if exists "modperms_op_read"     on public.module_permissions;

create policy "modperms_master_all" on public.module_permissions
  for all to authenticated
  using (is_master())
  with check (is_master());

create policy "modperms_admin_read" on public.module_permissions
  for select to authenticated
  using (
    current_user_role() in ('admin', 'operator')
    and company_id = current_company_id()
  );

-- ============================================================
-- POLICIES: operation_rules
-- ============================================================
drop policy if exists "op_rules_master_all"  on public.operation_rules;
drop policy if exists "op_rules_admin_read"  on public.operation_rules;
drop policy if exists "op_rules_op_read"     on public.operation_rules;

create policy "op_rules_master_all" on public.operation_rules
  for all to authenticated
  using (is_master())
  with check (is_master());

create policy "op_rules_admin_read" on public.operation_rules
  for select to authenticated
  using (
    current_user_role() = 'admin'
    and company_id = current_company_id()
  );

create policy "op_rules_op_read" on public.operation_rules
  for select to authenticated
  using (
    current_user_role() = 'operator'
    and company_id = (
      select company_id from public.stores
      where id = current_store_id() limit 1
    )
  );

-- ============================================================
-- POLICIES: operation_configs
-- ============================================================
drop policy if exists "op_configs_master_all"  on public.operation_configs;
drop policy if exists "op_configs_admin_read"  on public.operation_configs;
drop policy if exists "op_configs_op_read"     on public.operation_configs;

create policy "op_configs_master_all" on public.operation_configs
  for all to authenticated
  using (is_master())
  with check (is_master());

create policy "op_configs_admin_read" on public.operation_configs
  for select to authenticated
  using (
    current_user_role() in ('admin', 'operator')
    and company_id = current_company_id()
  );

-- ============================================================
-- POLICIES: closings
-- ============================================================
drop policy if exists "closings_master_all"   on public.closings;
drop policy if exists "closings_admin_read"   on public.closings;
drop policy if exists "closings_op_all"       on public.closings;

create policy "closings_master_all" on public.closings
  for all to authenticated
  using (is_master())
  with check (is_master());

create policy "closings_admin_read" on public.closings
  for select to authenticated
  using (
    current_user_role() = 'admin'
    and company_id = current_company_id()
  );

create policy "closings_op_all" on public.closings
  for all to authenticated
  using (
    current_user_role() = 'operator'
    and store_id = current_store_id()
  )
  with check (
    current_user_role() = 'operator'
    and store_id = current_store_id()
  );

-- ============================================================
-- POLICIES: closing_entries, closing_expenses, closing_attachments
-- (herdam via closings)
-- ============================================================
drop policy if exists "entries_master_all"  on public.closing_entries;
drop policy if exists "entries_scoped_read" on public.closing_entries;
drop policy if exists "entries_scoped_write" on public.closing_entries;

create policy "entries_master_all" on public.closing_entries
  for all to authenticated
  using (is_master())
  with check (is_master());

create policy "entries_scoped_read" on public.closing_entries
  for select to authenticated
  using (
    exists(
      select 1 from public.closings c
      where c.id = closing_id
        and (
          (current_user_role() = 'admin' and c.company_id = current_company_id())
          or
          (current_user_role() = 'operator' and c.store_id = current_store_id())
        )
    )
  );

create policy "entries_scoped_write" on public.closing_entries
  for all to authenticated
  using (
    exists(
      select 1 from public.closings c
      where c.id = closing_id
        and (
          (current_user_role() = 'admin' and c.company_id = current_company_id())
          or
          (current_user_role() = 'operator' and c.store_id = current_store_id())
        )
    )
  )
  with check (
    exists(
      select 1 from public.closings c
      where c.id = closing_id
        and (
          (current_user_role() = 'admin' and c.company_id = current_company_id())
          or
          (current_user_role() = 'operator' and c.store_id = current_store_id())
        )
    )
  );

drop policy if exists "expenses_master_all"  on public.closing_expenses;
drop policy if exists "expenses_scoped_read" on public.closing_expenses;
drop policy if exists "expenses_scoped_write" on public.closing_expenses;

create policy "expenses_master_all" on public.closing_expenses
  for all to authenticated
  using (is_master())
  with check (is_master());

create policy "expenses_scoped_read" on public.closing_expenses
  for select to authenticated
  using (
    exists(
      select 1 from public.closings c
      where c.id = closing_id
        and (
          (current_user_role() = 'admin' and c.company_id = current_company_id())
          or
          (current_user_role() = 'operator' and c.store_id = current_store_id())
        )
    )
  );

create policy "expenses_scoped_write" on public.closing_expenses
  for all to authenticated
  using (
    exists(
      select 1 from public.closings c
      where c.id = closing_id
        and (
          (current_user_role() = 'admin' and c.company_id = current_company_id())
          or
          (current_user_role() = 'operator' and c.store_id = current_store_id())
        )
    )
  )
  with check (
    exists(
      select 1 from public.closings c
      where c.id = closing_id
        and (
          (current_user_role() = 'admin' and c.company_id = current_company_id())
          or
          (current_user_role() = 'operator' and c.store_id = current_store_id())
        )
    )
  );

drop policy if exists "attachments_master_all"  on public.closing_attachments;
drop policy if exists "attachments_scoped_read" on public.closing_attachments;
drop policy if exists "attachments_scoped_write" on public.closing_attachments;

create policy "attachments_master_all" on public.closing_attachments
  for all to authenticated
  using (is_master())
  with check (is_master());

create policy "attachments_scoped_read" on public.closing_attachments
  for select to authenticated
  using (
    exists(
      select 1 from public.closings c
      where c.id = closing_id
        and (
          (current_user_role() = 'admin' and c.company_id = current_company_id())
          or
          (current_user_role() = 'operator' and c.store_id = current_store_id())
        )
    )
  );

create policy "attachments_scoped_write" on public.closing_attachments
  for all to authenticated
  using (
    exists(
      select 1 from public.closings c
      where c.id = closing_id
        and (
          (current_user_role() = 'admin' and c.company_id = current_company_id())
          or
          (current_user_role() = 'operator' and c.store_id = current_store_id())
        )
    )
  )
  with check (
    exists(
      select 1 from public.closings c
      where c.id = closing_id
        and (
          (current_user_role() = 'admin' and c.company_id = current_company_id())
          or
          (current_user_role() = 'operator' and c.store_id = current_store_id())
        )
    )
  );

-- ============================================================
-- POLICIES: audit_logs
-- ============================================================
drop policy if exists "audit_master_all"    on public.audit_logs;
drop policy if exists "audit_admin_read"    on public.audit_logs;
drop policy if exists "audit_admin_insert"  on public.audit_logs;
drop policy if exists "audit_op_insert"     on public.audit_logs;

create policy "audit_master_all" on public.audit_logs
  for all to authenticated
  using (is_master())
  with check (is_master());

create policy "audit_admin_read" on public.audit_logs
  for select to authenticated
  using (
    current_user_role() = 'admin'
    and company_id = current_company_id()
  );

-- Admin pode registrar eventos de auditoria da própria empresa
create policy "audit_admin_insert" on public.audit_logs
  for insert to authenticated
  with check (
    current_user_role() = 'admin'
    and company_id = current_company_id()
  );

create policy "audit_op_insert" on public.audit_logs
  for insert to authenticated
  with check (
    current_user_role() = 'operator'
    and store_id = current_store_id()
  );

-- ============================================================
-- POLICIES: select_options
-- ============================================================
drop policy if exists "selopts_master_all"  on public.select_options;
drop policy if exists "selopts_global_read" on public.select_options;
drop policy if exists "selopts_company_read" on public.select_options;

create policy "selopts_master_all" on public.select_options
  for all to authenticated
  using (is_master())
  with check (is_master());

create policy "selopts_global_read" on public.select_options
  for select to authenticated
  using (is_global = true);

create policy "selopts_company_read" on public.select_options
  for select to authenticated
  using (
    company_id is not null
    and company_id = current_company_id()
  );

-- ============================================================
-- ============================================================
-- POLICIES: cash_opening_adjustments, divergence_reviews
-- ============================================================
drop policy if exists "opening_adj_master_all" on public.cash_opening_adjustments;
drop policy if exists "opening_adj_admin_company" on public.cash_opening_adjustments;
drop policy if exists "reviews_master_all" on public.divergence_reviews;
drop policy if exists "reviews_admin_company" on public.divergence_reviews;

create policy "opening_adj_master_all" on public.cash_opening_adjustments
  for all to authenticated using (is_master()) with check (is_master());

create policy "opening_adj_admin_company" on public.cash_opening_adjustments
  for all to authenticated
  using (current_user_role() = 'admin' and company_id = current_company_id())
  with check (current_user_role() = 'admin' and company_id = current_company_id());

create policy "reviews_master_all" on public.divergence_reviews
  for all to authenticated using (is_master()) with check (is_master());

create policy "reviews_admin_company" on public.divergence_reviews
  for all to authenticated
  using (current_user_role() = 'admin' and company_id = current_company_id())
  with check (current_user_role() = 'admin' and company_id = current_company_id());
-- REALTIME (para sincronização ao vivo)
-- Habilitar apenas para tabelas necessárias
-- ============================================================
alter publication supabase_realtime add table public.closings;
alter publication supabase_realtime add table public.cash_opening_adjustments;
alter publication supabase_realtime add table public.divergence_reviews;
alter publication supabase_realtime add table public.audit_logs;

-- ============================================================
-- TABELA: implant_steps (checklist de implantação por empresa)
-- Execute este bloco no SQL Editor para ativar a aba Implantação
-- com sincronização Supabase.
-- ============================================================
create table if not exists public.implant_steps (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  step_key    text not null,
  step_name   text not null,
  status      text not null default 'Pendente',
  note        text,
  updated_at  timestamptz not null default now(),
  unique(company_id, step_key)
);

create trigger trg_implant_steps_updated_at
  before update on public.implant_steps
  for each row execute function set_updated_at();

alter table public.implant_steps enable row level security;

create policy "implant_master_all" on public.implant_steps
  for all to authenticated
  using (current_user_role() = 'master')
  with check (current_user_role() = 'master');

create policy "implant_admin_read" on public.implant_steps
  for select to authenticated
  using (current_user_role() = 'admin' and company_id = current_company_id());

-- ============================================================
-- TABELA: store_documents (Pasta de Documentos por Loja)
-- Arquivos independentes enviados por operadores — não vinculados a fechamentos.
-- Execute este bloco para ativar o módulo "Documentos".
-- ============================================================
create table if not exists public.store_documents (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  store_id    uuid not null references public.stores(id) on delete cascade,
  file_name   text not null,
  file_path   text,
  file_url    text,
  file_type   text,
  file_size   bigint,
  description text,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_store_docs_company on public.store_documents(company_id);
create index if not exists idx_store_docs_store   on public.store_documents(store_id);
create index if not exists idx_store_docs_created on public.store_documents(created_at desc);

alter table public.store_documents enable row level security;

drop policy if exists "store_docs_master_all"  on public.store_documents;
drop policy if exists "store_docs_admin_all"   on public.store_documents;
drop policy if exists "store_docs_op_store"    on public.store_documents;

create policy "store_docs_master_all" on public.store_documents
  for all to authenticated
  using (is_master())
  with check (is_master());

create policy "store_docs_admin_all" on public.store_documents
  for all to authenticated
  using (
    current_user_role() = 'admin'
    and company_id = current_company_id()
  )
  with check (
    current_user_role() = 'admin'
    and company_id = current_company_id()
  );

create policy "store_docs_op_store" on public.store_documents
  for all to authenticated
  using (
    current_user_role() = 'operator'
    and store_id = current_store_id()
  )
  with check (
    current_user_role() = 'operator'
    and store_id = current_store_id()
  );

-- ============================================================
-- SUPABASE STORAGE — Buckets necessários
-- Execute no SQL Editor do Supabase para criar os buckets e políticas.
-- ============================================================

-- Bucket: store-documents (Pasta de Documentos por Loja)
insert into storage.buckets (id, name, public)
values ('store-documents', 'store-documents', false)
on conflict (id) do nothing;

-- Bucket: closing-attachments (Anexos de Fechamentos)
insert into storage.buckets (id, name, public)
values ('closing-attachments', 'closing-attachments', false)
on conflict (id) do nothing;

-- Políticas de Storage — store-documents
drop policy if exists "store_docs_storage_master" on storage.objects;
drop policy if exists "store_docs_storage_admin"  on storage.objects;
drop policy if exists "store_docs_storage_op"     on storage.objects;

create policy "store_docs_storage_master"
  on storage.objects for all to authenticated
  using   (bucket_id = 'store-documents' and is_master())
  with check (bucket_id = 'store-documents' and is_master());

create policy "store_docs_storage_admin"
  on storage.objects for all to authenticated
  using   (bucket_id = 'store-documents' and current_user_role() = 'admin')
  with check (bucket_id = 'store-documents' and current_user_role() = 'admin');

create policy "store_docs_storage_op"
  on storage.objects for all to authenticated
  using   (bucket_id = 'store-documents' and current_user_role() = 'operator')
  with check (bucket_id = 'store-documents' and current_user_role() = 'operator');

-- Políticas de Storage — closing-attachments
drop policy if exists "closing_att_storage_master" on storage.objects;
drop policy if exists "closing_att_storage_admin"  on storage.objects;
drop policy if exists "closing_att_storage_op"     on storage.objects;

create policy "closing_att_storage_master"
  on storage.objects for all to authenticated
  using   (bucket_id = 'closing-attachments' and is_master())
  with check (bucket_id = 'closing-attachments' and is_master());

create policy "closing_att_storage_admin"
  on storage.objects for select to authenticated
  using (bucket_id = 'closing-attachments' and current_user_role() = 'admin');

create policy "closing_att_storage_op"
  on storage.objects for all to authenticated
  using   (bucket_id = 'closing-attachments' and current_user_role() = 'operator')
  with check (bucket_id = 'closing-attachments' and current_user_role() = 'operator');

-- ============================================================
-- COMO CRIAR O PRIMEIRO USUÁRIO MASTER
-- ============================================================
-- 1. Crie o usuário no painel: Authentication → Users → Add User
-- 2. Após criar, execute o INSERT abaixo com o UUID gerado:
--
-- insert into public.profiles (user_id, name, email, role, status)
-- values (
--   '<UUID_DO_USUARIO_CRIADO_NO_AUTH>',
--   'Gestão 5X',
--   'adm@gestao5x.com.br',
--   'master',
--   'Ativo'
-- );
--
-- PARA CRIAR ADMIN DE CLIENTE:
-- insert into public.profiles (user_id, name, email, role, company_id, status)
-- values (
--   '<UUID_DO_ADMIN>',
--   'Nome do Admin',
--   'admin@cliente.com.br',
--   'admin',
--   '<UUID_DA_EMPRESA>',
--   'Ativo'
-- );
--
-- PARA CRIAR OPERADOR:
-- insert into public.profiles (user_id, name, email, role, company_id, store_id, status)
-- values (
--   '<UUID_DO_OPERADOR>',
--   'Nome do Operador',
--   'operador@cliente.com.br',
--   'operator',
--   '<UUID_DA_EMPRESA>',
--   '<UUID_DA_LOJA>',
--   'Ativo'
-- );
