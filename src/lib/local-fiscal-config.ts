export type FiscalEnvironment = "production" | "homologation";

export function getLocalFiscalBaseUrl(environment: FiscalEnvironment): string {
  const url = (environment === "production"
    ? process.env.NUVEMFISCAL_PROD_URL
    : process.env.NUVEMFISCAL_HOM_URL)?.trim().replace(/\/+$/, "");
  if (!url) throw new Error(`URL da Nuvem Local Fiscal não configurada para ${environment}.`);
  return url;
}
