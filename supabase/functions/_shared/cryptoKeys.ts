/**
 * 사용자 API 키 암복호화 (AES-256-GCM) — Deno(Edge Function)용
 *
 * - 마스터키: 환경변수 API_KEY_ENCRYPTION_SECRET (임의 문자열 → SHA-256으로 32바이트 유도)
 * - 저장 형식: base64( iv[12] || ciphertext+authTag[16] )
 *   · Web Crypto의 AES-GCM은 authTag(16바이트)를 ciphertext 뒤에 붙여 반환한다.
 *   · GCF(Node.js)의 cloud-functions/analyze-image/shared/cryptoKeysNode.js와 동일 포맷 →
 *     한쪽에서 암호화한 값을 다른 쪽에서 복호화할 수 있다(이미지 분석 BYOK 공유).
 * - 사용자 평문 키는 절대 DB/로그/프론트에 남기지 않는다. 이 모듈로 암호화한 값만 저장.
 */

const IV_LEN = 12;

async function deriveKey(): Promise<CryptoKey> {
  const secret = Deno.env.get('API_KEY_ENCRYPTION_SECRET');
  if (!secret) {
    throw new Error('API_KEY_ENCRYPTION_SECRET 환경변수가 설정되지 않았습니다');
  }
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 평문 API 키를 암호화하여 base64 문자열로 반환 */
export async function encryptApiKey(plaintext: string): Promise<string> {
  if (!plaintext) throw new Error('암호화할 키가 비어있습니다');
  const key = await deriveKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ctBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const ct = new Uint8Array(ctBuf);
  const combined = new Uint8Array(IV_LEN + ct.byteLength);
  combined.set(iv, 0);
  combined.set(ct, IV_LEN);
  return bytesToBase64(combined);
}

/** 암호화된 base64 문자열을 평문 API 키로 복호화 */
export async function decryptApiKey(encoded: string): Promise<string> {
  if (!encoded) throw new Error('복호화할 값이 비어있습니다');
  const key = await deriveKey();
  const combined = base64ToBytes(encoded);
  const iv = combined.slice(0, IV_LEN);
  const ct = combined.slice(IV_LEN);
  const ptBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(ptBuf);
}

/** 키 끝 4자리만 노출하는 힌트 생성 (예: "sk-ant-...a1b2"). 저장/표시용. */
export function makeKeyHint(plaintext: string): string {
  if (!plaintext || plaintext.length < 4) return '****';
  return `...${plaintext.slice(-4)}`;
}
