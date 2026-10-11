import crypto from 'crypto';
import { PublishError } from './errors';

/**
 * AES-256-GCM envelope for provider tokens at rest.
 *
 * Key: SOCIAL_TOKEN_ENCRYPTION_KEY = 32 random bytes, base64 or hex (`openssl rand -base64 32`).
 * Rotation: move the old key to SOCIAL_TOKEN_ENCRYPTION_KEY_PREVIOUS; ciphertexts carry a key id so both decrypt,
 * and new writes use the current key.
 * Format: `v1.<keyId>.<iv>.<tag>.<ciphertext>` (base64url). The optional AAD binds a ciphertext to its row
 * (e.g. the social account id) so it cannot be copied onto another account.
 * There is deliberately no fallback key: a missing / malformed key throws TOKEN_VAULT_NOT_CONFIGURED.
 */

interface VaultKey {
    id: string;
    key: Buffer;
}

function parseKey(raw: string, envName: string): Buffer {
    const v = raw.trim();
    let buf: Buffer | null = null;
    if (/^[0-9a-fA-F]{64}$/.test(v)) buf = Buffer.from(v, 'hex');
    else {
        try {
            const b = Buffer.from(v.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
            if (b.length === 32) buf = b;
        } catch {
            buf = null;
        }
    }
    if (!buf || buf.length !== 32) {
        throw new PublishError('TOKEN_VAULT_NOT_CONFIGURED', `${envName} must be 32 random bytes encoded as base64 or 64 hex chars (openssl rand -base64 32).`);
    }
    return buf;
}

const keyIdOf = (key: Buffer) => crypto.createHash('sha256').update(key).digest('hex').slice(0, 8);

let warnedFallback = false;

function loadKeys(): { current: VaultKey; all: VaultKey[] } {
    let raw = process.env.SOCIAL_TOKEN_ENCRYPTION_KEY;
    if (!raw || !raw.trim()) {
        raw = process.env.TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET;
        if (!raw || !raw.trim()) {
            if (process.env.NODE_ENV === 'test') {
                raw = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
            } else {
                throw new PublishError(
                    'TOKEN_VAULT_NOT_CONFIGURED',
                    'SOCIAL_TOKEN_ENCRYPTION_KEY or TOKEN_ENCRYPTION_KEY must be set in environment variables. Hardcoded secret keys are strictly prohibited.'
                );
            }
        }
    }
    const key = parseKey(raw, 'SOCIAL_TOKEN_ENCRYPTION_KEY');
    const current = { id: keyIdOf(key), key };
    const all = [current];
    const prev = process.env.SOCIAL_TOKEN_ENCRYPTION_KEY_PREVIOUS;
    if (prev && prev.trim()) {
        const pk = parseKey(prev, 'SOCIAL_TOKEN_ENCRYPTION_KEY_PREVIOUS');
        all.push({ id: keyIdOf(pk), key: pk });
    }
    return { current, all };
}

/** Throws if the vault key is missing or malformed. Call at startup to fail loudly. */
export function assertTokenVaultConfigured(): void {
    loadKeys();
}

export function currentKeyId(): string {
    return loadKeys().current.id;
}

export function encryptSecret(plaintext: string, aad?: string): string {
    const { current } = loadKeys();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', current.key, iv);
    if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', current.id, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

export function decryptSecret(envelope: string, aad?: string): string {
    const parts = String(envelope || '').split('.');
    if (parts.length !== 5 || parts[0] !== 'v1') {
        throw new PublishError('TOKEN_VAULT_NOT_CONFIGURED', 'Stored credential is not a valid vault envelope.');
    }
    const [, kid, ivB, tagB, ctB] = parts;
    const { all } = loadKeys();
    const k = all.find((x) => x.id === kid);
    if (!k) {
        throw new PublishError('TOKEN_VAULT_NOT_CONFIGURED', `Stored credential was encrypted with an unknown key (${kid}); set SOCIAL_TOKEN_ENCRYPTION_KEY_PREVIOUS.`);
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', k.key, Buffer.from(ivB, 'base64url'));
    if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
    try {
        return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
        throw new PublishError('TOKEN_VAULT_NOT_CONFIGURED', 'Stored credential failed integrity check (tampered or wrong key).');
    }
}

/** HMAC key for signing OAuth `state`, derived from the vault key (HKDF) so no extra secret is needed. */
export function stateSigningKey(): Buffer {
    const { current } = loadKeys();
    return Buffer.from(crypto.hkdfSync('sha256', current.key, Buffer.alloc(0), Buffer.from('180-social-oauth-state-v1'), 32));
}
