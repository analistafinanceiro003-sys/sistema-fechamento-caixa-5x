-- Restricao adicional: cadastros sincronizados do Conta Azul sao mantidos
-- somente pelo Master. Admin/Analista podem consultar conforme politica de leitura.

drop policy if exists "conta_azul_catalog_admin_update" on public.conta_azul_catalog_items;
