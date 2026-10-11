/**
 * Cryptographic helpers: password hashing (scrypt), opaque session tokens,
 * and HMAC-signed SDK session tokens.
 */
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 } as const;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_PARAMS.keylen, { N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `scrypt$${SCRYPT_PARAMS.N}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, , saltText, keyText] = stored.split('$');
  if (scheme !== 'scrypt' || !saltText || !keyText) return false;
  const expected = Buffer.from(keyText, 'base64url');
  const actual = await scryptAsync(password, Buffer.from(saltText, 'base64url'));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface SdkTokenClaims {
  /** application id */
  app: string;
  org: string;
  env: 'development' | 'production';
  /** origin the token was issued to */
  origin: string;
  /** expiry, epoch seconds */
  exp: number;
}

export function signSdkToken(claims: SdkTokenClaims, secret: string): string {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function verifySdkToken(token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): SdkTokenClaims | null {
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  if (!safeEqual(signature, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SdkTokenClaims;
    if (typeof claims.exp !== 'number' || claims.exp < nowSeconds) return null;
    if (typeof claims.app !== 'string' || typeof claims.org !== 'string' || typeof claims.origin !== 'string') return null;
    if (claims.env !== 'development' && claims.env !== 'production') return null;
    return claims;
  } catch {
    return null;
  }
}
