/**
 * Desktop device tokens: entitlement, limit and audit for the desktop-only media routes.
 *
 * The desktop app registers itself once per install (while the user is signed in) and receives a per-device, expiring,
 * revocable token. Server media routes (`/ai-direct`, `/generate-from-prompt`, ...) require it, so:
 *   - a lost or stolen laptop can be revoked without touching the user's password or other devices;
 *   - a user can only have a bounded number of devices (MAX_DEVICES_PER_USER);
 *   - every use is attributable to a device.
 *
 * WHAT THIS IS NOT: proof that the caller is the genuine desktop app. A device token is issued to anyone who is signed
 * in and calls `register`, so a determined user can register from a script. Real attestation needs an OS-level signal
 * (a signed binary plus platform attestation) and is out of scope. This is a control, not a lock.
 *
 * Rollout switch DESKTOP_DEVICE_ENFORCEMENT: `off` (default; nothing changes) -> `report` (log what would be rejected)
 * -> `enforce` (reject). Turn it on only after the desktop app that registers devices has shipped.
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { redis } from '../../../config/redis';

export const MAX_DEVICES_PER_USER = 20;

/**
 * When the device limit is reached, the least-recently-seen device is evicted (LRU) instead of locking the user out,
 * but only if it has been idle for at least this many minutes, so two devices in active use can never evict each other.
 * DESKTOP_DEVICE_EVICTION_MIN_IDLE_MINUTES overrides the default (0 = any device except the requesting one).
 */
export const DEFAULT_EVICTION_MIN_IDLE_MINUTES = 30;
export function evictionMinIdleMs(): number {
  const raw = process.env.DESKTOP_DEVICE_EVICTION_MIN_IDLE_MINUTES;
  const n = raw == null || raw.trim() === '' ? DEFAULT_EVICTION_MIN_IDLE_MINUTES : Number(raw);
  return (Number.isFinite(n) && n >= 0 ? n : DEFAULT_EVICTION_MIN_IDLE_MINUTES) * 60_000;
}
/** lastSeenAt is refreshed on authenticated use at most this often (keeps Redis writes off the hot path). */
const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60_000;
export const DEVICE_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const DEVICE_HEADER = 'x-desktop-device-token';
export const NATIVE_DEVICE_HEADER = 'x-device-token';

export type EnforcementMode = 'off' | 'report' | 'enforce';

export function enforcementMode(): EnforcementMode {
  const v = (process.env.DESKTOP_DEVICE_ENFORCEMENT || 'off').toLowerCase();
  return v === 'enforce' || v === 'report' ? v : 'off';
}

/** Secret for signing native/desktop device registration tokens. Must be set and >= 32 chars. */
function secret(): string {
  const s = process.env.DESKTOP_DEVICE_JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error('DESKTOP_DEVICE_JWT_SECRET must be set and at least 32 characters');
  }
  return s;
}

export interface DeviceRecord {
  deviceId: string;
  label: string;
  createdAt: number;
  lastSeenAt: number;
  platform?: string;
  /** sha256 of the client's stable install key (e.g. Android ID) scoped to company + user; lets a reinstall reuse its slot. */
  installKeyHash?: string;
  /** Push notification registration (native mobile). Never returned to other users; per company + user registry. */
  push?: { provider: PushProvider; token: string; updatedAt: number };
}

export type PushProvider = 'fcm' | 'apns';

export const DESKTOP_PLATFORMS = ['windows', 'macos', 'linux'] as const;
export const MOBILE_PLATFORMS = ['ios', 'android'] as const;

/**
 * Normalises the client-reported platform. Case-insensitive ("iOS" is a phone, not a desktop). Unknown values are kept
 * (lower-cased, trimmed, bounded) for display/audit but never select the native-device token type.
 */
export function normalizePlatform(platform?: string): string | undefined {
  if (typeof platform !== 'string') return undefined;
  const p = platform.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '').slice(0, 20);
  if (!p) return undefined;
  if (p === 'mac' || p === 'darwin' || p === 'osx') return 'macos';
  if (p === 'win' || p === 'win32') return 'windows';
  return p;
}

export const isMobilePlatform = (platform?: string) => (MOBILE_PLATFORMS as readonly string[]).includes(platform || '');

function defaultLabel(platform?: string) {
  if (platform === 'ios') return 'iOS app';
  if (platform === 'android') return 'Android app';
  return 'Desktop app';
}

// ── registry (Redis; process memory only outside production) ─────────────────────────────────────────────────

const memory = new Map<string, Map<string, DeviceRecord>>();
const registryKey = (companyId: string, userId: string) => `desktop:devices:v1:${companyId}:${userId}`;

async function withRegistry<T>(redisOp: () => Promise<T>, memoryOp: () => T): Promise<T> {
  if (redis) {
    try {
      return await redisOp();
    } catch (err) {
      console.warn('[DesktopDevice] Redis operation failed, falling back to process memory registry:', (err as Error).message);
      return memoryOp();
    }
  }
  return memoryOp();
}

export async function listDevices(companyId: string, userId: string): Promise<DeviceRecord[]> {
  const rows = await withRegistry(
    async () => Object.values(await redis!.hgetall(registryKey(companyId, userId))).map((s) => JSON.parse(s as string) as DeviceRecord),
    () => [...(memory.get(registryKey(companyId, userId))?.values() ?? [])]
  );
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

async function saveDevice(companyId: string, userId: string, d: DeviceRecord) {
  await withRegistry(
    async () => {
      await redis!.hset(registryKey(companyId, userId), d.deviceId, JSON.stringify(d));
    },
    () => {
      const key = registryKey(companyId, userId);
      if (!memory.has(key)) memory.set(key, new Map());
      memory.get(key)!.set(d.deviceId, d);
    }
  );
}

export async function revokeDevice(companyId: string, userId: string, deviceId: string): Promise<boolean> {
  // A revoked device must stop receiving notifications: drop its push token from the owner index too.
  const current = await findDevice(companyId, userId, deviceId);
  if (!current) return false;

  const all = await listDevices(companyId, userId);
  const matchKey = current.installKeyHash
    ? (d: DeviceRecord) => d.installKeyHash === current.installKeyHash
    : (d: DeviceRecord) => d.platform === current.platform && d.label === current.label;

  const toRevoke = all.filter(matchKey);
  const targets = toRevoke.length > 0 ? toRevoke : [current];

  let anyRevoked = false;
  for (const d of targets) {
    if (d.push) await releasePushOwner(d.push.token, { companyId, userId, deviceId: d.deviceId });
    const ok = await withRegistry(
      async () => (await redis!.hdel(registryKey(companyId, userId), d.deviceId)) > 0,
      () => memory.get(registryKey(companyId, userId))?.delete(d.deviceId) ?? false
    );
    if (ok) anyRevoked = true;
  }
  return anyRevoked;
}

async function findDevice(companyId: string, userId: string, deviceId: string): Promise<DeviceRecord | null> {
  return withRegistry(
    async () => {
      const raw = await redis!.hget(registryKey(companyId, userId), deviceId);
      return raw ? (JSON.parse(raw) as DeviceRecord) : null;
    },
    () => memory.get(registryKey(companyId, userId))?.get(deviceId) ?? null
  );
}

// ── push token ownership ─────────────────────────────────────────────────────────────────────────────────────
// An FCM/APNs token identifies one app install, so it may belong to exactly ONE device record platform-wide. When a
// phone is handed to another user (or re-registers as a new device), the old record must stop pointing at it, or the
// previous user's notifications would be delivered to the new user. Keyed by a hash so raw push tokens are not keys.

interface PushOwner { companyId: string; userId: string; deviceId: string }

const pushMemory = new Map<string, PushOwner>();
const pushOwnerKey = (token: string) => `desktop:push-owner:v1:${crypto.createHash('sha256').update(token).digest('hex')}`;
const sameOwner = (a: PushOwner, b: PushOwner) => a.companyId === b.companyId && a.userId === b.userId && a.deviceId === b.deviceId;

async function getPushOwner(token: string): Promise<PushOwner | null> {
  return withRegistry(
    async () => {
      const raw = await redis!.get(pushOwnerKey(token));
      return raw ? (JSON.parse(raw) as PushOwner) : null;
    },
    () => pushMemory.get(pushOwnerKey(token)) ?? null
  );
}

async function setPushOwner(token: string, owner: PushOwner) {
  await withRegistry(
    async () => {
      await redis!.set(pushOwnerKey(token), JSON.stringify(owner));
    },
    () => {
      pushMemory.set(pushOwnerKey(token), owner);
    }
  );
}

/** Removes the ownership entry only if it still points at `owner` (another device may have claimed it since). */
async function releasePushOwner(token: string, owner: PushOwner) {
  const current = await getPushOwner(token);
  if (!current || !sameOwner(current, owner)) return;
  await withRegistry(
    async () => {
      await redis!.del(pushOwnerKey(token));
    },
    () => {
      pushMemory.delete(pushOwnerKey(token));
    }
  );
}

// ── registration ─────────────────────────────────────────────────────────────────────────────────────────────

export class DeviceLimitError extends Error {}

/** Install keys are client-reported: only accepted as a bounded opaque string and stored hashed per company + user. */
export function installKeyHashOf(companyId: string, userId: string, installKey?: string): string | undefined {
  if (typeof installKey !== 'string' || installKey.length < 8 || installKey.length > 200) return undefined;
  return crypto.createHash('sha256').update(`${companyId}:${userId}:${installKey}`).digest('hex');
}

export interface EvictedDevice {
  deviceId: string;
  label: string;
  platform: string | null;
  lastSeenAt: number;
}

/**
 * Picks the device to evict when the user is at the limit: the least-recently-seen one that is NOT the requesting
 * device and has been idle for at least `minIdleMs`. Returns null when every device is protected. Pure (tested directly).
 */
export function pickEvictionCandidate(devices: DeviceRecord[], opts: { now: number; minIdleMs: number; protectDeviceIds: Array<string | undefined> }): DeviceRecord | null {
  const protectedIds = new Set(opts.protectDeviceIds.filter(Boolean) as string[]);
  const seen = (d: DeviceRecord) => d.lastSeenAt || d.createdAt || 0;
  const candidates = devices
    .filter((d) => !protectedIds.has(d.deviceId))
    .filter((d) => opts.now - seen(d) >= opts.minIdleMs)
    .sort((a, b) => seen(a) - seen(b));
  return candidates[0] ?? null;
}

function signToken(companyId: string, userId: string, deviceId: string, platform?: string) {
  const typ = isMobilePlatform(platform) ? 'native-device' : 'desktop-device';
  return jwt.sign({ typ, cid: companyId, did: deviceId, platform }, secret(), {
    algorithm: 'HS256',
    subject: userId,
    expiresIn: DEVICE_TOKEN_TTL_SECONDS,
  });
}

/**
 * Registers a new device, or - when `deviceId` names a device this user already has - RENEWS it: a fresh token for the
 * same device that does not use up another slot. Tokens last 30 days, so without this every renewal would consume one of
 * the MAX_DEVICES_PER_USER slots. A revoked device cannot be renewed (it must be registered again, as a new device).
 */
export async function registerDevice(params: { companyId: string; userId: string; label?: string; platform?: string; deviceId?: string; currentDeviceId?: string; installKey?: string }) {
  const now = Date.now();
  const installKeyHash = installKeyHashOf(params.companyId, params.userId, params.installKey);
  if (params.deviceId || installKeyHash) {
    let current = params.deviceId ? await findDevice(params.companyId, params.userId, params.deviceId) : null;
    // Reinstall: the app lost its stored deviceId, but the stable install key matches an existing device of THIS user.
    if (!current && installKeyHash) current = (await listDevices(params.companyId, params.userId)).find((d) => d.installKeyHash === installKeyHash) ?? null;
    if (current) {
      await saveDevice(params.companyId, params.userId, { ...current, lastSeenAt: now });
      return { deviceId: current.deviceId, token: signToken(params.companyId, params.userId, current.deviceId, current.platform), label: current.label, platform: current.platform ?? null, kind: isMobilePlatform(current.platform) ? 'native-device' : 'desktop-device', expiresAt: now + DEVICE_TOKEN_TTL_SECONDS * 1000, renewed: true, evicted: null as EvictedDevice | null };
    }
    // unknown / revoked device id and no matching install key: fall through and register a brand new device
  }

  let evicted: EvictedDevice | null = null;
  let existing = await listDevices(params.companyId, params.userId);
  // Normally at most one eviction; the loop covers registries already over the limit (e.g. the limit was lowered).
  while (existing.length >= MAX_DEVICES_PER_USER) {
    const victim = pickEvictionCandidate(existing, { now, minIdleMs: evictionMinIdleMs(), protectDeviceIds: [params.currentDeviceId, params.deviceId] });
    if (!victim) {
      const minutes = Math.round(evictionMinIdleMs() / 60_000);
      throw new DeviceLimitError(
        `You already have ${existing.length} devices signed in and all of them were active in the last ${minutes} minutes. Remove one in Settings > Active devices, then try again.`
      );
    }
    await revokeDevice(params.companyId, params.userId, victim.deviceId);
    evicted = { deviceId: victim.deviceId, label: victim.label, platform: victim.platform ?? null, lastSeenAt: victim.lastSeenAt };
    console.warn(
      `[DesktopDevice] device limit reached for user=${params.userId} company=${params.companyId}; evicted least-recently-seen device ${victim.deviceId} (${victim.label}, last seen ${new Date(victim.lastSeenAt).toISOString()})`
    );
    existing = existing.filter((d) => d.deviceId !== victim.deviceId);
  }
  const deviceId = crypto.randomUUID();
  const platform = normalizePlatform(params.platform);
  const fallbackLabel = defaultLabel(platform);
  const label = (params.label || fallbackLabel).replace(/[^\w .\-()]/g, '').slice(0, 60) || fallbackLabel;
  await saveDevice(params.companyId, params.userId, { deviceId, label, createdAt: now, lastSeenAt: now, platform, ...(installKeyHash ? { installKeyHash } : {}) });

  const token = signToken(params.companyId, params.userId, deviceId, platform);
  return { deviceId, token, label, platform: platform ?? null, kind: isMobilePlatform(platform) ? 'native-device' : 'desktop-device', expiresAt: now + DEVICE_TOKEN_TTL_SECONDS * 1000, renewed: false, evicted };
}

/**
 * Attaches (or clears, with token=null) the FCM/APNs push token of one of the caller's OWN registered devices.
 * Returns false when the device does not exist for this company + user (never touches anyone else's registry).
 */
export async function setDevicePushToken(params: { companyId: string; userId: string; deviceId: string; provider?: PushProvider; token: string | null }): Promise<DeviceRecord | null> {
  const current = await findDevice(params.companyId, params.userId, params.deviceId);
  if (!current) return null;
  const self: PushOwner = { companyId: params.companyId, userId: params.userId, deviceId: params.deviceId };
  const next: DeviceRecord = { ...current, lastSeenAt: Date.now() };
  if (current.push && current.push.token !== params.token) await releasePushOwner(current.push.token, self);
  if (params.token && params.provider) {
    // The token may still be attached to another device (another user signed in on this phone before): detach it there.
    const previous = await getPushOwner(params.token);
    if (previous && !sameOwner(previous, self)) {
      const other = await findDevice(previous.companyId, previous.userId, previous.deviceId);
      if (other?.push?.token === params.token) {
        const { push: _detached, ...rest } = other;
        await saveDevice(previous.companyId, previous.userId, rest);
      }
    }
    await setPushOwner(params.token, self);
    next.push = { provider: params.provider, token: params.token, updatedAt: Date.now() };
  } else {
    delete next.push;
  }
  await saveDevice(params.companyId, params.userId, next);
  return next;
}

/**
 * Sign-out on a native device: clears that device's push token so a signed-out phone receives no more notifications.
 * Scoped to the company + user proven by the caller (the verified refresh token); no-op for unknown devices.
 */
export async function clearDevicePushOnLogout(params: { companyId: string; userId: string; deviceId: string }): Promise<boolean> {
  const current = await findDevice(params.companyId, params.userId, params.deviceId);
  if (!current?.push) return false;
  await setDevicePushToken({ ...params, token: null });
  return true;
}

// ── verification ────────────────────────────────────────────────────────────────────────────────────────────

export interface DeviceClaims {
  userId: string;
  companyId: string;
  deviceId: string;
}

export function verifyDeviceToken(token: string): DeviceClaims {
  const payload = jwt.verify(token, secret(), { algorithms: ['HS256'] }) as jwt.JwtPayload;
  if ((payload.typ !== 'desktop-device' && payload.typ !== 'native-device') || !payload.sub || !payload.cid || !payload.did) {
    throw new Error('not a native device token');
  }
  return { userId: String(payload.sub), companyId: String(payload.cid), deviceId: String(payload.did) };
}

/** Full check for a request: valid signature and expiry, belongs to THIS user and company, and not revoked. */
export async function checkRequestDevice(req: Request): Promise<{ ok: true; deviceId: string } | { ok: false; reason: string }> {
  const raw = req.headers[NATIVE_DEVICE_HEADER] || req.headers[DEVICE_HEADER];
  const token = Array.isArray(raw) ? raw[0] : raw;
  if (!token) return { ok: false, reason: 'missing_token' };

  let claims: DeviceClaims;
  try {
    claims = verifyDeviceToken(token);
  } catch (err: any) {
    // A missing server secret is a deployment error, not the caller's fault: surface it distinctly.
    return { ok: false, reason: /DESKTOP_DEVICE_JWT_SECRET/.test(err?.message) ? 'server_misconfigured' : 'invalid_token' };
  }

  const user = (req as any).user;
  if (!user?.id || claims.userId !== user.id || claims.companyId !== user.companyId) return { ok: false, reason: 'wrong_user' };

  let device: DeviceRecord | null = null;
  try {
    device = await findDevice(claims.companyId, claims.userId, claims.deviceId);
  } catch (err) {
    // Registry outage: fail open for verification (the signature and expiry above are still enforced). Registration
    // is the strict path; a Redis blip must not take video editing down for everyone.
    console.error('[DesktopDevice] registry unavailable, skipping revocation check:', (err as Error).message);
    return { ok: true, deviceId: claims.deviceId };
  }
  if (!device) return { ok: false, reason: 'revoked' };
  // Keep lastSeenAt meaningful for LRU eviction without writing on every request.
  if (Date.now() - (device.lastSeenAt || 0) > LAST_SEEN_WRITE_INTERVAL_MS) {
    await saveDevice(claims.companyId, claims.userId, { ...device, lastSeenAt: Date.now() }).catch(() => undefined);
  }
  return { ok: true, deviceId: claims.deviceId };
}

const MESSAGES: Record<string, string> = {
  missing_token: 'This feature is only available in the 180 Workspace desktop or mobile app. Install it, sign in, and try again.',
  invalid_token: 'This device\'s registration has expired or is invalid. Sign in again in the 180 Workspace app to re-register it.',
  wrong_user: 'This device is registered to a different account or workspace. Sign in again in the 180 Workspace app.',
  revoked: 'This device was removed from your account. Sign in again in the 180 Workspace app to register it.',
};

/** Express middleware. Mount AFTER `protect` (it needs req.user). */
export async function requireDesktopDevice(req: Request, res: Response, next: NextFunction) {
  const mode = enforcementMode();
  if (mode === 'off') return next();

  const result = await checkRequestDevice(req);
  if (result.ok) {
    (req as any).desktopDeviceId = result.deviceId;
    return next();
  }
  // Explicit: the backend tsconfig has strictNullChecks off, which disables boolean-discriminant narrowing.
  const { reason } = result as { ok: false; reason: string };

  if (mode === 'report') {
    console.warn(`[DesktopDevice] would reject ${req.method} ${req.originalUrl} (${reason}) user=${(req as any).user?.id}`);
    return next();
  }

  if (reason === 'server_misconfigured') {
    return res.status(503).json({ success: false, error: 'DESKTOP_DEVICE_UNAVAILABLE', message: 'Desktop device verification is not configured on the server.' });
  }
  return res.status(403).json({
    success: false,
    error: 'DESKTOP_APP_REQUIRED',
    reason,
    // The error code stays DESKTOP_APP_REQUIRED for existing web/desktop clients; the message covers the mobile app too.
    message: MESSAGES[reason] || MESSAGES.missing_token,
  });
}

export const requireNativeDevice = requireDesktopDevice;

/** Device id proven by a valid device token on this request (signature + same user and company), else undefined. */
export function requestDeviceId(req: Request): string | undefined {
  const raw = req.headers[NATIVE_DEVICE_HEADER] || req.headers[DEVICE_HEADER];
  const token = Array.isArray(raw) ? raw[0] : raw;
  if (!token) return undefined;
  try {
    const c = verifyDeviceToken(token);
    const user = (req as any).user;
    return user?.id && c.userId === String(user.id) && c.companyId === String(user.companyId) ? c.deviceId : undefined;
  } catch {
    return undefined;
  }
}

/** Test hook (refuses in production): set a device's lastSeenAt to simulate an idle device. */
export async function __setDeviceLastSeenForTest(companyId: string, userId: string, deviceId: string, lastSeenAt: number) {
  if (process.env.NODE_ENV === 'production') throw new Error('test hook is not available in production');
  const d = await findDevice(companyId, userId, deviceId);
  if (d) await saveDevice(companyId, userId, { ...d, lastSeenAt });
}

