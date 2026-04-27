'use strict';

/**
 * tokenEncryption.js — AES-256-GCM encryption for OAuth tokens
 *
 * Stored format: `enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>`
 * Plaintext tokens (no prefix) pass through unchanged for backward compat
 * during migration.
 *
 * Required env var: TOKEN_ENCRYPTION_KEY — 64 hex chars (32 bytes)
 * Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const PREFIX    = 'enc:v1:';
const IV_BYTES  = 16;

function _getKey() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      '[tokenEncryption] TOKEN_ENCRYPTION_KEY is not set. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  if (raw.length !== 64) {
    throw new Error(
      `[tokenEncryption] TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes). Got length: ${raw.length}`
    );
  }
  return Buffer.from(raw, 'hex');
}

/**
 * Encrypt a plaintext token.
 * @param {string} plaintext
 * @returns {string} `enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>`
 */
function encrypt(plaintext) {
  if (!plaintext) return plaintext; // pass through null/undefined/empty

  const key    = _getKey();
  const iv     = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag   = cipher.getAuthTag();

  return `${PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a stored token value.
 * - If it starts with 'enc:v1:' → decrypt and return plaintext
 * - Otherwise → return as-is (backward compat for not-yet-migrated tokens)
 * @param {string} stored
 * @returns {string} plaintext token
 * @throws if decryption fails (wrong key, tampered ciphertext, etc.)
 */
function decrypt(stored) {
  if (!stored) return stored; // pass through null/undefined/empty
  if (!stored.startsWith(PREFIX)) return stored; // plaintext passthrough

  const withoutPrefix = stored.slice(PREFIX.length);
  const parts = withoutPrefix.split(':');
  if (parts.length !== 3) {
    throw new Error('[tokenEncryption] Malformed encrypted token: unexpected format');
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;

  try {
    const key        = _getKey();
    const iv         = Buffer.from(ivHex, 'hex');
    const authTag    = Buffer.from(authTagHex, 'hex');
    const ciphertext = Buffer.from(ciphertextHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) {
    throw new Error(`[tokenEncryption] Decryption failed: ${err.message}`);
  }
}

/**
 * Check whether a stored value is already encrypted.
 * @param {string} value
 * @returns {boolean}
 */
function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

module.exports = { encrypt, decrypt, isEncrypted };
