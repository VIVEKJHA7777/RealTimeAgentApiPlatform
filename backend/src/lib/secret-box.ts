// Encrypting secrets we must be able to read back (API tokens' viewable copy, Jivox agents' MCP
// access keys): AES-256-GCM with TOKEN_ENCRYPTION_KEY (only in .env, never in the DB).
// Stored as "v1.<iv>.<ciphertext>.<tag>" (base64url parts). GCM also detects any change to the
// stored text. `bindTo` ("additional data") ties the copy to its row: moved to another row, it
// can't be decrypted there.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

const KEY = Buffer.from(env.TOKEN_ENCRYPTION_KEY.trim(), 'base64');

export function sealSecret(secret: string, bindTo: string): string {
  const iv = randomBytes(12); // new for every encryption (never reuse an IV with GCM)
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  cipher.setAAD(Buffer.from(bindTo));
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv, ciphertext, cipher.getAuthTag()].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
}

// The secret, or null if it can't be read: made with another TOKEN_ENCRYPTION_KEY, changed in
// the DB, or belonging to another row. Never throws.
export function openSecret(stored: string, bindTo: string): string | null {
  try {
    const [version, iv, ciphertext, tag] = stored.split('.');
    if (version !== 'v1' || !iv || !ciphertext || !tag) return null;
    const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(bindTo));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
