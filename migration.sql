-- ============================================================
-- NF Fácil - Schema Multi-tenant
-- Execute no SQL Editor do Supabase
-- ============================================================

-- Organizations (um por cliente do SaaS)
create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

-- Profiles (liga auth.users → organizations)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references organizations(id),
  full_name text,
  created_at timestamptz default now()
);

-- Se profiles já existia sem organization_id (execução idempotente)
alter table profiles add column if not exists organization_id uuid references organizations(id);
alter table profiles add column if not exists full_name text;

-- Dados da empresa do tenant
create table if not exists company_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) unique not null,
  cnpj text,
  razao_social text,
  nome_fantasia text,
  inscricao_municipal text,
  inscricao_estadual text,
  regime_tributario text default '1',
  codigo_municipio_ibge text,
  cidade text,
  uf text,
  cep text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  email_contato text,
  telefone text,
  nfse_login text,
  nfse_password text,
  cnae_padrao text,
  codigo_servico_padrao text,
  aliquota_iss_padrao numeric(5,2) default 3.0,
  environment text default 'production',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Clientes do tenant
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) not null,
  nome text not null,
  cpf_cnpj text,
  email text,
  telefone text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  uf text,
  cep text,
  codigo_municipio_ibge text,
  ativo boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Serviços recorrentes por cliente
create table if not exists client_services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) not null,
  client_id uuid references clients(id) on delete cascade not null,
  descricao text not null,
  valor_mensal numeric(10,2),
  codigo_servico text,
  cnae text,
  aliquota_iss numeric(5,2),
  ativo boolean default true,
  created_at timestamptz default now()
);

-- Notas fiscais emitidas
create table if not exists fiscal_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) not null,
  client_id uuid references clients(id),
  tipo_documento text default 'NFSe',
  status text default 'draft',
  environment text default 'production',
  valor_total numeric(10,2),
  descricao_servico text,
  codigo_servico text,
  cnae text,
  aliquota_iss numeric(5,2),
  data_emissao timestamptz,
  mes_referencia text,
  emission_origin text default 'single',
  nuvemfiscal_uuid text,
  numero text,
  serie text,
  chave_acesso text,
  xml_url text,
  pdf_url text,
  xml_content text,
  payload_json jsonb,
  error_message text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- RLS - Row Level Security
-- ============================================================

alter table organizations enable row level security;
alter table profiles enable row level security;
alter table company_settings enable row level security;
alter table clients enable row level security;
alter table client_services enable row level security;
alter table fiscal_invoices enable row level security;

-- Helper: retorna o organization_id do usuário logado
create or replace function get_user_org_id()
returns uuid
language sql
security definer
stable
as $$
  select organization_id from profiles where id = auth.uid()
$$;

-- Policies
create policy "org_select" on organizations for select using (id = get_user_org_id());
create policy "org_update" on organizations for update using (id = get_user_org_id());

create policy "profile_select" on profiles for select using (id = auth.uid());
create policy "profile_update" on profiles for update using (id = auth.uid());
create policy "profile_insert" on profiles for insert with check (id = auth.uid());

create policy "company_all" on company_settings for all using (organization_id = get_user_org_id());

create policy "clients_all" on clients for all using (organization_id = get_user_org_id());

create policy "services_all" on client_services for all using (organization_id = get_user_org_id());

create policy "invoices_all" on fiscal_invoices for all using (organization_id = get_user_org_id());

-- ============================================================
-- Trigger: cria org + profile automaticamente ao cadastrar
-- ============================================================

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
begin
  insert into organizations (name)
  values (coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  returning id into new_org_id;

  insert into profiles (id, organization_id, full_name)
  values (
    new.id,
    new_org_id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
