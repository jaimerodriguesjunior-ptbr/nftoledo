import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const runtimeRequire = createRequire(import.meta.url);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));

// Executa os módulos reais com HTTP e Supabase isolados: nunca emite uma nota.
function harness({ municipality = "4108809", environment = "production", provider = "nfse-nacional", confirmedEnvironment, configStatus = 200, serviceCode = "14.01.01", configuredUrls = true,
  initiallyConfigured = true, nationalOverrides = {}, companyOverrides = {}, clientOverrides = {}, emissionBody, emissionHttpStatus = 200,
  homologationBody, homologationHttpStatus = 200, consultationBody, batchExisting = false,
  authenticated = true, orgId = "org-test", enrollmentStatus = 201, localSaveError = null } = {}) {
  const calls = [];
  const writes = [];
  let configured = initiallyConfigured;
  const company = {
    cnpj: "35181069000143", razao_social: "Empresa de teste",
    codigo_municipio_ibge: municipality, codigo_servico_padrao: serviceCode,
    regime_tributario: "1", environment, aliquota_iss_padrao: 3,
    inscricao_municipal: "123456",
    nfse_login: "credencial-antiga", nfse_password: "nao-enviar",
    ...companyOverrides,
  };
  const national = { codigo_tributacao_nacional: serviceCode, codigo_nbs: "120013110", opcao_simples_nacional: "3",
    regime_apuracao_simples: "1", tributacao_issqn: "1", retencao_issqn: "1", ...nationalOverrides };
  const invoice = { id: "invoice-test", nuvemfiscal_uuid: "nfs-test", environment, status: "processing" };
  const ambiente = environment === "production" ? "producao" : "homologacao";
  const supabase = {
    auth: { getUser: async () => ({ data: { user: authenticated ? { id: "user-test" } : null } }) },
    from(table) {
      const chain = {
        select() { return chain; }, eq() { return chain; },
        not() { return chain; }, limit() { return chain; },
        async maybeSingle() { return { data: batchExisting ? { id: "previous-invoice" } : null, error: null }; },
        insert(data) { writes.push({ table, data }); return chain; },
        update(data) { writes.push({ table, data }); return chain; },
        async upsert(data) { writes.push({ table, data }); return { error: localSaveError }; },
        async single() {
          return { data: table === "profiles" ? { organization_id: orgId }
            : table === "company_settings" ? company
            : table === "clients" ? { id: "client-test", cpf_cnpj: "52998224725", nome: "Tomador de teste", ...clientOverrides }
            : invoice, error: null };
        },
      };
      return chain;
    },
  };
  const fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    const call = { url: String(url), method: options.method || "GET", body };
    calls.push(call);
    if (call.url.endsWith("/empresas/cadastro-certificado")) {
      return Response.json(enrollmentStatus === 201 ? { success: true } : { message: "Certificado recusado pela Nuvem Local." }, { status: enrollmentStatus });
    }
    if (call.method === "GET" && call.url.includes("/empresas/")) {
      if (!configured) return Response.json({ message: "Não cadastrada" }, { status: 404 });
      if (configStatus !== 200) return Response.json({ message: "API indisponível" }, { status: configStatus });
      return Response.json({ provedor: provider, ambiente: confirmedEnvironment || new URL(call.url).searchParams.get("ambiente") || ambiente, nacional: national });
    }
    if (call.method === "PUT" && call.url.endsWith("/nfse")) {
      if (configStatus !== 200) return Response.json({ message: "Falha de configuração nacional" }, { status: configStatus });
      configured = true;
    }
    if (call.url.endsWith("/nfse/dps")) return Response.json(emissionBody ?? { id: "nfs-test", status: "processamento", provedor: "nfse-nacional" }, { status: emissionHttpStatus });
    if (call.url.endsWith("/transmitir-homologacao-nacional")) return Response.json(homologationBody ?? { id: "nfs-test", status: "autorizado", numero: "25" }, { status: homologationHttpStatus });
    if (call.method === "GET" && call.url.includes("/nfse/nfs-test")) return Response.json(consultationBody ?? { id: "nfs-test", status: "autorizado", numero: "25" });
    return Response.json({});
  };
  const cache = new Map();
  function load(relative) {
    const filename = path.resolve(projectRoot, relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const compiledModule = { exports: {} };
    cache.set(filename, compiledModule);
    const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const requireMock = (name) => {
      if (name === "@/lib/nuvemfiscal") return { getNuvemFiscalToken: async () => "isolated-token" };
      if (name === "@/utils/supabase/server") return { createClient: async () => supabase };
      if (name === "next/cache") return { revalidatePath() {} };
      if (name === "next/server") return { NextResponse: { json: (data, init) => Response.json(data, init) } };
      if (name.startsWith("@/")) return load(`src/${name.slice(2)}.ts`);
      return runtimeRequire(name);
    };
    vm.runInNewContext(source, {
      module: compiledModule, exports: compiledModule.exports, require: requireMock, fetch,
      console: { error() {}, log() {} }, URLSearchParams,
      File, Buffer,
      process: { env: configuredUrls ? { NUVEMFISCAL_PROD_URL: "https://local-fiscal.invalid", NUVEMFISCAL_HOM_URL: "https://local-fiscal-hom.invalid" } : {} },
    }, { filename });
    return compiledModule.exports;
  }
  return { calls, writes, company, load, ambiente, national };
}

for (const municipality of ["4108809", "4127700"]) {
  for (const environment of ["production", "homologation"]) {
    test(`cadastro ${municipality}/${environment} configura exclusivamente SEFIN`, async () => {
      const h = harness({ municipality, environment, initiallyConfigured: false });
      const result = await h.load("src/lib/nuvem-local-fiscal.ts").syncCompanyWithLocalFiscal({ ...h.company, organizationId: "org-test" });
      assert.equal(result.ok, true);
      const configuration = h.calls.find(c => c.method === "PUT" && c.url.endsWith("/nfse"));
      assert.equal(configuration.body.provedor, "nfse-nacional");
      assert.equal(configuration.body.municipio.codigo_ibge, municipality);
      assert.equal(configuration.body.nacional.codigo_tributacao_nacional, "140101");
      assert.equal(configuration.body.nacional.opcao_simples_nacional, "3");
      assert.equal(configuration.body.ambiente, h.ambiente);
      assert.equal(configuration.body.rps, undefined); // Não reinicia sequência.
      assert.equal(configuration.body.nacional.inscricao_municipal, undefined);
      assert.equal(configuration.body.prefeitura, undefined);
      assert.equal(configuration.body.ipm, undefined);
      assert.equal(configuration.body.equiplano, undefined);
      assert.equal(h.calls.at(-1).url.endsWith(`?ambiente=${h.ambiente}`), true);
      assert.equal(h.calls.find(c => c.method === "PUT").body.ambiente, h.ambiente);
    });
  }

  test(`emissão ${municipality} confirma configuração sem redefini-la antes de enviar DPS nacional`, async () => {
    const h = harness({ municipality });
    const result = await h.load("src/actions/fiscal.ts").emitirNFSe({ clientId: "client-test", descricao: "Serviço", valor: 10 });
    assert.equal(result.success, true);
    const emissionIndex = h.calls.findIndex(c => c.url.endsWith("/nfse/dps"));
    assert.ok(emissionIndex > h.calls.findIndex(c => c.method === "GET"));
    const payload = h.calls[emissionIndex].body;
    assert.equal(payload.provedor, "nfse-nacional");
    assert.equal(payload.infDPS.serv.cServ.cTribNac, "140101");
    assert.equal(payload.infDPS.serv.cServ.cTribMun, undefined);
    assert.equal(payload.infDPS.serv.cServ.cSitTrib, undefined);
    assert.equal(payload.infDPS.valores.trib.tribMun.vISSQN, undefined);
    assert.equal(payload.infDPS.valores.trib.tribMun.pAliq, undefined);
    assert.equal(payload.infDPS.prest.IM, municipality === "4108809" ? "123456" : undefined);
    assert.equal(h.calls.some(c => c.method === "PUT"), false);
    assert.equal(h.calls.filter(c => c.url.endsWith("/nfse/dps")).length, 1);
  });
}

for (const options of [
  { provider: "guaira-ipm" },
  { provider: "toledo-equiplano" },
  { confirmedEnvironment: "homologacao" },
  { configStatus: 500 },
  { serviceCode: "14.01" },
  { serviceCode: "14.01.01.000" },
  { municipality: "" },
]) {
  test(`falha fechada sem emissão: ${JSON.stringify(options)}`, async () => {
    const h = harness(options);
    const result = await h.load("src/actions/fiscal.ts").emitirNFSe({ clientId: "client-test", descricao: "Serviço", valor: 10 });
    assert.equal(result.success, false);
    assert.equal(h.calls.some(c => c.url.endsWith("/nfse/dps")), false);
    assert.equal(h.writes.some(w => w.table === "fiscal_invoices"), false);
  });
}

test("regime tributário usa os valores do Simples da DPS, sem confundir com o cadastro", () => {
  const national = harness().load("src/lib/nfse-national.ts");
  assert.equal(national.nationalSimpleOption("1"), "3");
  assert.equal(national.nationalSimpleOption("2"), "1");
  assert.equal(national.nationalSimpleOption("3"), "1");
  assert.equal(national.nationalSimpleOption("4"), "2");
  assert.throws(() => national.nationalServiceCode("1401"));
  assert.throws(() => national.nationalServiceCode("abc140101"));
});

test("URL ausente interrompe o fluxo sem usar a API pública como fallback", () => {
  const env = harness({ configuredUrls: false }).load("src/lib/local-fiscal-config.ts");
  assert.throws(() => env.getLocalFiscalBaseUrl("production"));
  assert.throws(() => env.getLocalFiscalBaseUrl("homologation"));
});

test("salvar cadastro preserva configuração nacional já validada", async () => {
  const h = harness({ companyOverrides: { codigo_servico_padrao: "14.01" },
    nationalOverrides: { codigo_tributacao_nacional: "140101", regime_apuracao_simples: "2", retencao_issqn: "2" } });
  const result = await h.load("src/lib/nuvem-local-fiscal.ts").syncCompanyWithLocalFiscal({ ...h.company, organizationId: "org-test" });
  assert.equal(result.ok, true);
  assert.equal(h.calls.some(c => c.method === "PUT" && c.url.endsWith("/nfse")), false);
});

test("emissão usa o código nacional da API mesmo com código legado no cadastro", async () => {
  const h = harness({ serviceCode: "14.01", nationalOverrides: { codigo_tributacao_nacional: "140101" } });
  const result = await h.load("src/actions/fiscal.ts").emitirNFSe({ clientId: "client-test", descricao: "Serviço", valor: 10 });
  assert.equal(result.success, true);
  assert.equal(h.calls.find(c => c.url.endsWith("/nfse/dps")).body.infDPS.serv.cServ.cTribNac, "140101");
});

test("hora de emissão é atual; competência anterior permanece separada", () => {
  const helper = harness().load("src/lib/nfse-national.ts");
  const result = helper.buildNfseDates("2026-09-30", new Date("2026-10-27T11:34:56Z"));
  assert.equal(result.dhEmi, "2026-10-27T08:34:56-03:00");
  assert.equal(result.dCompet, "2026-09-30");
  assert.equal(result.mesReferencia, "2026-09");
});

const nationalTaxCases = [
  { label: "MEI", fields: { opcao_simples_nacional: "2" }, rate: 5 },
  { label: "SN sem retenção", fields: {}, rate: 0 },
  { label: "imunidade", fields: { tributacao_issqn: "2" }, rate: 3 },
  { label: "SN retido", fields: { retencao_issqn: "2" }, rate: 2.01, expectedRate: 2.01 },
  { label: "regime normal", fields: { opcao_simples_nacional: "1" }, rate: 3, expectedRate: 3 },
];
for (const { label, fields, rate, expectedRate } of nationalTaxCases) {
  test(`ISS segue o Apoio Contábil: ${label}`, async () => {
    const h = harness({ nationalOverrides: fields, companyOverrides: { aliquota_iss_padrao: rate } });
    const result = await h.load("src/actions/fiscal.ts").emitirNFSe({ clientId: "client-test", descricao: "Serviço", valor: 10 });
    assert.equal(result.success, true);
    const iss = h.calls.find(c => c.url.endsWith("/nfse/dps")).body.infDPS.valores.trib.tribMun;
    assert.equal(iss.pAliq, expectedRate);
    assert.equal(iss.vISSQN, undefined);
    assert.equal(iss.tpRetISSQN, Number(fields.retencao_issqn || "1"));
    assert.equal(iss.tribISSQN, Number(fields.tributacao_issqn || "1"));
    const draft = h.writes.find(w => w.data.payload_json).data;
    assert.equal(draft.aliquota_iss, expectedRate ?? null);
  });
}

for (const rate of [undefined, 0, 1.79, 5.01]) {
  test(`SN retido sem alíquota efetiva válida bloqueia antes de emitir: ${rate}`, async () => {
    const h = harness({ nationalOverrides: { retencao_issqn: "2" }, companyOverrides: { aliquota_iss_padrao: rate } });
    const result = await h.load("src/actions/fiscal.ts").emitirNFSe({ clientId: "client-test", descricao: "Serviço", valor: 10 });
    assert.equal(result.success, false);
    assert.match(result.error, /alíquota efetiva/);
    assert.equal(h.calls.some(c => c.url.endsWith("/nfse/dps")), false);
  });
}

test("parâmetros nacionais incompletos bloqueiam envio", async () => {
  const h = harness({ nationalOverrides: { tributacao_issqn: undefined } });
  const result = await h.load("src/actions/fiscal.ts").emitirNFSe({ clientId: "client-test", descricao: "Serviço", valor: 10 });
  assert.equal(result.success, false);
  assert.equal(h.calls.some(c => c.url.endsWith("/nfse/dps")), false);
});

test("autorização imediata é gravada com número, chave, XML e DANFSe", async () => {
  const h = harness({ emissionBody: { id: "nfs-test", status: "autorizado", numero: 25, serie: 1,
    chave: "chave-teste", xml_url: "https://local-fiscal.invalid/xml", pdf_url: "https://local-fiscal.invalid/pdf" } });
  const result = await h.load("src/actions/fiscal.ts").emitirNFSe({ clientId: "client-test", descricao: "Serviço", valor: 10 });
  assert.equal(result.success, true);
  const saved = h.writes.at(-1).data;
  assert.equal(saved.status, "authorized");
  assert.equal(saved.numero, "25");
  assert.equal(saved.serie, "1");
  assert.equal(saved.chave_acesso, "chave-teste");
  assert.equal(saved.nuvemfiscal_uuid, "nfs-test");
  assert.ok(saved.xml_url && saved.pdf_url);
});

for (const httpStatus of [200, 422]) {
  test(`rejeição HTTP ${httpStatus} preserva o ID para consulta`, async () => {
    const h = harness({ emissionBody: { id: "nfs-test", status: "erro", numero: 25, mensagens: [{ codigo: "E0025", descricao: "Rejeição de teste" }] }, emissionHttpStatus: httpStatus });
    const result = await h.load("src/actions/fiscal.ts").emitirNFSe({ clientId: "client-test", descricao: "Serviço", valor: 10 });
    assert.equal(result.success, false);
    assert.equal(h.writes.at(-1).data.status, "error");
    assert.equal(h.writes.at(-1).data.nuvemfiscal_uuid, "nfs-test");
    assert.equal(h.calls.filter(c => c.url.endsWith("/nfse/dps")).length, 1);
  });
}

test("homologação transmite a DPS preparada usando o mesmo ID", async () => {
  const h = harness({ environment: "homologation", emissionBody: { id: "nfs-test", status: "processamento", motivo_status: "NFSE_NACIONAL_DPS_GENERATED" } });
  const result = await h.load("src/actions/fiscal.ts").emitirNFSe({ clientId: "client-test", descricao: "Serviço", valor: 10 });
  assert.equal(result.status, "authorized");
  assert.equal(h.calls.filter(c => c.url.endsWith("/nfse/dps")).length, 1);
  assert.equal(h.calls.filter(c => c.url.endsWith("/nfs-test/transmitir-homologacao-nacional")).length, 1);
});

test("consulta retoma DPS de homologação preparada sem criar outra nota", async () => {
  const h = harness({ environment: "homologation", consultationBody: { id: "nfs-test", status: "processamento", motivo_status: "NFSE_NACIONAL_DPS_GENERATED" } });
  const result = await h.load("src/actions/fiscal.ts").consultarNFSe("invoice-test");
  assert.equal(result.status, "authorized");
  assert.equal(h.calls.some(c => c.url.endsWith("/nfse/dps")), false);
});

test("produção não chama transmissão manual de homologação", async () => {
  const h = harness({ emissionBody: { id: "nfs-test", status: "processamento", motivo_status: "NFSE_NACIONAL_DPS_GENERATED" } });
  const result = await h.load("src/actions/fiscal.ts").emitirNFSe({ clientId: "client-test", descricao: "Serviço", valor: 10 });
  assert.equal(result.status, "processing");
  assert.equal(h.calls.some(c => c.url.includes("transmitir-homologacao")), false);
});

test("DPS duplicada E0014 recupera a autorização por consulta, sem novo POST", async () => {
  const h = harness({ emissionHttpStatus: 422, emissionBody: { id: "nfs-test", status: "erro", mensagens: [{ codigo: "E0014", descricao: "DPS já convertida" }] } });
  const result = await h.load("src/actions/fiscal.ts").emitirNFSe({ clientId: "client-test", descricao: "Serviço", valor: 10 });
  assert.equal(result.status, "authorized");
  assert.equal(h.calls.filter(c => c.url.endsWith("/nfse/dps")).length, 1);
  assert.equal(h.calls.some(c => c.url.endsWith("?consultar_nacional=1")), true);
});

test("lote respeita o mês, ambiente e inscrição municipal de Guaíra", async () => {
  const h = harness();
  const result = await h.load("src/actions/fiscal.ts").emitirNFSe({ clientId: "client-test", descricao: "Mensalidade", valor: 10, emissionOrigin: "batch", mesReferencia: "2026-09", dataCompetencia: "2026-09-30" });
  assert.equal(result.success, true);
  const draft = h.writes.find(w => w.data.emission_origin === "batch").data;
  assert.equal(draft.mes_referencia, "2026-09");
  assert.equal(draft.environment, "production");
  assert.equal(draft.payload_json.infDPS.dCompet, "2026-09-30");
  assert.equal(draft.payload_json.infDPS.prest.IM, "123456");
});

test("lote já enviado bloqueia duplicação antes de acessar a API", async () => {
  const h = harness({ batchExisting: true });
  const result = await h.load("src/actions/fiscal.ts").emitirNFSe({ clientId: "client-test", descricao: "Mensalidade", valor: 10, emissionOrigin: "batch", mesReferencia: "2026-09" });
  assert.equal(result.success, false);
  assert.equal(h.calls.length, 0);
});

function registrationRequest(company, { withFile = true, password = "synthetic-password", filename = "test.pfx" } = {}) {
  const form = new FormData();
  form.append("empresa", JSON.stringify({ ...company, organization_id: "forged-org", password: "must-not-persist" }));
  if (withFile) form.append("file", new File(["synthetic-pfx-http-fixture"], filename));
  if (password) form.append("password", password);
  return new Request("https://app.invalid/api/fiscal/cadastro", { method: "POST", body: form });
}

test("cadastro envia empresa e A1 para Nuvem Local e depois confirma o cadastro local", async () => {
  const h = harness();
  const response = await h.load("src/app/api/fiscal/cadastro/route.ts").POST(registrationRequest(h.company));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.certificateSent, true);
  const enrollment = h.calls.find(c => c.url.endsWith("/empresas/cadastro-certificado"));
  assert.equal(enrollment.body.empresa.cnpj, h.company.cnpj);
  assert.equal(enrollment.body.externalCompanyId, "org-test");
  assert.equal(enrollment.body.empresa.organization_id, undefined);
  assert.equal(enrollment.body.empresa.nfse_password, undefined);
  assert.equal(enrollment.body.empresa.password, undefined);
  const local = h.writes.find(w => w.table === "company_settings").data;
  assert.equal(local.organization_id, "org-test");
  assert.equal(local.local_fiscal_sync_status, "success");
  assert.equal(local.password, undefined);
  assert.equal(JSON.stringify(result).includes("synthetic-password"), false);
});

for (const options of [{ authenticated: false }, { orgId: null }, { enrollmentStatus: 400 }]) {
  test(`cadastro recusado não grava sucesso local: ${JSON.stringify(options)}`, async () => {
    const h = harness(options);
    const response = await h.load("src/app/api/fiscal/cadastro/route.ts").POST(registrationRequest(h.company));
    assert.ok(response.status >= 400);
    assert.equal(h.writes.some(w => w.table === "company_settings"), false);
    if (options.authenticated === false || options.orgId === null) assert.equal(h.calls.length, 0);
  });
}

test("falha local após envio remoto informa estado parcial", async () => {
  const h = harness({ localSaveError: { message: "Falha de persistência de teste" } });
  const response = await h.load("src/app/api/fiscal/cadastro/route.ts").POST(registrationRequest(h.company));
  assert.equal(response.status, 422);
  assert.equal((await response.json()).certificateSent, true);
});

test("atualizar dados sem novo certificado sincroniza os dados cadastrais", async () => {
  const h = harness();
  const response = await h.load("src/app/api/fiscal/cadastro/route.ts").POST(registrationRequest(h.company, { withFile: false, password: "" }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).certificateSent, false);
  assert.equal(h.calls.some(c => c.url.endsWith("/empresas/cadastro-certificado")), false);
});

for (const authenticated of [false, true]) {
  test(`upload antigo protege o certificado por sessão e empresa: autenticado=${authenticated}`, async () => {
    const h = harness({ authenticated });
    const form = new FormData();
    form.append("file", new File(["synthetic-fixture"], "test.pfx"));
    form.append("password", "synthetic-password");
    form.append("cnpj", "11222333000181");
    const request = new Request("https://app.invalid/api/fiscal/certificado", { method: "POST", body: form });
    const response = await h.load("src/app/api/fiscal/certificado/route.ts").POST(request);
    assert.equal(response.status, authenticated ? 403 : 401);
    assert.equal(h.calls.length, 0);
  });
}
