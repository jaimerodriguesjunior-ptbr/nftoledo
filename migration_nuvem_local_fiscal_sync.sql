-- Status de sincronização do cadastro da empresa com a Nuvem Local Fiscal.
-- Execute no SQL Editor do Supabase usado por este projeto.
alter table company_settings add column if not exists local_fiscal_sync_status text;
alter table company_settings add column if not exists local_fiscal_sync_message text;
alter table company_settings add column if not exists local_fiscal_last_sync_at timestamptz;
