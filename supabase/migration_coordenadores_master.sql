-- ============================================================
-- MIGRAÇÃO — Coordenadores (múltiplos acessos Master)
-- Data: 2026-07-11
-- Seguro para re-executar (usa IF NOT EXISTS / DROP POLICY IF EXISTS).
--
-- Permite ao dono da conta criar outros usuários com o MESMO acesso total
-- de Master (todas as empresas, todas as abas) pela tela Sistema →
-- Coordenadores, em vez de só o dono original poder existir como Master.
-- Por segurança, só quem tem is_owner=true pode criar, editar, redefinir
-- senha ou excluir OUTRO acesso Master — um coordenador tem o mesmo poder
-- operacional do dono, mas não pode criar nem remover outros Masters.
--
-- Este arquivo é o mesmo bloco já incluído em schema.sql (seção
-- "COORDENADORES"), disponibilizado separadamente para quem já tem o
-- banco em produção e só precisa aplicar a diferença.
-- ============================================================

alter table public.profiles add column if not exists is_owner boolean not null default false;

-- Marca o(s) Master(s) já existente(s) como dono — necessário para não
-- travar o próprio acesso ao rodar esta migração pela primeira vez.
update public.profiles set is_owner = true where role = 'master' and is_owner = false;

-- Retorna true se o usuário autenticado é o dono (Master com is_owner=true)
create or replace function is_owner()
returns boolean
language sql security definer stable
as $$
  select exists(
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'master' and is_owner = true
  );
$$;

-- Substitui a policy única "profiles_master_all" por 4 policies por
-- comando: leitura continua livre para qualquer Master (para a lista de
-- Coordenadores aparecer para todos), mas criar/editar/excluir uma linha
-- com role='master' exige is_owner().
drop policy if exists "profiles_master_all" on public.profiles;
drop policy if exists "profiles_master_select" on public.profiles;
drop policy if exists "profiles_master_insert" on public.profiles;
drop policy if exists "profiles_master_update" on public.profiles;
drop policy if exists "profiles_master_delete" on public.profiles;

create policy "profiles_master_select" on public.profiles
  for select to authenticated
  using (is_master());

create policy "profiles_master_insert" on public.profiles
  for insert to authenticated
  with check (is_master() and (role <> 'master' or is_owner()));

create policy "profiles_master_update" on public.profiles
  for update to authenticated
  using (is_master() and (role <> 'master' or is_owner()))
  with check (is_master() and (role <> 'master' or is_owner()));

create policy "profiles_master_delete" on public.profiles
  for delete to authenticated
  using (is_master() and (role <> 'master' or is_owner()));
