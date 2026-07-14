
export async function getNuvemFiscalToken(environment: 'production' | 'homologation' = 'production') {
    let clientId, clientSecret, authUrl;

    if (environment === 'production') {
        clientId = process.env.NUVEMFISCAL_PROD_CLIENT_ID;
        clientSecret = process.env.NUVEMFISCAL_PROD_CLIENT_SECRET;
        const apiUrl = (process.env.NUVEMFISCAL_PROD_URL || "").replace(/\/+$/, "");
        authUrl =
            process.env.NUVEMFISCAL_PROD_AUTH_URL ||
            (apiUrl && !apiUrl.includes("nuvemfiscal.com.br") ? `${apiUrl}/oauth/token` : "") ||
            "https://auth.nuvemfiscal.com.br/oauth/token";
    } else {
        clientId = process.env.NUVEMFISCAL_HOM_CLIENT_ID;
        clientSecret = process.env.NUVEMFISCAL_HOM_CLIENT_SECRET;
        const apiUrl = (process.env.NUVEMFISCAL_HOM_URL || "").replace(/\/+$/, "");
        authUrl =
            process.env.NUVEMFISCAL_HOM_AUTH_URL ||
            (apiUrl && !apiUrl.includes("nuvemfiscal.com.br") ? `${apiUrl}/oauth/token` : "") ||
            "https://auth.nuvemfiscal.com.br/oauth/token";
    }

    if (!clientId || !clientSecret) {
        throw new Error(`Credenciais da Nuvem Fiscal (${environment}) não encontradas no .env.local`);
    }

    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);
    params.append('scope', 'empresa nfce nfe nfse');

    try {
        const response = await fetch(authUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: params,
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[NuvemFiscal] Erro ao autenticar:`, errorText);
            throw new Error(`Falha na autenticação (${response.status})`);
        }

        const data = await response.json();
        return data.access_token;

    } catch (error) {
        console.error("[NuvemFiscal] Erro na conexão com Nuvem Fiscal:", error);
        throw error;
    }
}
