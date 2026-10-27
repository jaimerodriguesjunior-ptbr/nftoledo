"use server";

import { createClient } from "@/utils/supabase/server";
import { getNuvemFiscalToken } from "@/lib/nuvemfiscal";
import { revalidatePath } from "next/cache";
import { getLocalFiscalBaseUrl } from "@/lib/local-fiscal-config";
import { NFSE_PROVIDER, nationalServiceCode, nationalMunicipalityCode, readNationalNfseConfig, buildNfseDates } from "@/lib/nfse-national";
import { buildNationalIss } from "@/lib/nfse-iss";

async function getOrgId() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado");

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();

  return { supabase, orgId: profile?.organization_id as string, userId: user.id };
}

function toMoneyNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return Number(value.toFixed(2));
  if (typeof value === "string") {
    const compact = value.trim().replace(/\s/g, "");
    const normalized = compact.includes(",")
      ? compact.replace(/\./g, "").replace(",", ".")
      : compact.replace(/,/g, "");
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return Number(parsed.toFixed(2));
  }
  return fallback;
}

function onlyDigits(value: unknown): string {
  return String(value || "").replace(/\D/g, "");
}

function hasValidCpfOrCnpj(value: unknown): boolean {
  const doc = onlyDigits(value);

  if (doc.length === 11) {
    if (/^(\d)\1+$/.test(doc)) return false;
    const calc = (slice: string, factor: number) => {
      const total = slice.split("").reduce((sum, digit) => sum + Number(digit) * factor--, 0);
      const rest = (total * 10) % 11;
      return rest === 10 ? 0 : rest;
    };
    return calc(doc.slice(0, 9), 10) === Number(doc[9]) && calc(doc.slice(0, 10), 11) === Number(doc[10]);
  }

  if (doc.length === 14) {
    if (/^(\d)\1+$/.test(doc)) return false;
    const calc = (slice: string, factors: number[]) => {
      const total = slice.split("").reduce((sum, digit, index) => sum + Number(digit) * factors[index], 0);
      const rest = total % 11;
      return rest < 2 ? 0 : 11 - rest;
    };
    return (
      calc(doc.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(doc[12]) &&
      calc(doc.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(doc[13])
    );
  }

  return false;
}

type EmitirParams = {
  clientId: string;
  descricao: string;
  valor: number;
  environment?: "production" | "homologation";
  dataCompetencia?: string;
  mesReferencia?: string;
  emissionOrigin?: "single" | "batch";
};

type NuvemResult = {
  id?: string;
  numero?: string;
  serie?: string;
  error?: { message?: string };
  status?: string;
  mensagens?: Array<{ codigo?: string | number; descricao?: string }>;
  motivo_status?: string;
  chave?: string;
  codigo_verificacao?: string;
  xml_url?: string;
  pdf_url?: string;
  link_url?: string;
  [key: string]: unknown;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function nfseOutcomeFromProvider(result: NuvemResult, fallback: string) {
  const status = String(result.status || "").toLowerCase();
  if (["autorizado", "autorizada"].includes(status)) return { status: "authorized", errorMessage: null };
  if (["cancelado", "cancelada"].includes(status)) return { status: "cancelled", errorMessage: null };
  if (["erro", "rejeitado", "rejeitada", "negado", "negada"].includes(status)) {
    const message = result.mensagens?.length
      ? result.mensagens.map(m => `${m.codigo}: ${m.descricao}`).join(" | ")
      : String(result.motivo || result.motivo_status || result.message || JSON.stringify(result));
    return { status: "error", errorMessage: message };
  }
  return { status: fallback, errorMessage: null };
}

function nfseProviderFields(result: NuvemResult) {
  return {
    ...(result.id ? { nuvemfiscal_uuid: result.id } : {}),
    ...(result.numero != null ? { numero: String(result.numero) } : {}),
    ...(result.serie != null ? { serie: String(result.serie) } : {}),
    chave_acesso: result.chave || result.codigo_verificacao,
    xml_url: result.xml_url,
    pdf_url: result.pdf_url || result.link_url,
  };
}

async function readNuvemResult(response: Response): Promise<NuvemResult> {
  const body = await response.text();
  try {
    const result = JSON.parse(body) as NuvemResult;
    return {
      ...result,
      ...(result.numero != null ? { numero: String(result.numero) } : {}),
      ...(result.serie != null ? { serie: String(result.serie) } : {}),
    };
  }
  catch { return { message: body }; }
}

async function transmitPreparedHomologationDps(baseUrl: string, token: string, result: NuvemResult) {
  if (result.status !== "processamento" || result.motivo_status !== "NFSE_NACIONAL_DPS_GENERATED" || !result.id) return result;
  const response = await fetch(`${baseUrl}/nfse/${result.id}/transmitir-homologacao-nacional`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ confirmacao: "TRANSMITIR DPS NACIONAL EM HOMOLOGACAO" }),
  });
  if (response.status === 409) {
    const current = await fetch(`${baseUrl}/nfse/${result.id}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    });
    if (current.ok) return { ...result, ...await readNuvemResult(current) };
  }
  const transmitted = await readNuvemResult(response);
  return { ...result, ...transmitted,
    ...(!response.ok ? { status: "erro", motivo: transmitted.message || transmitted.motivo || "Falha ao transmitir a DPS de homologação." } : {}),
  };
}

function isMissingBatchOriginColumn(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "42703"
  );
}

export async function emitirNFSe(params: EmitirParams) {
  const { supabase, orgId } = await getOrgId();
  let invoiceId: string | null = null;

  try {
    const {
      clientId,
      descricao,
      valor,
      environment,
      dataCompetencia,
      mesReferencia,
      emissionOrigin = "single",
    } = params;

    // Buscar empresa
    const { data: company } = await supabase
      .from("company_settings")
      .select("*")
      .eq("organization_id", orgId)
      .single();

    if (!company) throw new Error("Configure os dados da sua empresa antes de emitir.");

    // Buscar cliente
    const { data: client } = await supabase
      .from("clients")
      .select("*")
      .eq("id", clientId)
      .eq("organization_id", orgId)
      .single();

    if (!client) throw new Error("Cliente não encontrado.");

    const { dhEmi, dCompet, mesReferencia: mesAuto } = buildNfseDates(dataCompetencia);
    const mesFinal = mesReferencia || mesAuto;
    const cleanDoc = onlyDigits(client.cpf_cnpj);

    if (!hasValidCpfOrCnpj(cleanDoc)) {
      throw new Error("CPF/CNPJ do cliente ausente ou invalido.");
    }

    const env = environment || company.environment || "production";

    if (emissionOrigin === "batch") {
      const { data: existingBatchInvoice, error: existingBatchError } = await supabase
        .from("fiscal_invoices")
        .select("id")
        .eq("organization_id", orgId)
        .eq("client_id", clientId)
        .eq("mes_referencia", mesFinal)
        .eq("emission_origin", "batch")
        .eq("environment", env)
        .not("status", "in", '("error","cancelled")')
        .limit(1)
        .maybeSingle();

      if (existingBatchError) {
        if (isMissingBatchOriginColumn(existingBatchError)) {
          throw new Error("Banco desatualizado: execute migration_batch_origin.sql no Supabase antes de emitir em lote.");
        }

        throw existingBatchError;
      }

      if (existingBatchInvoice) {
        throw new Error("Este cliente ja possui nota enviada em lote neste mes e ambiente.");
      }
    }

    const ibgeMunicipio = nationalMunicipalityCode(company.codigo_municipio_ibge);
    const cnaeCode = company.cnae_padrao || "";
    const totalFinal = Number(toMoneyNumber(valor, 0).toFixed(2));
    if (totalFinal <= 0) throw new Error("Valor deve ser maior que zero.");

    const token = await getNuvemFiscalToken(env);
    const baseUrl = getLocalFiscalBaseUrl(env);
    const cnpj = onlyDigits(company.cnpj || company.cpf_cnpj);
    // A emissão consulta a configuração validada, sem redefini-la a cada nota.
    const nfseConfig = await readNationalNfseConfig(baseUrl, token, cnpj, env === "production" ? "producao" : "homologacao");
    const codServico = nationalServiceCode(nfseConfig.nacional?.codigo_tributacao_nacional ?? company.codigo_servico_padrao);
    const issPayload = buildNationalIss(nfseConfig, ibgeMunicipio, company.aliquota_iss_padrao);

    // Tomador (cliente)
    const clientPhone = onlyDigits(client.telefone);
    const clientCep = onlyDigits(client.cep);
    if (client.cep && clientCep.length !== 8) throw new Error("O CEP do cliente deve conter 8 dígitos. Corrija o cadastro antes de emitir.");
    const blockEnd = clientCep.length === 8
      ? {
          xLgr: client.logradouro || undefined,
          nro: client.numero || undefined,
          xBairro: client.bairro || undefined,
          endNac: {
            cMun: nationalMunicipalityCode(client.codigo_municipio_ibge),
            CEP: clientCep,
          },
        }
      : undefined;

    const descClean = descricao.replace(/(\s*\(R\$\s*[\d.,]+\))+\s*$/, "").trimEnd();
    const xDescServ = `${descClean} (R$ ${totalFinal.toFixed(2)})`;

    const dpsPayload = {
      provedor: NFSE_PROVIDER,
      ambiente: env === "production" ? "producao" : "homologacao",
      infDPS: {
        dhEmi,
        dCompet,
        prest: {
          CNPJ: cnpj,
          // Diretriz validada no Apoio Contábil: Guaíra informa a IM; Toledo omite.
          ...(ibgeMunicipio === "4108809" && onlyDigits(company.inscricao_municipal)
            ? { IM: onlyDigits(company.inscricao_municipal) } : {}),
        },
        toma: {
          CNPJ: cleanDoc.length > 11 ? cleanDoc : undefined,
          CPF: cleanDoc.length > 0 && cleanDoc.length <= 11 ? cleanDoc : undefined,
          xNome: client.nome,
          email: client.email || undefined,
          fone: clientPhone || undefined,
          end: blockEnd,
        },
        serv: {
          cServ: {
            cTribNac: codServico,
            xDescServ,
          },
          locPrest: { cLocPrestacao: ibgeMunicipio },
        },
        valores: {
          vServPrest: { vServ: totalFinal },
          trib: {
            tribMun: issPayload,
          },
        },
      },
    };

    // Salvar rascunho
    const { data: invoice, error: dbError } = await supabase
      .from("fiscal_invoices")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        tipo_documento: "NFSe",
        status: "processing",
        environment: env,
        valor_total: totalFinal,
        descricao_servico: descricao,
        codigo_servico: codServico,
        cnae: cnaeCode,
        aliquota_iss: issPayload.pAliq ?? null,
        data_emissao: dhEmi,
        mes_referencia: mesFinal,
        emission_origin: emissionOrigin,
        payload_json: dpsPayload,
      })
      .select()
      .single();

    if (dbError) {
      if (isMissingBatchOriginColumn(dbError)) {
        throw new Error("Banco desatualizado: execute migration_batch_origin.sql no Supabase antes de emitir em lote.");
      }

      throw dbError;
    }
    invoiceId = invoice.id;

    // Enviar para NuvemFiscal
    const response = await fetch(`${baseUrl}/nfse/dps`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(dpsPayload),
    });

    let result = await readNuvemResult(response);
    // Guarda o ID inclusive em rejeições: a consulta recupera a mesma DPS.
    if (result.id) {
      await supabase.from("fiscal_invoices").update(nfseProviderFields(result)).eq("id", invoiceId);
    }
    let accepted = response.ok;
    if (!accepted && result.id && JSON.stringify(result).includes("E0014")) {
      const existing = await fetch(`${baseUrl}/nfse/${result.id}?consultar_nacional=1`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      });
      if (existing.ok) {
        result = { ...result, ...await readNuvemResult(existing) };
        accepted = true;
      }
    }
    if (!accepted) {
      const errorDetails = result.error?.message || result.message || result.motivo || JSON.stringify(result);
      await supabase.from("fiscal_invoices").update({
        ...nfseProviderFields(result), status: "error", error_message: String(errorDetails),
      }).eq("id", invoiceId);
      return { success: false, error: `Erro SEFIN Nacional: ${errorDetails}` };
    }

    if (!result.id) throw new Error("A Nuvem Local Fiscal não retornou o identificador da DPS. Confira a emissão antes de tentar novamente.");
    if (env === "homologation") result = await transmitPreparedHomologationDps(baseUrl, token, result);

    const outcome = nfseOutcomeFromProvider(result, "processing");
    await supabase
      .from("fiscal_invoices")
      .update({
        ...nfseProviderFields(result),
        status: outcome.status,
        error_message: outcome.errorMessage,
        payload_json: dpsPayload,
      })
      .eq("id", invoiceId);

    revalidatePath("/notas");
    if (outcome.status === "error") return { success: false, error: outcome.errorMessage || "NFS-e rejeitada." };
    return { success: true, invoiceId, status: outcome.status };
  } catch (error: unknown) {
    console.error("[emitirNFSe] Erro:", error);
    const errorMessage = getErrorMessage(error);
    if (invoiceId) {
      const supabase2 = await createClient();
      await supabase2.from("fiscal_invoices").update({ status: "error", error_message: errorMessage }).eq("id", invoiceId);
    }
    return { success: false, error: errorMessage };
  }
}

export async function consultarNFSe(invoiceId: string) {
  const { supabase, orgId } = await getOrgId();

  const { data: invoice } = await supabase
    .from("fiscal_invoices")
    .select("*")
    .eq("id", invoiceId)
    .eq("organization_id", orgId)
    .single();

  if (!invoice || !invoice.nuvemfiscal_uuid) {
    return { success: false, error: "Nota não encontrada ou sem ID da NuvemFiscal." };
  }

  const env = (invoice.environment as "production" | "homologation") || "production";
  const token = await getNuvemFiscalToken(env);
  const baseUrl = getLocalFiscalBaseUrl(env);

  const response = await fetch(`${baseUrl}/nfse/${invoice.nuvemfiscal_uuid}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const err = await response.json() as NuvemResult;
    return { success: false, error: err.error?.message || "Erro ao consultar." };
  }

  let result = await readNuvemResult(response);
  if (env === "homologation") result = await transmitPreparedHomologationDps(baseUrl, token, result);
  const { status: novoStatus, errorMessage } = nfseOutcomeFromProvider(result, invoice.status || "processing");

  const updateData: Record<string, unknown> = {
    status: novoStatus,
    ...nfseProviderFields(result),
    error_message: errorMessage,
    updated_at: new Date().toISOString(),
  };

  if (novoStatus === "authorized" && result.xml_url && !invoice.xml_content) {
    try {
      const xmlRes = await fetch(result.xml_url);
      if (xmlRes.ok) updateData.xml_content = await xmlRes.text();
    } catch { /* continua sem XML local */ }
  }

  await supabase.from("fiscal_invoices").update(updateData).eq("id", invoiceId);

  revalidatePath("/notas");
  return { success: true, status: novoStatus, data: result, errorMessage };
}

export async function cancelarNFSe(invoiceId: string, motivo: string, codigo?: string) {
  const { supabase, orgId } = await getOrgId();
  const cleanMotivo = motivo.trim();
  const cleanCodigo = codigo?.trim();

  if (cleanMotivo.length < 15) {
    return { success: false, error: "Informe um motivo de cancelamento com pelo menos 15 caracteres." };
  }

  const { data: invoice } = await supabase
    .from("fiscal_invoices")
    .select("*")
    .eq("id", invoiceId)
    .eq("organization_id", orgId)
    .single();

  if (!invoice || !invoice.nuvemfiscal_uuid) {
    return { success: false, error: "Nota nao encontrada ou sem ID da NuvemFiscal." };
  }

  if (invoice.status === "cancelled") {
    return { success: false, error: "Esta nota ja esta cancelada." };
  }

  if (invoice.status !== "authorized") {
    return { success: false, error: "Apenas notas autorizadas podem ser canceladas." };
  }

  const env = (invoice.environment as "production" | "homologation") || "production";
  const token = await getNuvemFiscalToken(env);
  const baseUrl = getLocalFiscalBaseUrl(env);

  const response = await fetch(`${baseUrl}/nfse/${invoice.nuvemfiscal_uuid}/cancelamento`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      motivo: cleanMotivo,
      ...(cleanCodigo ? { codigo: cleanCodigo } : {}),
    }),
  });

  const responseText = await response.text();
  let result: NuvemResult = {};
  try { result = JSON.parse(responseText) as NuvemResult; } catch { result = {}; }

  if (!response.ok) {
    const errorDetails = result.error?.message || responseText || JSON.stringify(result);
    await supabase
      .from("fiscal_invoices")
      .update({
        error_message: `Erro ao cancelar NFS-e: ${errorDetails}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", invoiceId);

    return { success: false, error: `Erro ao cancelar NFS-e: ${errorDetails}` };
  }

  const cancelStatus = String(result.status || "").toLowerCase();
  const rejected = ["erro", "rejeitado", "negado"].includes(cancelStatus);
  const cancelMessage = result.mensagens?.length
    ? result.mensagens.map((m) => `${m.codigo || ""}: ${m.descricao || ""}`).join(" | ")
    : result.motivo_status || result.motivo || JSON.stringify(result);

  if (rejected) {
    await supabase
      .from("fiscal_invoices")
      .update({
        error_message: `Cancelamento rejeitado: ${cancelMessage}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", invoiceId);

    return { success: false, error: `Cancelamento rejeitado: ${cancelMessage}` };
  }

  await supabase
    .from("fiscal_invoices")
    .update({
      status: "cancelled",
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoiceId);

  revalidatePath("/notas");
  return { success: true, status: "cancelled", data: result };
}

export async function getInvoices(filters?: {
  mes?: string;
  status?: string;
  clientId?: string;
  environment?: "production" | "homologation";
}) {
  const { supabase, orgId } = await getOrgId();

  let query = supabase
    .from("fiscal_invoices")
    .select(`*, clients(nome, cpf_cnpj)`)
    .eq("organization_id", orgId)
    .order("environment", { ascending: false })
    .order("created_at", { ascending: false });

  if (filters?.mes) query = query.eq("mes_referencia", filters.mes);
  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.clientId) query = query.eq("client_id", filters.clientId);
  if (filters?.environment) query = query.eq("environment", filters.environment);

  const { data, error } = await query.limit(200);
  if (error) throw error;
  return data || [];
}

export async function getDashboardStats() {
  const { supabase, orgId } = await getOrgId();

  const now = new Date();
  const mesAtual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [{ count: totalClientes }, { data: notasMes }] = await Promise.all([
    supabase.from("clients").select("*", { count: "exact", head: true }).eq("organization_id", orgId).eq("ativo", true),
    supabase
      .from("fiscal_invoices")
      .select("valor_total, status, environment")
      .eq("organization_id", orgId)
      .eq("mes_referencia", mesAtual),
  ]);

  // Conta apenas notas autorizadas em producao (homologacao nao entra no faturamento)
  const notasAutorizadas = (notasMes || []).filter(
    (n) => n.status === "authorized" && n.environment === "production"
  );
  const totalFaturado = notasAutorizadas.reduce((acc, n) => acc + (n.valor_total || 0), 0);

  return {
    totalClientes: totalClientes || 0,
    notasNoMes: notasAutorizadas.length,
    totalFaturado,
    mesAtual,
  };
}
