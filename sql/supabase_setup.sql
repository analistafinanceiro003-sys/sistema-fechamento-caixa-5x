-- =====================================================
-- CAIXA 5X — Setup do banco de dados no Supabase
-- Execute este SQL no SQL Editor do Supabase
-- =====================================================

-- Tabela que armazena todo o estado da aplicação como JSON
CREATE TABLE IF NOT EXISTS app_state (
  id TEXT PRIMARY KEY DEFAULT 'global',
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ativa Row Level Security
ALTER TABLE app_state ENABLE ROW LEVEL SECURITY;

-- Política: permite leitura e escrita para qualquer requisição anônima
-- (para desenvolvimento — restrinja depois conforme necessário)
CREATE POLICY "Allow public access" ON app_state
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- SUPABASE REALTIME — sincronização em tempo real
-- Necessário para o operador espelhar para o gestor
-- =====================================================

-- Envia a linha completa (incluindo o campo data JSONB) nas notificações
ALTER TABLE app_state REPLICA IDENTITY FULL;

-- Adiciona a tabela ao canal de eventos em tempo real do Supabase
ALTER PUBLICATION supabase_realtime ADD TABLE app_state;
