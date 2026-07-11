-- ============================================================
-- MIGRAÇÃO — Categoria e Cliente em Entradas
-- Data: 2026-07-11
-- Seguro para re-executar (usa IF NOT EXISTS).
-- ============================================================


-- ============================================================
-- 1. COLUNAS FALTANTES: closing_entries.category / closing_entries.client
--    Guardam a categoria e o cliente selecionados em cada lançamento de
--    entrada, usados no formulário de Fechamento Diário e na exportação
--    da planilha de importação do Conta Azul (mesmo padrão já usado em
--    closing_expenses.category/supplier para as saídas).
-- ============================================================
alter table public.closing_entries
  add column if not exists category text;
alter table public.closing_entries
  add column if not exists client text;


-- ============================================================
-- Observações:
-- * Categorias de entrada e Clientes por empresa reutilizam a tabela
--   select_options (categorias 'entryCategories' e 'clientes'),
--   já possui company_id — nenhuma tabela nova é necessária.
-- ============================================================
