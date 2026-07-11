-- ============================================================
-- MIGRAÇÃO — Filtro por operador, Fornecedor em Saídas e Retificação
-- Data: 2026-07-10
-- Seguro para re-executar (usa IF NOT EXISTS).
-- ============================================================


-- ============================================================
-- 1. COLUNA FALTANTE: closing_expenses.supplier
--    Guarda o fornecedor selecionado em cada lançamento de saída,
--    usado no formulário de Fechamento Diário e na exportação Conta Azul.
-- ============================================================
alter table public.closing_expenses
  add column if not exists supplier text;


-- ============================================================
-- 2. RESTRIÇÃO DESATUALIZADA: closings.type não permitia 'Excluído'
--    O app marca um fechamento excluído com type = 'Excluído', mas a
--    constraint original só aceitava 'Original'/'Retificado' — por isso
--    o botão "Excluir" na aba Movimentações falhava mesmo para o Master.
-- ============================================================
alter table public.closings drop constraint if exists closings_type_check;
alter table public.closings add constraint closings_type_check
  check (type in ('Original', 'Retificado', 'Excluído'));


-- ============================================================
-- Observações:
-- * Filtro por operador (Relatórios/Movimentações/Fechamento) usa
--   closings.operator_user_id, que já existe no schema — nenhuma
--   coluna nova é necessária.
-- * Fornecedores por cliente reutilizam a tabela select_options
--   (já possui company_id) — nenhuma coluna nova é necessária.
-- * Retificação pelo master reutiliza closings.type = 'Retificado'
--   + notes — nenhuma coluna nova é necessária.
-- ============================================================
