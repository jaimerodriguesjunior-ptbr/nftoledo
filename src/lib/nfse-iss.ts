import { NFSE_PROVIDER, type NationalNfseConfig } from "@/lib/nfse-national";

function configuredCode(value: unknown, allowed: string[], label: string): string {
  const code = String(value ?? "").trim();
  if (!allowed.includes(code)) {
    throw new Error(`Configuração NFS-e Nacional incompleta: revise ${label} na Nuvem Local Fiscal antes de emitir.`);
  }
  return code;
}

// Regras do src/lib/nfse-iss.ts do Apoio Contábil, aplicadas somente à SEFIN.
export function buildNationalIss(config: NationalNfseConfig, municipality: string, configuredRate: unknown) {
  if (config.provedor !== NFSE_PROVIDER) throw new Error("Emissão permitida somente pela SEFIN Nacional.");
  const national = config.nacional ?? {};
  const simpleOption = configuredCode(national.opcao_simples_nacional, ["1", "2", "3"], "a opção pelo Simples Nacional");
  const simpleRegime = simpleOption === "3"
    ? configuredCode(national.regime_apuracao_simples, ["1", "2", "3"], "o regime de apuração do Simples Nacional") : "";
  const taxation = configuredCode(national.tributacao_issqn, ["1", "2", "3", "4"], "a tributação do ISS");
  const retention = configuredCode(national.retencao_issqn, ["1", "2", "3"], "a retenção do ISS");
  const result: { tribISSQN: number; tpRetISSQN: number; cLocIncid: string; pAliq?: number } = {
    tribISSQN: Number(taxation), tpRetISSQN: Number(retention), cLocIncid: municipality,
  };
  // A DPS não leva vISSQN. MEI e SN sem retenção não recebem alíquota artificial.
  if (simpleOption === "2" || taxation !== "1" ||
      (simpleOption === "3" && simpleRegime === "1" && retention === "1")) return result;

  const hasRate = configuredRate !== null && configuredRate !== undefined && String(configuredRate).trim() !== "";
  const rate = hasRate ? Number(configuredRate) : NaN;
  const requiresRate = simpleOption === "3" && simpleRegime === "1" && retention !== "1";
  if (requiresRate && (!Number.isFinite(rate) || rate < 1.8 || rate > 5)) {
    throw new Error("ISS retido no Simples Nacional: cadastre a alíquota efetiva de ISS informada pelo contador (entre 1,8% e 5%) antes de emitir.");
  }
  if (hasRate && (!Number.isFinite(rate) || rate <= 0 || rate > 9.99)) {
    throw new Error("Alíquota de ISS inválida para a NFS-e Nacional. Confira o cadastro com o contador antes de emitir.");
  }
  if (hasRate) result.pAliq = rate;
  return result;
}
