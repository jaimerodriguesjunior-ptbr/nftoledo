import { NextRequest, NextResponse } from "next/server";
import { getNuvemFiscalToken } from "@/lib/nuvemfiscal";

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get("file") as File;
        const cnpj = formData.get("cnpj") as string;
        const password = formData.get("password") as string;
        const environmentRaw = (formData.get("environment") as string) || "production";
        const environment = environmentRaw === "homologation" ? "homologation" : "production";

        if (!file || !cnpj || !password) {
            return NextResponse.json({ error: "Arquivo, CNPJ ou Senha faltando." }, { status: 400 });
        }

        const token = await getNuvemFiscalToken(environment);
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64Cert = buffer.toString("base64");

        const baseUrl = environment === "production"
            ? (process.env.NUVEMFISCAL_PROD_URL || "https://api.nuvemfiscal.com.br")
            : (process.env.NUVEMFISCAL_HOM_URL || "https://api.sandbox.nuvemfiscal.com.br");

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
            let details: unknown = null;
            try {
                details = await response.json();
            } catch {
                details = await response.text();
            }

            const d = details as Record<string, unknown> | string | null;
            const message =
                (typeof d === "object" && d !== null && "message" in d ? String(d.message) : null) ||
                (typeof d === "string" ? d : null) ||
                "Falha no upload do certificado";

            return NextResponse.json({ error: message, details }, { status: response.status });
        }

        return NextResponse.json({ success: true });

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Erro desconhecido";
        console.error("Erro no upload do certificado:", error);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
