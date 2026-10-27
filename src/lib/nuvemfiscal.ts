import { getLocalFiscalBaseUrl } from "@/lib/local-fiscal-config";

export async function getNuvemFiscalToken(environment: 'production' | 'homologation' = 'production', scope = 'empresa nfse') {
    let clientId, clientSecret, authUrl;

    if (environment === 'production') {
        clientId = process.env.NUVEMFISCAL_PROD_CLIENT_ID;
        clientSecret = process.env.NUVEMFISCAL_PROD_CLIENT_SECRET;
        const apiUrl = getLocalFiscalBaseUrl(environment);
        authUrl =
            process.env.NUVEMFISCAL_PROD_AUTH_URL ||
            `${apiUrl}/oauth/token`;
    } else {
        clientId = process.env.NUVEMFISCAL_HOM_CLIENT_ID;
        clientSecret = process.env.NUVEMFISCAL_HOM_CLIENT_SECRET;
        const apiUrl = getLocalFiscalBaseUrl(environment);
        authUrl =
            process.env.NUVEMFISCAL_HOM_AUTH_URL ||
            `${apiUrl}/oauth/token`;
    }

    if (!clientId || !clientSecret) {
        throw new Error(`Credenciais da Nuvem Fiscal (${environment}) não encontradas no .env.local`);
    }

    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);
    params.append('scope', scope);

    try {
        const response = await fetch(authUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: params,
        });

        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.error === 'invalid_scope'
                ? 'A integração não possui as permissões necessárias na Nuvem Local Fiscal.'
                : `Falha na autenticação da Nuvem Local Fiscal (${response.status}).`);
        }

        const data = await response.json();
        return data.access_token;

    } catch (error) {
        console.error("[NuvemFiscal] Erro na conexão com Nuvem Fiscal:", error);
        throw error;
    }
}
