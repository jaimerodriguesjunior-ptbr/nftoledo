"use server";

import { createClient } from "@/utils/supabase/server";
import { getNuvemFiscalToken } from "@/lib/nuvemfiscal";
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

function getSaoPauloDate(customDate?: string) {
  let d: Date;

  if (customDate) {
    const [y, m, day] = customDate.split("-").map(Number);
    d = new Date(Date.UTC(y, m - 1, day, 15, 0, 0));
  } else {
    d = new Date();
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const year = parts.find((p) => p.type === "year")?.value || "2026";
  const month = parts.find((p) => p.type === "month")?.value || "01";
  const day = parts.find((p) => p.type === "day")?.value || "01";
  const dCompet = `${year}-${month}-${day}`;

  return {
    dhEmi: `${dCompet}T12:00:00-03:00`,
    dCompet,
    mesReferencia: `${year}-${month}`,
  };
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

    const { dhEmi, dCompet, mesReferencia: mesAuto } = getSaoPauloDate(dataCompetencia);
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

    const codServico = String(company.codigo_servico_padrao || "").trim();
    const codServicoDigits = onlyDigits(codServico);
    if (!codServicoDigits) throw new Error("Codigo de servico nao informado. Configure em Minha Empresa antes de emitir.");
    if (!codServico) throw new Error("Código de serviço não informado. Configure em Minha Empresa antes de emitir.");
    const cnaeCode = company.cnae_padrao || "";
    const aliquota = company.aliquota_iss_padrao ?? 3.0;
    const totalFinal = Number(toMoneyNumber(valor, 0).toFixed(2));

    if (totalFinal <= 0) throw new Error("Valor deve ser maior que zero.");

    const token = await getNuvemFiscalToken(env);
    const baseUrl =
      env === "production"
        ? process.env.NUVEMFISCAL_PROD_URL || "https://api.nuvemfiscal.com.br"
        : process.env.NUVEMFISCAL_HOM_URL || "https://api.sandbox.nuvemfiscal.com.br";

    const cnpj = onlyDigits(company.cnpj || company.cpf_cnpj);
    const inscricaoMunicipal = String(company.inscricao_municipal || "")
      .replace(/\D/g, "")
      .trim();
    const ibgeMunicipio = onlyDigits(company.codigo_municipio_ibge || "4108809") || "4108809";
    const isGuaira = ibgeMunicipio === "4108809";
    const isToledo = ibgeMunicipio === "4127700";
    const defaultMunicipioCep = isToledo ? "85900000" : isGuaira ? "85980000" : undefined;
    const companyCep = onlyDigits(company.cep);
    const companyCepToSend = companyCep.length === 8 ? companyCep : defaultMunicipioCep;

    if (isToledo && !inscricaoMunicipal) {
      throw new Error("Inscrição municipal não configurada para Toledo. Acesse Minha Empresa.");
    }
    const companyEmailContato = String(company.email_contato || "").trim();
    if (isToledo && !companyEmailContato) {
      throw new Error("Email de contato da empresa obrigatório para emissão em Toledo. Preencha em Minha Empresa.");
    }

    // Sync empresa Toledo
    if (isToledo && inscricaoMunicipal) {
      const empresaPayload = {
        cpf_cnpj: cnpj,
        nome_razao_social: company.razao_social || company.nome_fantasia || cnpj,
        nome_fantasia: company.nome_fantasia || company.razao_social || cnpj,
        email: companyEmailContato,
        inscricao_estadual: company.inscricao_estadual || undefined,
        inscricao_municipal: inscricaoMunicipal,
        endereco: {
          logradouro: company.logradouro || undefined,
          numero: company.numero || undefined,
          complemento: company.complemento || undefined,
          bairro: company.bairro || undefined,
          codigo_municipio: ibgeMunicipio,
          cidade: company.cidade || undefined,
          uf: company.uf || undefined,
          cep: companyCepToSend,
          pais: "BRASIL",
        },
      };

      const syncPut = await fetch(`${baseUrl}/empresas/${cnpj}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(empresaPayload),
      });
      if (!syncPut.ok && syncPut.status === 404) {
        const syncPost = await fetch(`${baseUrl}/empresas`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(empresaPayload),
        });
        if (!syncPost.ok) {
          throw new Error(`Erro ao cadastrar empresa Toledo na Nuvem Fiscal: ${await syncPost.text()}`);
        }
      } else if (!syncPut.ok) {
        throw new Error(`Erro ao atualizar empresa Toledo na Nuvem Fiscal: ${await syncPut.text()}`);
      }

    }

    const getCodigoNacional = (raw: string) => {
      const digits = raw.replace(/[.-]/g, "");
      if (isToledo) {
        return digits.length >= 4 ? `${digits.substring(0, 2)}.${digits.substring(2, 4)}` : digits;
      }
      if (isGuaira) {
        if (digits.length >= 6) return digits.substring(0, 6);
        if (digits.length === 4) return `${digits}01`;
        return digits;
      }
      if (digits.length >= 4) return `${digits.substring(0, 2)}.${digits.substring(2, 4)}`;
      return digits;
    };

    const getCodigoMunicipal = (raw: string) => {
      const digits = raw.replace(/[.-]/g, "");
      if (isToledo) {
        if (digits.length >= 9) return `${digits.substring(0, 2)}.${digits.substring(2, 4)}.${digits.substring(4, 6)}.${digits.substring(6, 9)}`;
        if (digits.length === 6) return `${digits.substring(0, 2)}.${digits.substring(2, 4)}.${digits.substring(4, 6)}.000`;
        if (digits.length === 4) return `${digits.substring(0, 2)}.${digits.substring(2, 4)}.01.000`;
        return digits;
      }
      if (digits.length >= 6) return digits.substring(0, 6);
      if (digits.length === 4 && ibgeMunicipio === "4108809" && digits === "1401") return "140101";
      return digits;
    };

    const cTribNac = getCodigoNacional(codServicoDigits);
    const cTribMun = getCodigoMunicipal(codServicoDigits);

    if (isToledo && (codServicoDigits.length < 4 || !cTribNac || !cTribMun)) {
      throw new Error("Servico da LC 116 obrigatorio para Toledo. Informe o codigo de servico no formato 14.01, 14.01.01 ou 14.01.01.000.");
    }

    if (isToledo && inscricaoMunicipal) {
      const nfsePayload = {
        ambiente: env === "production" ? "producao" : "homologacao",
        provedor: "toledo-equiplano",
        municipio: {
          codigo_ibge: ibgeMunicipio,
          nome: company.cidade || "Toledo",
        },
        rps: {
          serie: "1",
          emissor: "1",
        },
        equiplano: {
          endpoint: "https://www.esnfs.com.br:9443//homologacaows/services/Enfs",
          soap_action: "http://services.enfsws.es/esRecepcionarLoteRps",
          request_format: "soap",
          inscricao_municipal: inscricaoMunicipal,
          id_entidade: "136",
        },
        servico: {
          codigo: cTribMun,
          aliquota_iss: aliquota,
          codigo_atividade: cnaeCode,
        },
        transmissao_automatica: true,
      };

      const nfsePut = await fetch(`${baseUrl}/empresas/${cnpj}/nfse`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(nfsePayload),
      });

      if (!nfsePut.ok && nfsePut.status === 404) {
        const nfsePost = await fetch(`${baseUrl}/empresas/${cnpj}/nfse`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(nfsePayload),
        });

        if (!nfsePost.ok) {
          throw new Error(`Erro ao cadastrar configuracao NFS-e Toledo na Nuvem Fiscal: ${await nfsePost.text()}`);
        }
      } else if (!nfsePut.ok) {
        throw new Error(`Erro ao atualizar configuracao NFS-e Toledo na Nuvem Fiscal: ${await nfsePut.text()}`);
      }
    }

    const normalizeMunicipio = (codigo?: string | number) => {
      if (!codigo) return ibgeMunicipio;
      const raw = String(codigo).replace(/\D/g, "");
      return raw || ibgeMunicipio;
    };

    // Tomador (cliente)
    const clientPhone = onlyDigits(client.telefone);
    const companyPhone = onlyDigits(company.telefone);
    const phoneToSend = clientPhone || companyPhone;
    const clientCep = onlyDigits(client.cep);
    const cepToSend = clientCep.length === 8 ? clientCep : companyCepToSend;

    if (isToledo && !phoneToSend) {
      throw new Error("Telefone obrigatorio para emissao em Toledo. Preencha o telefone do cliente ou da empresa antes de emitir.");
    }
    if (isToledo && !cepToSend) {
      throw new Error("CEP obrigatorio para emissao em Toledo. Preencha o CEP do cliente ou da empresa antes de emitir.");
    }

    const blockEnd = cepToSend
      ? {
          xLgr: client.logradouro || company.logradouro || "Nao Informado",
          nro: client.numero || company.numero || "SN",
          xBairro: client.bairro || company.bairro || "Centro",
          endNac: {
            cMun: normalizeMunicipio(client.codigo_municipio_ibge || company.codigo_municipio_ibge),
            CEP: cepToSend,
          },
        }
      : undefined;

    const descClean = descricao.replace(/(\s*\(R\$\s*[\d.,]+\))+\s*$/, "").trimEnd();
    const xDescServ = `${descClean} (R$ ${totalFinal.toFixed(2)})`;

    const dpsPayload = {
      ambiente: env === "production" ? "producao" : "homologacao",
      infDPS: {
        dhEmi,
        dCompet,
        prest: { CNPJ: cnpj },
        toma: {
          CNPJ: cleanDoc.length > 11 ? cleanDoc : undefined,
          CPF: cleanDoc.length > 0 && cleanDoc.length <= 11 ? cleanDoc : undefined,
          xNome: client.nome,
          email: client.email || undefined,
          fone: phoneToSend || undefined,
          end: blockEnd,
        },
        serv: {
          cServ: {
            cTribNac,
            cTribMun,
            CNAE: cnaeCode,
            cSitTrib: "0",
            xDescServ,
          },
          locPrest: { cLocPrestacao: ibgeMunicipio },
        },
        valores: {
          vServPrest: { vServ: totalFinal },
          trib: {
            tribMun: {
              tribISSQN: 1,
              tpRetISSQN: 1,
              pAliq: aliquota,
              vISSQN: isToledo ? undefined : 0,
              cLocIncid: ibgeMunicipio,
            },
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
        aliquota_iss: aliquota,
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

    const responseText = await response.text();
    let result: NuvemResult = {};
    try { result = JSON.parse(responseText) as NuvemResult; } catch { result = {}; }

    if (!response.ok) {
      const errorDetails = result.error?.message || JSON.stringify(result);
      const fullErrorString = JSON.stringify(result);
      const normalized = `${errorDetails} ${fullErrorString}`.toLowerCase();

      const isToledoCredentialIssue =
        (normalized.includes("1824") && normalized.includes("nrinscricaomunicipal")) ||
        normalized.includes("8003");

      if (isToledo && isToledoCredentialIssue) {
        await supabase.from("fiscal_invoices").update({ status: "error", error_message: fullErrorString }).eq("id", invoiceId);
        return {
          success: false,
          error: `Erro Toledo: ${errorDetails}\nVerifique na Nuvem Fiscal o cadastro da empresa e configuração NFS-e (login/IM).`,
        };
      }

      // Auto-retry erro 00229 (endereço já cadastrado)
      if (fullErrorString.includes("229") || (fullErrorString.includes("cadastr") && fullErrorString.includes("endere"))) {
        console.log("[NFSe] Erro 00229 detectado. Reenviando sem endereço...");
        if (dpsPayload.infDPS.toma.end) {
          dpsPayload.infDPS.toma.end = undefined;
          const retry = await fetch(`${baseUrl}/nfse/dps`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(dpsPayload),
          });
          if (retry.ok) {
            const retryResult = await retry.json() as NuvemResult;
            result = retryResult;
          } else {
            const retryErr = JSON.stringify(await retry.json());
            await supabase.from("fiscal_invoices").update({ status: "error", error_message: retryErr }).eq("id", invoiceId);
            return { success: false, error: `Erro NuvemFiscal (retry falhou): ${retryErr}` };
          }
        } else {
          await supabase.from("fiscal_invoices").update({ status: "error", error_message: fullErrorString }).eq("id", invoiceId);
          return { success: false, error: `Erro NuvemFiscal: ${errorDetails}` };
        }
      } else {
        await supabase.from("fiscal_invoices").update({ status: "error", error_message: fullErrorString }).eq("id", invoiceId);
        return { success: false, error: `Erro NuvemFiscal: ${errorDetails}` };
      }
    }

    // Sucesso
    await supabase
      .from("fiscal_invoices")
      .update({
        status: "processing",
        nuvemfiscal_uuid: result.id,
        numero: result.numero,
        serie: result.serie,
        payload_json: dpsPayload,
      })
      .eq("id", invoiceId);

    revalidatePath("/notas");
    return { success: true, invoiceId };
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
  const baseUrl =
    env === "production"
      ? process.env.NUVEMFISCAL_PROD_URL || "https://api.nuvemfiscal.com.br"
      : process.env.NUVEMFISCAL_HOM_URL || "https://api.sandbox.nuvemfiscal.com.br";

  const response = await fetch(`${baseUrl}/nfse/${invoice.nuvemfiscal_uuid}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const err = await response.json() as NuvemResult;
    return { success: false, error: err.error?.message || "Erro ao consultar." };
  }

  const result = await response.json() as NuvemResult;

  let novoStatus = invoice.status;
  let errorMessage = null;
  const providerStatus = String(result.status || "").toLowerCase();

  if (providerStatus === "autorizado" || providerStatus === "autorizada") novoStatus = "authorized";
  else if (providerStatus && ["erro", "rejeitado", "rejeitada", "negado", "negada"].includes(providerStatus)) {
    novoStatus = "error";
    if (result.mensagens?.length) {
      errorMessage = result.mensagens.map((m) => `${m.codigo}: ${m.descricao}`).join(" | ");
    } else {
      errorMessage = result.motivo_status || JSON.stringify(result);
    }
  } else if (providerStatus === "cancelado" || providerStatus === "cancelada") novoStatus = "cancelled";

  const updateData: Record<string, unknown> = {
    status: novoStatus,
    numero: result.numero,
    serie: result.serie,
    chave_acesso: result.chave || result.codigo_verificacao,
    xml_url: result.xml_url,
    pdf_url: result.pdf_url || result.link_url,
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
  const baseUrl =
    env === "production"
      ? process.env.NUVEMFISCAL_PROD_URL || "https://api.nuvemfiscal.com.br"
      : process.env.NUVEMFISCAL_HOM_URL || "https://api.sandbox.nuvemfiscal.com.br";

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
