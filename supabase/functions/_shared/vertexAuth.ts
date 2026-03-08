// Vertex AI 서비스 계정 인증: JWT 생성 + OAuth2 액세스 토큰 발급
// Deno 런타임(Supabase Edge Functions)에서 @google/genai SDK의
// googleAuthOptions가 동작하지 않으므로 직접 구현

// 서비스 계정 JSON 키의 필수 필드
export interface ServiceAccountCredentials {
    type: string;
    project_id: string;
    private_key_id: string;
    private_key: string;
    client_email: string;
    client_id: string;
    auth_uri: string;
    token_uri: string;
}

// 토큰 캐시 (1시간 유효, 갱신 마진 5분)
let cachedToken: { token: string; expiresAt: number } | null = null;

// ─── Base64url 인코딩 ────────────────────────────────

function base64urlEncode(data: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < data.length; i++) {
        binary += String.fromCharCode(data[i]);
    }
    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

function base64urlEncodeString(str: string): string {
    return base64urlEncode(new TextEncoder().encode(str));
}

// ─── PEM → ArrayBuffer 변환 ────────────────────────────

function pemToArrayBuffer(pem: string): ArrayBuffer {
    const b64 = pem
        .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/g, '')
        .replace(/-----END (?:RSA )?PRIVATE KEY-----/g, '')
        .replace(/\s/g, '');
    const binary = atob(b64);
    const buffer = new ArrayBuffer(binary.length);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i++) {
        view[i] = binary.charCodeAt(i);
    }
    return buffer;
}

// ─── JWT 서명 (RS256, Web Crypto API) ─────────────────

async function createSignedJWT(credentials: ServiceAccountCredentials): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
        iss: credentials.client_email,
        sub: credentials.client_email,
        aud: credentials.token_uri,
        iat: now,
        exp: now + 3600,
        scope: 'https://www.googleapis.com/auth/cloud-platform',
    };

    const headerB64 = base64urlEncodeString(JSON.stringify(header));
    const payloadB64 = base64urlEncodeString(JSON.stringify(payload));
    const unsignedJWT = `${headerB64}.${payloadB64}`;

    const keyBuffer = pemToArrayBuffer(credentials.private_key);
    const cryptoKey = await crypto.subtle.importKey(
        'pkcs8',
        keyBuffer,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign'],
    );

    const signature = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        cryptoKey,
        new TextEncoder().encode(unsignedJWT),
    );

    return `${unsignedJWT}.${base64urlEncode(new Uint8Array(signature))}`;
}

// ─── OAuth2 액세스 토큰 발급 (캐시 포함) ───────────────

export async function getAccessToken(credentials: ServiceAccountCredentials): Promise<string> {
    // 만료 5분 전까지는 캐시 재사용
    if (cachedToken && Date.now() < cachedToken.expiresAt - 300_000) {
        return cachedToken.token;
    }

    const jwt = await createSignedJWT(credentials);

    const response = await fetch(credentials.token_uri, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Vertex AI token exchange failed (${response.status}): ${body.substring(0, 500)}`);
    }

    const data = await response.json();
    cachedToken = {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in * 1000),
    };

    console.log('[VertexAuth] Access token acquired, expires in', data.expires_in, 'seconds');
    return data.access_token;
}

// ─── 서비스 계정 JSON 파싱 ────────────────────────────

export function parseServiceAccountJSON(jsonString: string): ServiceAccountCredentials {
    const creds = JSON.parse(jsonString);
    if (!creds.client_email || !creds.private_key || !creds.project_id) {
        throw new Error('Invalid service account JSON: missing client_email, private_key, or project_id');
    }
    return creds as ServiceAccountCredentials;
}

// ─── 토큰 캐시 초기화 (테스트용) ───────────────────────

export function clearTokenCache(): void {
    cachedToken = null;
}
