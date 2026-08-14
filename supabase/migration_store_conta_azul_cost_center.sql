-- Centro de custo Conta Azul vinculado opcionalmente por loja.
-- Se ficar vazio, exportacao/envio seguem com Centro de Custo vazio.

alter table public.stores
  add column if not exists conta_azul_cost_center_id text,
  add column if not exists conta_azul_cost_center_name text;
