import { getNuvemFiscalToken } from "@/lib/nuvemfiscal";

type CompanyData = {
  organizationId: string;
  cnpj?: unknown;
  razao_social?: unknown;
  nome_fantasia?: unknown;
  inscricao_municipal?: unknown;
  inscricao_estadual?: unknown;
  regime_tributario?: unknown;
  codigo_municipio_ibge?: unknown;
  cidade?: unknown;
  uf?: unknown;
  cep?: unknown;
  logradouro?: unknown;
  numero?: unknown;
  complemento?: unknown;
  bairro?: unknown;
  email_contato?: unknown;
  environment?: unknown;
};

type SyncResult = { ok: true } | { ok: false; message: string };

function text(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || undefined;
}

function cnpjDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

async function errorMessage(response: Response) {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message.trim()) return body.message;
  } catch {
    // Não registra o corpo da resposta: ele pode carregar dados fiscais sensíveis.
  }
  return `Falha na Nuvem Local Fiscal (${response.status}).`;
}

export async function syncCompanyWithLocalFiscal(data: CompanyData): Promise<SyncResult> {
  const cnpj = cnpjDigits(data.cnpj);
  if (cnpj.length !== 14) {
    return { ok: false, message: "Informe um CNPJ válido para sincronizar com o emissor local." };
  }

  const environment = data.environment === "homologation" ? "homologation" : "production";
  const baseUrl = (
    environment === "homologation"
      ? process.env.NUVEMFISCAL_HOM_URL
      : process.env.NUVEMFISCAL_PROD_URL
  )?.replace(/\/+$/, "");

  if (!baseUrl) {
    return { ok: false, message: "URL do emissor local não configurada." };
  }

  try {
    const token = await getNuvemFiscalToken(environment);
    const response = await fetch(`${baseUrl}/empresas/${cnpj}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        externalCompanyId: data.organizationId,
        cpf_cnpj: cnpj,
        nome_razao_social: text(data.razao_social) || cnpj,
        nome_fantasia: text(data.nome_fantasia) || text(data.razao_social) || cnpj,
        inscricao_municipal: text(data.inscricao_municipal),
        inscricao_estadual: text(data.inscricao_estadual),
        regime_tributario: text(data.regime_tributario),
        email: text(data.email_contato),
        endereco: {
          logradouro: text(data.logradouro),
          numero: text(data.numero),
          complemento: text(data.complemento),
          bairro: text(data.bairro),
          codigo_municipio: text(data.codigo_municipio_ibge),
          cidade: text(data.cidade),
          uf: text(data.uf)?.toUpperCase(),
          cep: text(data.cep),
        },
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      return { ok: false, message: await errorMessage(response) };
    }

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao sincronizar com o emissor local.";
    console.error("[NuvemLocalFiscal] Falha na sincronização da empresa:", message);
    return { ok: false, message };
  }
}
