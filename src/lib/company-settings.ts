const fields = ["cnpj", "razao_social", "nome_fantasia", "inscricao_municipal", "inscricao_estadual",
  "regime_tributario", "codigo_municipio_ibge", "cidade", "uf", "cep", "logradouro", "numero",
  "complemento", "bairro", "email_contato", "telefone", "cnae_padrao", "codigo_servico_padrao",
  "aliquota_iss_padrao", "environment"];

export function pickCompanySettings(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(fields.filter(field => field in data).map(field => [field, data[field]]));
}
