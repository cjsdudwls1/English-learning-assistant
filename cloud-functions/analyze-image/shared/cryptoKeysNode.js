/**
 * 사용자 API 키 암복호화 (AES-256-GCM) — Node.js(GCF)용
 *
 * Edge(Deno)의 supabase/functions/_shared/cryptoKeys.ts와 **동일 포맷**으로 cross-decrypt 호환:
 *  - 마스터키: 환경변수 API_KEY_ENCRYPTION_SECRET → SHA-256으로 32바이트 유도(양쪽 동일)
 *  - 저장 형식: base64( iv[12] || ciphertext[N] || authTag[16] )
 *    · Node의 GCM은 ciphertext와 authTag를 분리 반환하므로 [iv, ct, tag] 순으로 직접 concat.
 *    · Web Crypto(Deno)는 ct 뒤 16바이트를 authTag로 간주 → Deno가 읽을 때 iv=[0:12],
 *      ct=[12:](= N+16, tag 포함)이 되어 정확히 호환된다.
 *
 * 보안: 평문 키는 이 모듈 밖으로 로깅/반환되지 않는다(복호화 결과만 호출부에 잠깐 전달).
 */
import crypto from 'node:crypto';

const IV_LEN = 12;
const TAG_LEN = 16;

function deriveKey() {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error('API_KEY_ENCRYPTION_SECRET 환경변수가 설정되지 않았습니다');
  }
  // SHA-256(secret) → 32바이트 키 (Edge cryptoKeys.ts와 동일)
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

/** 평문 API 키를 암호화하여 base64 문자열로 반환 (Deno와 cross-compat) */
export function encryptApiKey(plaintext) {
  if (!plaintext) throw new Error('암호화할 키가 비어있습니다');
  const key = deriveKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag(); // 16바이트
  return Buffer.concat([iv, ct, tag]).toString('base64');
}

/** 암호화된 base64 문자열을 평문 API 키로 복호화 (Deno가 암호화한 값도 복호 가능) */
export function decryptApiKey(encoded) {
  if (!encoded) throw new Error('복호화할 값이 비어있습니다');
  const key = deriveKey();
  const combined = Buffer.from(encoded, 'base64');
  if (combined.length < IV_LEN + TAG_LEN) {
    throw new Error('암호문 길이가 유효하지 않습니다');
  }
  const iv = combined.subarray(0, IV_LEN);
  const tag = combined.subarray(combined.length - TAG_LEN);
  const ct = combined.subarray(IV_LEN, combined.length - TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

/** 키 끝 4자리만 노출하는 힌트 (예: "...a1b2"). 저장/표시용. */
export function makeKeyHint(plaintext) {
  if (!plaintext || plaintext.length < 4) return '****';
  return `...${plaintext.slice(-4)}`;
}
