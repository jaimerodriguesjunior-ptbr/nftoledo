import { NextRequest, NextResponse } from "next/server";
import forge from "node-forge";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const password = formData.get("password") as string;

    if (!file || !password) {
      return NextResponse.json(
        { error: "Arquivo ou senha do certificado faltando." },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Convert node buffer to forge binary string
    const pfxDer = buffer.toString("binary");
    const p12Asn1 = forge.asn1.fromDer(pfxDer);

    // Parse the PKCS#12 (.pfx) file
    let p12;
    try {
      p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);
    } catch (e) {
      return NextResponse.json(
        { error: "Senha incorreta ou arquivo de certificado corrompido." },
        { status: 400 }
      );
    }

    // Get certificate bags
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const certBag = certBags[forge.pki.oids.certBag]?.[0];

    if (!certBag || !certBag.cert) {
      return NextResponse.json(
        { error: "Certificado não encontrado no arquivo PFX." },
        { status: 400 }
      );
    }

    const cert = certBag.cert;
    const subjectAttrs = cert.subject.attributes;
    
    // Find the Common Name (CN)
    const cnAttr = subjectAttrs.find(
      (attr) => attr.type === forge.pki.oids.commonName || attr.name === "commonName"
    );

    if (!cnAttr || typeof cnAttr.value !== "string") {
      return NextResponse.json(
        { error: "Não foi possível extrair o Nome Comum (CN) do certificado." },
        { status: 400 }
      );
    }

    const cnValue = cnAttr.value;
    const lastColonIndex = cnValue.lastIndexOf(":");

    if (lastColonIndex === -1) {
      return NextResponse.json(
        { error: "Formato de certificado ICP-Brasil não identificado no Nome Comum (CN)." },
        { status: 400 }
      );
    }

    const razaoSocial = cnValue.substring(0, lastColonIndex).trim();
    const documentRaw = cnValue.substring(lastColonIndex + 1).trim();

    // Clean up non-digits to analyze document type
    const numericDocument = documentRaw.replace(/\D/g, "");
    let cnpj = "";
    
    if (numericDocument.length === 14) {
      // Format as CNPJ: 00.000.000/0001-00
      cnpj = numericDocument.replace(
        /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
        "$1.$2.$3/$4-$5"
      );
    } else if (numericDocument.length === 11) {
      // Format as CPF: 000.000.000-00
      cnpj = numericDocument.replace(
        /^(\d{3})(\d{3})(\d{3})(\d{2})$/,
        "$1.$2.$3-$5"
      );
    } else {
      // Fallback to raw string if length is unexpected
      cnpj = documentRaw;
    }

    return NextResponse.json({
      razaoSocial,
      cnpj,
      validFrom: cert.validity.notBefore,
      validTo: cert.validity.notAfter,
    });
  } catch (error: any) {
    console.error("Erro no processamento do certificado:", error);
    return NextResponse.json(
      { error: error.message || "Erro interno ao processar o certificado." },
      { status: 500 }
    );
  }
}
