"use server";

import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";

async function getOrgId() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado");

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();

  return { supabase, orgId: profile?.organization_id as string };
}

type ClientServiceRow = {
  id: string;
  descricao: string;
  valor_mensal?: number | null;
  codigo_servico?: string | null;
  cnae?: string | null;
  aliquota_iss?: number | null;
  ativo?: boolean | null;
};

type ClientRow = {
  id: string;
  nome: string;
  cpf_cnpj?: string | null;
  client_services?: ClientServiceRow[] | null;
  [key: string]: unknown;
};

type InvoiceSummary = {
  client_id: string | null;
  status: string | null;
};

function normalizeEnvironment(value?: string | null): "production" | "homologation" {
  return value === "homologation" ? "homologation" : "production";
}

function isMissingBatchOriginColumn(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "42703"
  );
}

export async function getClients() {
  const { supabase, orgId } = await getOrgId();

  const { data, error } = await supabase
    .from("clients")
    .select(`*, client_services(*)`)
    .eq("organization_id", orgId)
    .eq("ativo", true)
    .order("nome");

  if (error) throw error;
  return data || [];
}

export async function getClient(id: string) {
  const { supabase, orgId } = await getOrgId();

  const { data, error } = await supabase
    .from("clients")
    .select(`*, client_services(*)`)
    .eq("id", id)
    .eq("organization_id", orgId)
    .single();

  if (error) throw error;
  return data;
}

export async function getClientsWithServices() {
  const { supabase, orgId } = await getOrgId();

  const { data, error } = await supabase
    .from("clients")
    .select(`*, client_services(*)`)
    .eq("organization_id", orgId)
    .eq("ativo", true)
    .order("nome");

  if (error) throw error;

  return ((data || []) as ClientRow[]).map((c) => ({
    ...c,
    client_services: (c.client_services || []).filter((s) => s.ativo),
  }));
}

export async function getClientsForBatch(mesReferencia: string, environment?: "production" | "homologation") {
  const { supabase, orgId } = await getOrgId();

  const [
    { data: clients, error: clientsError },
    { data: company },
  ] =
    await Promise.all([
      supabase
        .from("clients")
        .select(`*, client_services(*)`)
        .eq("organization_id", orgId)
        .eq("ativo", true)
        .order("nome"),
      supabase
        .from("company_settings")
        .select("environment")
        .eq("organization_id", orgId)
        .maybeSingle(),
    ]);

  const batchEnvironment = normalizeEnvironment(environment || company?.environment);

  const { data: invoices, error: invoicesError } = await supabase
    .from("fiscal_invoices")
    .select("client_id, status")
    .eq("organization_id", orgId)
    .eq("mes_referencia", mesReferencia)
    .eq("emission_origin", "batch")
    .eq("environment", batchEnvironment);

  if (clientsError) throw clientsError;
  if (invoicesError) {
    if (isMissingBatchOriginColumn(invoicesError)) {
      throw new Error("Banco desatualizado: execute migration_batch_origin.sql no Supabase antes de usar emissão em lote.");
    }

    throw invoicesError;
  }

  const allClients = (clients || []) as ClientRow[];
  const allInvoices = (invoices || []) as InvoiceSummary[];

  const emittedClientIds = new Set(
    allInvoices
      .filter((invoice) => !["error", "cancelled"].includes(invoice.status || ""))
      .map((invoice) => invoice.client_id)
  );

  const clientsWithServices = allClients.filter(
    (c) => (c.client_services || []).some((s) => s.ativo)
  );

  const available = allClients
    .filter((client) => !emittedClientIds.has(client.id))
    .map((client) => {
      const activeServices = (client.client_services || []).filter((service) => service.ativo);
      const service = activeServices[0] || null;

      return {
        ...client,
        batch_service: service
          ? {
              id: service.id,
              descricao: service.descricao,
              valor_mensal: service.valor_mensal,
            }
          : null,
      };
    })
    .sort((left, right) => {
      const serviceOrder = Number(Boolean(right.batch_service)) - Number(Boolean(left.batch_service));
      if (serviceOrder !== 0) return serviceOrder;
      return left.nome.localeCompare(right.nome, "pt-BR");
    });

  return {
    clients: available,
    totalClients: allClients.length,
    totalWithServices: clientsWithServices.length,
    alreadyEmitted: emittedClientIds.size,
    environment: batchEnvironment,
  };
}

type ServiceInput = {
  id?: string;
  descricao: string;
  valor_mensal?: number | null;
  codigo_servico?: string;
  cnae?: string;
  aliquota_iss?: number | null;
};

type ClientInput = {
  id?: string;
  nome: string;
  cpf_cnpj?: string;
  email?: string;
  telefone?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  cep?: string;
  codigo_municipio_ibge?: string;
  services?: ServiceInput[];
};

export async function saveClient(data: ClientInput) {
  const { supabase, orgId } = await getOrgId();
  if (!orgId) return { error: "Organização não encontrada" };

  let clientId = data.id;
  const baseData = {
    nome: data.nome,
    cpf_cnpj: data.cpf_cnpj || null,
    email: data.email || null,
    telefone: data.telefone || null,
    logradouro: data.logradouro || null,
    numero: data.numero || null,
    complemento: data.complemento || null,
    bairro: data.bairro || null,
    cidade: data.cidade || null,
    uf: data.uf || null,
    cep: data.cep || null,
    codigo_municipio_ibge: data.codigo_municipio_ibge || null,
  };

  if (clientId) {
    const { error } = await supabase
      .from("clients")
      .update({ ...baseData, updated_at: new Date().toISOString() })
      .eq("id", clientId)
      .eq("organization_id", orgId);

    if (error) return { error: error.message };
  } else {
    const { data: newClient, error } = await supabase
      .from("clients")
      .insert({ organization_id: orgId, ...baseData })
      .select()
      .single();

    if (error) return { error: error.message };
    clientId = newClient.id;
  }

  if (data.services !== undefined && clientId) {
    await supabase
      .from("client_services")
      .delete()
      .eq("client_id", clientId)
      .eq("organization_id", orgId);

    const active = (data.services || []).filter((s) => s.descricao?.trim());
    if (active.length > 0) {
      const { error } = await supabase.from("client_services").insert(
        active.map((s) => ({
          organization_id: orgId,
          client_id: clientId,
          descricao: s.descricao,
          valor_mensal: s.valor_mensal || null,
          codigo_servico: s.codigo_servico || null,
          cnae: s.cnae || null,
          aliquota_iss: s.aliquota_iss || null,
        }))
      );
      if (error) return { error: error.message };
    }
  }

  revalidatePath("/clientes");
  return { success: true, id: clientId };
}

export async function saveClientBatchService(data: {
  clientId: string;
  descricao: string;
  valorMensal: number;
  codigoServico?: string | null;
  cnae?: string | null;
  aliquotaIss?: number | null;
  skipRevalidation?: boolean;
}) {
  const { supabase, orgId } = await getOrgId();
  if (!orgId) return { error: "Organizacao nao encontrada" };

  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("id", data.clientId)
    .eq("organization_id", orgId)
    .eq("ativo", true)
    .single();

  if (!client) return { error: "Cliente nao encontrado." };

  const { data: service } = await supabase
    .from("client_services")
    .select("id")
    .eq("client_id", data.clientId)
    .eq("organization_id", orgId)
    .eq("ativo", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();

  const payload = {
    descricao: data.descricao,
    valor_mensal: data.valorMensal,
    codigo_servico: data.codigoServico || null,
    cnae: data.cnae || null,
    aliquota_iss: data.aliquotaIss ?? null,
  };

  if (service?.id) {
    const { error } = await supabase
      .from("client_services")
      .update(payload)
      .eq("id", service.id)
      .eq("organization_id", orgId);

    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("client_services").insert({
      organization_id: orgId,
      client_id: data.clientId,
      ...payload,
    });

    if (error) return { error: error.message };
  }

  if (!data.skipRevalidation) {
    revalidatePath("/lote");
    revalidatePath("/clientes");
  }
  return { success: true };
}

export async function deleteClient(id: string) {
  const { supabase, orgId } = await getOrgId();

  const { error } = await supabase
    .from("clients")
    .update({ ativo: false })
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) return { error: error.message };

  revalidatePath("/clientes");
  return { success: true };
}
