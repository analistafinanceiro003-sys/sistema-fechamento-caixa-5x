-- ============================================================
-- MIGRAÇÃO DE LANÇAMENTO — Execute COMPLETO no SQL Editor do Supabase
-- Data: 2026-06-07
-- Corrige divergências entre o schema em produção e o código atual.
-- Seguro para re-executar (usa IF NOT EXISTS / ON CONFLICT / DROP IF EXISTS).
-- ============================================================


-- ============================================================
-- 1. COLUNA FALTANTE: closing_attachments.uploaded_by
--    O código grava quem fez upload; a coluna não existe no DB.
-- ============================================================
alter table public.closing_attachments
  add column if not exists uploaded_by uuid references auth.users(id) on delete set null;


-- ============================================================
-- 2. POLÍTICA FALTANTE: escrita em closing_attachments
--    Sem isso, operadores não conseguem salvar anexos de fechamento.
-- ============================================================
drop policy if exists "attachments_scoped_write" on public.closing_attachments;

create policy "attachments_scoped_write" on public.closing_attachments
  for all to authenticated
  using (
    exists(
      select 1 from public.closings c
      where c.id = closing_id
        and (
          (current_user_role() = 'admin'    and c.company_id = current_company_id())
          or
          (current_user_role() = 'operator' and c.store_id   = current_store_id())
        )
    )
  )
  with check (
    exists(
      select 1 from public.closings c
      where c.id = closing_id
        and (
          (current_user_role() = 'admin'    and c.company_id = current_company_id())
          or
          (current_user_role() = 'operator' and c.store_id   = current_store_id())
        )
    )
  );


-- ============================================================
-- 3. POLÍTICA FALTANTE: admin pode gravar audit_logs
--    Sem isso, ações do Admin (como confirmar repasse) não são auditadas.
-- ============================================================
drop policy if exists "audit_admin_insert" on public.audit_logs;

create policy "audit_admin_insert" on public.audit_logs
  for insert to authenticated
  with check (
    current_user_role() = 'admin'
    and company_id = current_company_id()
  );


-- ============================================================
-- 4. TABELA FALTANTE: transfer_receipts (Repasses Recebidos)
--    Sem isso, a aba "Repasses Recebidos" do Admin não persiste dados.
-- ============================================================
create table if not exists public.transfer_receipts (
  id           uuid        primary key default gen_random_uuid(),
  closing_id   uuid        not null,
  company_id   uuid        references public.companies(id) on delete set null,
  store_id     uuid        references public.stores(id)   on delete set null,
  amount       numeric(12,2) not null default 0,
  confirmed_by text,
  notes        text,
  confirmed_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index if not exists idx_transfer_receipts_closing  on public.transfer_receipts(closing_id);
create index if not exists idx_transfer_receipts_company  on public.transfer_receipts(company_id);

alter table public.transfer_receipts enable row level security;

drop policy if exists "receipts_master_all"         on public.transfer_receipts;
drop policy if exists "receipts_admin_company"      on public.transfer_receipts;
drop policy if exists "receipts_op_insert"          on public.transfer_receipts;

create policy "receipts_master_all" on public.transfer_receipts
  for all to authenticated
  using (is_master()) with check (is_master());

create policy "receipts_admin_company" on public.transfer_receipts
  for all to authenticated
  using   (current_user_role() = 'admin' and company_id = current_company_id())
  with check (current_user_role() = 'admin' and company_id = current_company_id());

create policy "receipts_op_insert" on public.transfer_receipts
  for insert to authenticated
  with check (
    current_user_role() = 'operator'
    and store_id = current_store_id()
  );


-- ============================================================
-- 5. TABELA FALTANTE: implant_steps (Checklist de Implantação)
--    Sem isso, a sub-aba Implantação não persiste dados.
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

do $$
begin
  if not exists (
    select 1 from information_schema.triggers
    where trigger_name = 'trg_implant_steps_updated_at'
  ) then
    create trigger trg_implant_steps_updated_at
      before update on public.implant_steps
      for each row execute function set_updated_at();
  end if;
end;
$$;

alter table public.implant_steps enable row level security;

drop policy if exists "implant_master_all" on public.implant_steps;
drop policy if exists "implant_admin_read" on public.implant_steps;

create policy "implant_master_all" on public.implant_steps
  for all to authenticated
  using   (current_user_role() = 'master')
  with check (current_user_role() = 'master');

create policy "implant_admin_read" on public.implant_steps
  for select to authenticated
  using (current_user_role() = 'admin' and company_id = current_company_id());


-- ============================================================
-- 6. TABELA NOVA: store_documents (Pasta de Documentos por Loja)
--    Módulo novo — operadores enviam arquivos para sua loja.
-- ============================================================
create table if not exists public.store_documents (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  store_id    uuid not null references public.stores(id)   on delete cascade,
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

drop policy if exists "store_docs_master_all" on public.store_documents;
drop policy if exists "store_docs_admin_all"  on public.store_documents;
drop policy if exists "store_docs_op_store"   on public.store_documents;

create policy "store_docs_master_all" on public.store_documents
  for all to authenticated
  using (is_master()) with check (is_master());

create policy "store_docs_admin_all" on public.store_documents
  for all to authenticated
  using   (current_user_role() = 'admin' and company_id = current_company_id())
  with check (current_user_role() = 'admin' and company_id = current_company_id());

create policy "store_docs_op_store" on public.store_documents
  for all to authenticated
  using   (current_user_role() = 'operator' and store_id = current_store_id())
  with check (current_user_role() = 'operator' and store_id = current_store_id());


-- ============================================================
-- 7. STORAGE — Buckets e políticas
--    Cria os buckets privados para upload de arquivos.
-- ============================================================

-- Bucket: closing-attachments (Anexos de Fechamentos)
insert into storage.buckets (id, name, public)
values ('closing-attachments', 'closing-attachments', false)
on conflict (id) do nothing;

-- Bucket: store-documents (Pasta de Documentos por Loja)
insert into storage.buckets (id, name, public)
values ('store-documents', 'store-documents', false)
on conflict (id) do nothing;

-- Políticas: closing-attachments
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

-- Políticas: store-documents
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


-- ============================================================
-- FIM DA MIGRAÇÃO
-- Após executar com sucesso, o sistema estará pronto para o lançamento.
-- ============================================================
