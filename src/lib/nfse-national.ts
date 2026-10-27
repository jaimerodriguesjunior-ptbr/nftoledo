export const NFSE_PROVIDER = "nfse-nacional";

export type NationalNfseConfig = {
  provedor?: string;
  ambiente?: string;
  nacional?: {
    codigo_tributacao_nacional?: unknown;
    codigo_nbs?: unknown;
    opcao_simples_nacional?: unknown;
    regime_apuracao_simples?: unknown;
    tributacao_issqn?: unknown;
    retencao_issqn?: unknown;
  };
};

export async function readNationalNfseConfig(baseUrl: string, token: string, cnpj: string, ambiente: string) {
  const response = await fetch(`${baseUrl}/empresas/${cnpj}/nfse?ambiente=${ambiente}`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
  });
  if (!response.ok) throw new Error("Não foi possível confirmar a configuração SEFIN Nacional. Nenhuma nota foi enviada; confira o cadastro.");
  const config = await response.json() as NationalNfseConfig;
  if (config.provedor !== NFSE_PROVIDER || config.ambiente !== ambiente) {
    throw new Error("A Nuvem Local Fiscal não confirmou o provedor SEFIN Nacional no ambiente solicitado. Emissão bloqueada.");
  }
  return config;
}

// Mesmo critério do Apoio Contábil: emissão no instante atual e competência separada.
export function buildNfseDates(customDate?: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value || "00";
  const date = `${value("year")}-${value("month")}-${value("day")}`;
  const dCompet = customDate || date;
  return {
    dhEmi: `${date}T${value("hour")}:${value("minute")}:${value("second")}-03:00`,
    dCompet, mesReferencia: dCompet.slice(0, 7),
  };
}

export function nationalServiceCode(value: unknown): string {
  const code = String(value ?? "").trim().replace(/[.\s-]/g, "");
  if (!/^\d{6}$/.test(code)) {
    throw new Error("Informe o código de tributação nacional com 6 dígitos em Minha Empresa (ex.: 14.01.01). Códigos municipais antigos precisam ser revisados.");
  }
  return code;
}

export function nationalMunicipalityCode(value: unknown): string {
  const code = String(value ?? "").trim();
  if (!/^\d{7}$/.test(code)) {
    throw new Error("Informe o código IBGE do município da empresa com 7 dígitos.");
  }
  return code;
}

export function nationalSimpleOption(value: unknown): "1" | "2" | "3" {
  switch (String(value ?? "")) {
    case "1": return "3"; // Simples Nacional: ME/EPP.
    case "2":
    case "3": return "1"; // Lucro Presumido/Real: não optante.
    case "4": return "2"; // MEI.
    default: throw new Error("Informe o regime tributário da empresa antes de configurar a NFS-e Nacional.");
  }
}
