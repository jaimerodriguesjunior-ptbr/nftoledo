import { getNuvemFiscalToken } from "@/lib/nuvemfiscal";
import { getLocalFiscalBaseUrl } from "@/lib/local-fiscal-config";
import { NFSE_PROVIDER, nationalServiceCode, nationalMunicipalityCode, nationalSimpleOption, readNationalNfseConfig, type NationalNfseConfig } from "@/lib/nfse-national";

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
  cnae_padrao?: unknown;
  codigo_servico_padrao?: unknown;
  aliquota_iss_padrao?: unknown;
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
  try {
    // Valida antes de alterar qualquer cadastro remoto; não infere códigos fiscais.
    const municipalityCode = nationalMunicipalityCode(data.codigo_municipio_ibge);
    const baseUrl = getLocalFiscalBaseUrl(environment);
    const token = await getNuvemFiscalToken(environment);
    const ambiente = environment === "production" ? "producao" : "homologacao";
    const nfseUrl = `${baseUrl}/empresas/${cnpj}/nfse`;
    const currentResponse = await fetch(`${nfseUrl}?ambiente=${ambiente}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    });
    if (!currentResponse.ok && currentResponse.status !== 404) {
      return { ok: false, message: await errorMessage(currentResponse) };
    }
    const current = currentResponse.ok ? await currentResponse.json() as NationalNfseConfig : null;
    const preservesNationalConfig = current?.provedor === NFSE_PROVIDER && current.ambiente === ambiente;
    // Como no Apoio Contábil, salvar dados cadastrais não redefine uma
    // configuração nacional já validada (serviço, NBS, Simples, IM ou sequência).
    const national = preservesNationalConfig ? null : {
      versao_leiaute: "1.01",
      codigo_tributacao_nacional: nationalServiceCode(data.codigo_servico_padrao),
      opcao_simples_nacional: nationalSimpleOption(data.regime_tributario),
    };
    const response = await fetch(`${baseUrl}/empresas/${cnpj}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ambiente,
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

    if (preservesNationalConfig) return { ok: true };

    const nfseResponse = await fetch(nfseUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        ambiente,
        provedor: NFSE_PROVIDER,
        municipio: { codigo_ibge: municipalityCode, nome: text(data.cidade) },
        nacional: national,
        // A API mantém a sequência DPS, a IM nacional e os demais parâmetros
        // já configurados. A IM cadastral acima não é copiada para a DPS.
      }),
      cache: "no-store",
    });
    if (!nfseResponse.ok) return { ok: false, message: await errorMessage(nfseResponse) };

    // Falha fechada: a emissão não pode prosseguir com um provedor municipal.
    await readNationalNfseConfig(baseUrl, token, cnpj, ambiente);

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao sincronizar com o emissor local.";
    console.error("[NuvemLocalFiscal] Falha na sincronização da empresa:", message);
    return { ok: false, message };
  }
}
