import { NextRequest, NextResponse } from "next/server";
import { getNuvemFiscalToken } from "@/lib/nuvemfiscal";
import { getLocalFiscalBaseUrl } from "@/lib/local-fiscal-config";
import { createClient } from "@/utils/supabase/server";

export async function POST(req: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
        const formData = await req.formData();
        const file = formData.get("file") as File;
        const cnpj = formData.get("cnpj") as string;
        const password = formData.get("password") as string;
        const environmentRaw = (formData.get("environment") as string) || "production";
        const environment = environmentRaw === "homologation" ? "homologation" : "production";

        if (!(file instanceof File) || typeof cnpj !== "string" || !cnpj || typeof password !== "string" || !password) {
            return NextResponse.json({ error: "Arquivo, CNPJ ou Senha faltando." }, { status: 400 });
        }

        const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).single();
        const { data: company } = await supabase.from("company_settings").select("cnpj").eq("organization_id", profile?.organization_id).single();
        if (!company?.cnpj || company.cnpj.replace(/\D/g, "") !== cnpj.replace(/\D/g, "")) {
            return NextResponse.json({ error: "Cadastre a empresa da sua conta antes de enviar o certificado." }, { status: 403 });
        }
        if (file.size > 2 * 1024 * 1024) {
            return NextResponse.json({ error: "O certificado deve ter até 2 MB." }, { status: 400 });
        }

        const token = await getNuvemFiscalToken(environment);
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64Cert = buffer.toString("base64");

        const baseUrl = getLocalFiscalBaseUrl(environment);

        const response = await fetch(`${baseUrl}/empresas/${cnpj.replace(/\D/g, "")}/certificado`, {
            method: "PUT",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                fileName: file.name || "certificado.pfx",
                pfxBase64: base64Cert,
                password: password
            })
        });

        if (!response.ok) {
            const responseText = await response.text();
            let details: unknown = null;
            try { details = JSON.parse(responseText); } catch { /* resposta não estruturada */ }

            const d = details as Record<string, unknown> | string | null;
            const message =
                (typeof d === "object" && d !== null && "message" in d ? String(d.message) : null) ||
                (typeof d === "string" ? d : null) ||
                "Falha no upload do certificado";

            return NextResponse.json({ error: message }, { status: response.status });
        }

        return NextResponse.json({ success: true });

    } catch {
        return NextResponse.json({ error: "Não foi possível enviar o certificado à Nuvem Local Fiscal." }, { status: 500 });
    }
}
