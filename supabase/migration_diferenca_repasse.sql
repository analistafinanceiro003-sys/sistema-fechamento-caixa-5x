-- ============================================================
-- MIGRAÇÃO — Aceitar/Encerrar diferença de repasse (transfer_waivers)
-- Data: 2026-07-11
-- Seguro para re-executar (usa IF NOT EXISTS / DROP POLICY IF EXISTS).
--
-- Quando o repasse informado por um fechamento fica abaixo do esperado
-- (fundo padrão da loja) e o cliente nunca chega a confirmar o repasse, a
-- diferença ficava "pendente" para sempre em Resumo por Fechamento e em
-- Repasses. Esta tabela guarda o aceite/encerramento dessa diferença pelo
-- Master (com justificativa obrigatória) — não apaga nem finge que o valor
-- foi recebido, só registra que foi revisado e aceito como está.
--
-- Este arquivo é o mesmo bloco já incluído em schema.sql (seção
-- "DIFERENÇA DE REPASSE — ACEITAR/ENCERRAR"), disponibilizado
-- separadamente para quem já tem o banco em produção e só precisa aplicar
-- a diferença.
-- ============================================================

create table if not exists public.transfer_waivers (
  id          uuid primary key default gen_random_uuid(),
  closing_id  uuid not null references public.closings(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  store_id    uuid not null references public.stores(id) on delete cascade,
  amount      numeric not null default 0,
  reason      text not null,
  waived_by   text,
  waived_at   timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index if not exists idx_transfer_waivers_closing on public.transfer_waivers(closing_id);
create index if not exists idx_transfer_waivers_company on public.transfer_waivers(company_id);

alter table public.transfer_waivers enable row level security;

drop policy if exists "transfer_waivers_master_all" on public.transfer_waivers;
create policy "transfer_waivers_master_all" on public.transfer_waivers
  for all to authenticated
  using (is_master())
  with check (is_master());

drop policy if exists "transfer_waivers_admin_read" on public.transfer_waivers;
create policy "transfer_waivers_admin_read" on public.transfer_waivers
  for select to authenticated
  using (current_user_role() = 'admin' and company_id = current_company_id());

drop policy if exists "transfer_waivers_analyst_all" on public.transfer_waivers;
create policy "transfer_waivers_analyst_all" on public.transfer_waivers
  for all to authenticated
  using (is_analyst() and company_id = any(current_analyst_company_ids()))
  with check (is_analyst() and company_id = any(current_analyst_company_ids()));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'transfer_waivers'
  ) then
    alter publication supabase_realtime add table public.transfer_waivers;
  end if;
end $$;
