import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { saveCompany } from "@/actions/empresa";
import { getNuvemFiscalToken } from "@/lib/nuvemfiscal";
import { getLocalFiscalBaseUrl } from "@/lib/local-fiscal-config";
import { pickCompanySettings } from "@/lib/company-settings";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Entre na sua conta para cadastrar a empresa." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).single();
  if (!profile?.organization_id) return NextResponse.json({ error: "Sua conta não possui uma organização para cadastrar a empresa." }, { status: 403 });
  let certificateSent = false;
  try {
    const form = await req.formData();
    const raw = form.get("empresa");
    if (typeof raw !== "string") return NextResponse.json({ error: "Dados da empresa não informados." }, { status: 400 });
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("Dados da empresa inválidos.");
    const data = pickCompanySettings(parsed);
    const file = form.get("file");
    const password = form.get("password");
    if (file instanceof File && file.size > 0) {
      if (file.size > 2 * 1024 * 1024 || !/\.(pfx|p12)$/i.test(file.name)) {
        return NextResponse.json({ error: "Envie um certificado .pfx/.p12 de até 2 MB." }, { status: 400 });
      }
      if (typeof password !== "string" || !password) {
        return NextResponse.json({ error: "Informe a senha do certificado." }, { status: 400 });
      }
      const environment = data.environment === "homologation" ? "homologation" : "production";
      const token = await getNuvemFiscalToken(environment, "empresa empresa-cadastro");
      const response = await fetch(`${getLocalFiscalBaseUrl(environment)}/empresas/cadastro-certificado`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ empresa: data, externalCompanyId: profile.organization_id, ambientes: ["homologacao", "producao"],
          fileName: file.name, pfxBase64: Buffer.from(await file.arrayBuffer()).toString("base64"), password }),
        cache: "no-store",
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { message?: string };
        return NextResponse.json({ error: result.message || "A Nuvem Local não confirmou o cadastro da empresa e do certificado." }, { status: response.status });
      }
      certificateSent = true;
    } else if (typeof password === "string" && password) {
      return NextResponse.json({ error: "Selecione o arquivo do certificado." }, { status: 400 });
    }
    const result = await saveCompany(data);
    if (result.error) {
      return NextResponse.json({ error: certificateSent
        ? `A Nuvem Local recebeu a empresa e o certificado, mas o cadastro ainda precisa ser concluído: ${result.error}`
        : result.error, certificateSent }, { status: 422 });
    }
    return NextResponse.json({ success: true, certificateSent,
      message: certificateSent ? "Empresa e certificado cadastrados na Nuvem Local Fiscal." : "Dados da empresa sincronizados com a Nuvem Local Fiscal." });
  } catch {
    // Não inclui objetos de erro, FormData, certificado ou senha nos logs/respostas.
    return NextResponse.json({ error: certificateSent
      ? "A Nuvem Local recebeu o certificado, mas não foi possível concluir o cadastro. Consulte o status antes de repetir."
      : "Não foi possível concluir o cadastro. Confira os dados e as permissões da integração." }, { status: 502 });
  }
}
