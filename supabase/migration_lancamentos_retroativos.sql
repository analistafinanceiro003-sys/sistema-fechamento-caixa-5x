-- ============================================================
-- MIGRAÇÃO — Lançamentos Retroativos
-- Data: 2026-07-11
-- Seguro para re-executar (usa IF NOT EXISTS).
--
-- Adiciona a coluna que libera, por empresa, o lançamento de fechamentos
-- com data passada (Operação → Configuração Operacional → "Permitir
-- lançamentos retroativos"). Sem essa coluna, todo fechamento novo é
-- travado na data de hoje, mesmo para o Master.
-- ============================================================

alter table public.operation_configs
  add column if not exists allow_backdated_closings boolean not null default false;
