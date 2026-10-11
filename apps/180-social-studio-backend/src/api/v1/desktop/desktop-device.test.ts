/**
 * Run: npx tsx --test --test-force-exit apps/backend/src/api/v1/desktop/desktop-device.test.ts
 * (Redis is not needed: outside production the device registry falls back to process memory.)
 */
process.env.NODE_ENV = 'test';
process.env.DESKTOP_DEVICE_JWT_SECRET = 'unit-test-secret-unit-test-secret-1234';

import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import jwt from 'jsonwebtoken';
import desktopRoutes from './desktop.routes';
import { DEVICE_HEADER, NATIVE_DEVICE_HEADER, MAX_DEVICES_PER_USER, __setDeviceLastSeenForTest, pickEvictionCandidate, requireDesktopDevice, requireNativeDevice, verifyDeviceToken } from './desktop-device';

let server: http.Server;
let base = '';

before(async () => {
  const app = express();
  app.use(express.json());
  // stand-in for `protect`: identity comes from a test header
  app.use((req: any, res, next) => {
    const id = req.headers['x-test-user'];
    if (!id) return res.status(401).json({ error: 'no' });
    req.user = { id: String(id), companyId: String(req.headers['x-test-company'] || 'co-1') };
    next();
  });
  app.use('/api/desktop', desktopRoutes);
  app.post('/api/media/render', requireDesktopDevice, (req: any, res) => res.json({ ok: true, deviceId: req.desktopDeviceId ?? null }));

  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const call = (method: string, path: string, opts: { user?: string; company?: string; token?: string; body?: any } = {}) =>
  fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(opts.user ? { 'x-test-user': opts.user } : {}),
      ...(opts.company ? { 'x-test-company': opts.company } : {}),
      ...(opts.token ? { [DEVICE_HEADER]: opts.token } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(async (r) => ({ status: r.status, json: (await r.json()) as any }));

const register = (user: string, label = 'Laptop') => call('POST', '/api/desktop/devices/register', { user, body: { label, platform: 'windows' } });
const render = (user: string, token?: string) => call('POST', '/api/media/render', { user, token });

let userSeq = 0;
const freshUser = () => `user-${Date.now()}-${userSeq++}`;

beforeEach(() => {
  process.env.DESKTOP_DEVICE_ENFORCEMENT = 'enforce';
  process.env.DESKTOP_DEVICE_JWT_SECRET = 'unit-test-secret-unit-test-secret-1234';
});

test('requires a signed-in user', async () => {
  assert.equal((await call('POST', '/api/desktop/devices/register')).status, 401);
});

test('there is no default secret: without DESKTOP_DEVICE_JWT_SECRET registration fails loudly (503), nothing is issued', async () => {
  delete process.env.DESKTOP_DEVICE_JWT_SECRET;
  const r = await register(freshUser());
  assert.equal(r.status, 503);
  assert.equal(r.json.error, 'DESKTOP_DEVICE_UNAVAILABLE');
  assert.equal(r.json.token, undefined);
  process.env.DESKTOP_DEVICE_JWT_SECRET = 'short';
  assert.equal((await register(freshUser())).status, 503, 'a short secret is refused too');
});

test('registration returns a per-device token that verifies and is listed for its owner only', async () => {
  const u = freshUser();
  const r = await register(u, 'My <script>Laptop</script>');
  assert.equal(r.status, 201);
  assert.match(r.json.token, /^eyJ/);
  assert.equal(r.json.label, 'My scriptLaptopscript', 'label is sanitised');
  const claims = verifyDeviceToken(r.json.token);
  assert.equal(claims.userId, u);
  assert.equal(claims.deviceId, r.json.deviceId);

  const mine = await call('GET', '/api/desktop/devices', { user: u });
  assert.equal(mine.json.devices.length, 1);
  const other = await call('GET', '/api/desktop/devices', { user: freshUser() });
  assert.equal(other.json.devices.length, 0, 'devices are per user');
});

test('a user can register at most MAX_DEVICES_PER_USER devices', async () => {
  const u = freshUser();
  for (let i = 0; i < MAX_DEVICES_PER_USER; i++) assert.equal((await register(u, `d${i}`)).status, 201);
  const over = await register(u);
  assert.equal(over.status, 409);
  assert.equal(over.json.error, 'DEVICE_LIMIT');
});

test('renewal re-issues a token for the SAME device without using another slot; a revoked device cannot be renewed', async () => {
  const u = freshUser();
  const first = (await register(u)).json;
  for (let i = 0; i < 3; i++) {
    const renewed = await call('POST', '/api/desktop/devices/register', { user: u, body: { deviceId: first.deviceId } });
    assert.equal(renewed.status, 201);
    assert.equal(renewed.json.deviceId, first.deviceId);
    assert.equal(renewed.json.renewed, true);
    assert.equal((await render(u, renewed.json.token)).status, 200);
  }
  assert.equal((await call('GET', '/api/desktop/devices', { user: u })).json.devices.length, 1, 'renewals do not add devices');

  await call('DELETE', `/api/desktop/devices/${first.deviceId}`, { user: u });
  const afterRevoke = await call('POST', '/api/desktop/devices/register', { user: u, body: { deviceId: first.deviceId } });
  assert.equal(afterRevoke.status, 201);
  assert.notEqual(afterRevoke.json.deviceId, first.deviceId, 'a revoked device id is never resurrected');
  assert.equal(afterRevoke.json.renewed, false);

  // someone else's device id cannot be renewed by another user
  const stranger = freshUser();
  const theirs = await call('POST', '/api/desktop/devices/register', { user: stranger, body: { deviceId: afterRevoke.json.deviceId } });
  assert.notEqual(theirs.json.deviceId, afterRevoke.json.deviceId);
});

test('enforce: no token, garbage, another user\'s token, a forged/expired/wrong-type token are all rejected', async () => {
  const u = freshUser();
  const good = (await register(u)).json.token;

  assert.equal((await render(u)).status, 403);
  assert.equal((await render(u)).json.error, 'DESKTOP_APP_REQUIRED');
  assert.equal((await render(u, 'not-a-token')).json.reason, 'invalid_token');

  const someoneElse = freshUser();
  assert.equal((await render(someoneElse, good)).json.reason, 'wrong_user', 'a token is bound to its user');
  const otherCompany = await call('POST', '/api/media/render', { user: u, company: 'co-2', token: good });
  assert.equal(otherCompany.json.reason, 'wrong_user', 'and to its company');

  const secret = process.env.DESKTOP_DEVICE_JWT_SECRET!;
  const claims = verifyDeviceToken(good);
  const forged = jwt.sign({ typ: 'desktop-device', cid: 'co-1', did: claims.deviceId }, 'attacker-secret-attacker-secret-123456', { subject: u, expiresIn: 60 });
  assert.equal((await render(u, forged)).json.reason, 'invalid_token');
  const expired = jwt.sign({ typ: 'desktop-device', cid: 'co-1', did: claims.deviceId }, secret, { subject: u, expiresIn: -10 });
  assert.equal((await render(u, expired)).json.reason, 'invalid_token');
  const wrongType = jwt.sign({ typ: 'access', cid: 'co-1', did: claims.deviceId }, secret, { subject: u, expiresIn: 60 });
  assert.equal((await render(u, wrongType)).json.reason, 'invalid_token', 'a normal user JWT signed with the same secret must not work');
  const unsigned = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ typ: 'desktop-device', sub: u, cid: 'co-1', did: claims.deviceId })).toString('base64url')}.`;
  assert.equal((await render(u, unsigned)).json.reason, 'invalid_token', 'alg=none is refused');
});

test('enforce: a valid token passes and identifies the device; revoking it stops it immediately', async () => {
  const u = freshUser();
  const reg = await register(u);
  const ok = await render(u, reg.json.token);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.deviceId, reg.json.deviceId);

  assert.equal((await call('DELETE', `/api/desktop/devices/${reg.json.deviceId}`, { user: u })).status, 200);
  const after = await render(u, reg.json.token);
  assert.equal(after.status, 403);
  assert.equal(after.json.reason, 'revoked');
});

test('a user cannot revoke another user\'s device', async () => {
  const owner = freshUser();
  const reg = await register(owner);
  const attacker = await call('DELETE', `/api/desktop/devices/${reg.json.deviceId}`, { user: freshUser() });
  assert.equal(attacker.status, 404);
  assert.equal((await render(owner, reg.json.token)).status, 200, 'still valid');
});

test('report mode never blocks (it only logs); off mode is inert', async () => {
  const u = freshUser();
  process.env.DESKTOP_DEVICE_ENFORCEMENT = 'report';
  assert.equal((await render(u)).status, 200);
  process.env.DESKTOP_DEVICE_ENFORCEMENT = 'off';
  assert.equal((await render(u)).status, 200);
  delete process.env.DESKTOP_DEVICE_ENFORCEMENT;
  assert.equal((await render(u)).status, 200, 'unset defaults to off, so deploying this changes nothing by itself');
  process.env.DESKTOP_DEVICE_ENFORCEMENT = 'garbage';
  assert.equal((await render(u)).status, 200, 'an unknown value is treated as off, never as enforce');
});

test('enforce without a server secret answers 503 (misconfiguration), not a misleading 403', async () => {
  const u = freshUser();
  const token = (await register(u)).json.token;
  delete process.env.DESKTOP_DEVICE_JWT_SECRET;
  const r = await render(u, token);
  assert.equal(r.status, 503);
});

test('native mobile devices (ios/android) register native-device tokens and authenticate via x-device-token', async () => {
  const u = freshUser();
  const regIos = await call('POST', '/api/desktop/devices/register', { user: u, body: { label: 'iPhone 15 Pro', platform: 'ios' } });
  assert.equal(regIos.status, 201);
  assert.equal(regIos.json.success, true);

  // Token should verify as native device
  const claims = verifyDeviceToken(regIos.json.token);
  assert.equal(claims.userId, u);
  assert.equal(claims.deviceId, regIos.json.deviceId);

  // Authenticate using NATIVE_DEVICE_HEADER ('x-device-token')
  const authResponse = await fetch(base + '/api/media/render', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-test-user': u,
      [NATIVE_DEVICE_HEADER]: regIos.json.token,
    },
  }).then(async (r) => ({ status: r.status, json: (await r.json()) as any }));

  assert.equal(authResponse.status, 200);
  assert.equal(authResponse.json.deviceId, regIos.json.deviceId);
});


test('platform is normalised: "iOS" / "Android" get native-device tokens, desktop platforms and unknown values stay desktop-device', async () => {
  const u = freshUser();
  const kindOf = (t: string) => (jwt.decode(t) as any).typ;
  const ios = await call('POST', '/api/desktop/devices/register', { user: u, body: { platform: 'iOS' } });
  assert.equal(ios.status, 201);
  assert.equal(ios.json.platform, 'ios');
  assert.equal(ios.json.kind, 'native-device');
  assert.equal(ios.json.label, 'iOS app', 'mobile devices do not default to "Desktop app"');
  assert.equal(kindOf(ios.json.token), 'native-device');

  const android = await call('POST', '/api/desktop/devices/register', { user: u, body: { platform: ' ANDROID ' } });
  assert.equal(kindOf(android.json.token), 'native-device');

  const win = await call('POST', '/api/desktop/devices/register', { user: u, body: { platform: 'windows' } });
  assert.equal(win.json.kind, 'desktop-device');
  assert.equal(win.json.label, 'Desktop app');
  const legacy = await call('POST', '/api/desktop/devices/register', { user: u, body: {} });
  assert.equal(kindOf(legacy.json.token), 'desktop-device', 'desktop app that sends no platform keeps its old token type');

  // renewal keeps the stored platform even if the client omits it
  const renewed = await call('POST', '/api/desktop/devices/register', { user: u, body: { deviceId: ios.json.deviceId } });
  assert.equal(renewed.json.renewed, true);
  assert.equal(kindOf(renewed.json.token), 'native-device');
});

test('the legacy x-desktop-device-token header still works for native-device tokens, and rejections explain themselves', async () => {
  const u = freshUser();
  const reg = await call('POST', '/api/desktop/devices/register', { user: u, body: { platform: 'android' } });
  const viaLegacyHeader = await render(u, reg.json.token);
  assert.equal(viaLegacyHeader.status, 200);

  const missing = await render(u);
  assert.equal(missing.json.error, 'DESKTOP_APP_REQUIRED', 'error code unchanged for existing clients');
  assert.match(missing.json.message, /desktop or mobile app/);
  await call('DELETE', `/api/desktop/devices/${reg.json.deviceId}`, { user: u });
  const revoked = await render(u, reg.json.token);
  assert.equal(revoked.json.reason, 'revoked');
  assert.match(revoked.json.message, /removed from your account/);
});

test('push tokens: owner can set and clear; token never echoed; other users cannot touch the device; input validated', async () => {
  const u = freshUser();
  const reg = await call('POST', '/api/desktop/devices/register', { user: u, body: { platform: 'ios', label: 'iPhone' } });
  const path = `/api/desktop/devices/${reg.json.deviceId}/push-token`;
  const pushToken = 'a'.repeat(64);

  assert.equal((await call('PUT', path, { user: u, body: { provider: 'gcm', token: pushToken } })).status, 400);
  assert.equal((await call('PUT', path, { user: u, body: { provider: 'apns', token: 'short' } })).status, 400);
  assert.equal((await call('PUT', path, { user: freshUser(), body: { provider: 'apns', token: pushToken } })).status, 404, 'not your device');
  assert.equal((await call('PUT', path, { user: u, company: 'co-2', body: { provider: 'apns', token: pushToken } })).status, 404, 'not your company');

  const ok = await call('PUT', path, { user: u, body: { provider: 'apns', token: pushToken } });
  assert.equal(ok.status, 200);
  assert.deepEqual({ provider: ok.json.device.push.provider, registered: ok.json.device.push.registered }, { provider: 'apns', registered: true });
  assert.ok(!JSON.stringify(ok.json).includes(pushToken), 'push token is not echoed');
  const listed = await call('GET', '/api/desktop/devices', { user: u });
  assert.ok(!JSON.stringify(listed.json).includes(pushToken), 'nor listed');

  const cleared = await call('PUT', path, { user: u, body: { token: null } });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.json.device.push, null);
});

// ── LRU eviction at the device limit ─────────────────────────────────────────────────────────────────────────

test('at the limit the least-recently-seen idle device is evicted (and reported); the requester and recent devices never are', async () => {
  const u = freshUser();
  const ids: string[] = [];
  const tokens: string[] = [];
  for (let i = 0; i < MAX_DEVICES_PER_USER; i++) {
    const r = await register(u, `d${i}`);
    ids.push(r.json.deviceId);
    tokens.push(r.json.token);
  }
  const hour = 60 * 60_000;
  const now = Date.now();
  // d0 is the requester but the oldest; d1 is the next-oldest idle device; all others were seen just now.
  await __setDeviceLastSeenForTest('co-1', u, ids[0], now - 10 * hour);
  await __setDeviceLastSeenForTest('co-1', u, ids[1], now - 5 * hour);
  await __setDeviceLastSeenForTest('co-1', u, ids[2], now - 2 * hour);

  const res = await call('POST', '/api/desktop/devices/register', { user: u, token: tokens[0], body: { label: 'New phone', platform: 'android' } });
  assert.equal(res.status, 201);
  assert.equal(res.json.evicted.deviceId, ids[1], 'LRU idle device (excluding the requester) is evicted');
  assert.equal(res.json.evicted.label, 'd1');

  const list = await call('GET', '/api/desktop/devices', { user: u, token: tokens[0] });
  const listed = list.json.devices.map((d: any) => d.deviceId);
  assert.equal(listed.length, MAX_DEVICES_PER_USER);
  assert.ok(!listed.includes(ids[1]));
  assert.ok(listed.includes(ids[0]), 'the requesting device survives');
  assert.deepEqual(list.json.devices.filter((d: any) => d.current).map((d: any) => d.deviceId), [ids[0]], 'current device is flagged');
  assert.equal((await render(u, tokens[1])).status, 403, 'the evicted device token stops working');
});

test('eviction honours DESKTOP_DEVICE_EVICTION_MIN_IDLE_MINUTES; with no idle device the limit still answers 409', async () => {
  const u = freshUser();
  const ids: string[] = [];
  for (let i = 0; i < MAX_DEVICES_PER_USER; i++) ids.push((await register(u, `d${i}`)).json.deviceId);
  await __setDeviceLastSeenForTest('co-1', u, ids[5], Date.now() - 20 * 60_000); // idle 20 min

  process.env.DESKTOP_DEVICE_EVICTION_MIN_IDLE_MINUTES = '30';
  const blocked = await register(u, 'extra');
  assert.equal(blocked.status, 409, '20 minutes idle is not enough with a 30 minute window');
  assert.match(blocked.json.message, /Active devices/);

  process.env.DESKTOP_DEVICE_EVICTION_MIN_IDLE_MINUTES = '15';
  const ok = await register(u, 'extra');
  assert.equal(ok.status, 201);
  assert.equal(ok.json.evicted.deviceId, ids[5]);
  delete process.env.DESKTOP_DEVICE_EVICTION_MIN_IDLE_MINUTES;
});

test('pickEvictionCandidate: pure LRU choice with protection and idle window', () => {
  const now = 1_000_000_000;
  const d = (id: string, ageMin: number) => ({ deviceId: id, label: id, createdAt: 0, lastSeenAt: now - ageMin * 60_000 });
  const devices = [d('a', 90), d('b', 300), d('c', 5), d('me', 999)];
  assert.equal(pickEvictionCandidate(devices, { now, minIdleMs: 30 * 60_000, protectDeviceIds: ['me'] })?.deviceId, 'b');
  assert.equal(pickEvictionCandidate(devices, { now, minIdleMs: 400 * 60_000, protectDeviceIds: ['me'] }), null);
  assert.equal(pickEvictionCandidate(devices, { now, minIdleMs: 0, protectDeviceIds: [undefined] })?.deviceId, 'me');
});

test('reinstall: a matching install key renews the same device slot even without the stored deviceId; keys are per user', async () => {
  const u = freshUser();
  const key = 'android-id-0123456789abcdef';
  const first = await call('POST', '/api/desktop/devices/register', { user: u, body: { platform: 'android', installKey: key } });
  const again = await call('POST', '/api/desktop/devices/register', { user: u, body: { platform: 'android', installKey: key } });
  assert.equal(again.json.deviceId, first.json.deviceId);
  assert.equal(again.json.renewed, true);
  const list = await call('GET', '/api/desktop/devices', { user: u });
  assert.equal(list.json.devices.length, 1);
  assert.ok(!JSON.stringify(list.json).includes('installKey'), 'install key hash is never returned');
  const other = await call('POST', '/api/desktop/devices/register', { user: freshUser(), body: { platform: 'android', installKey: key } });
  assert.notEqual(other.json.deviceId, first.json.deviceId, 'another user never inherits the device');
});

test('aggregateDevices: groups duplicate sessions on same device, exposes sessionCount and deviceIds', async () => {
  const { aggregateDevices } = await import('./desktop.routes');
  const d1 = { deviceId: 'dev-1', label: 'Chrome Web', platform: 'windows', createdAt: 100, lastSeenAt: 200 };
  const d2 = { deviceId: 'dev-2', label: 'Chrome Web', platform: 'windows', createdAt: 150, lastSeenAt: 300 };
  const d3 = { deviceId: 'dev-3', label: 'Chrome Web', platform: 'windows', createdAt: 180, lastSeenAt: 400 };
  const dOther = { deviceId: 'dev-phone', label: 'Pixel 8', platform: 'android', createdAt: 500, lastSeenAt: 500 };

  const aggregated = aggregateDevices([d1, d2, d3, dOther], 'dev-2');
  assert.equal(aggregated.length, 2);

  const webGroup = aggregated.find((d: any) => d.platform === 'windows');
  assert.ok(webGroup);
  assert.equal(webGroup.sessionCount, 3);
  assert.equal(webGroup.current, true);
  assert.equal(webGroup.deviceId, 'dev-2', 'picks current device as primary');
  assert.deepEqual(webGroup.deviceIds, ['dev-1', 'dev-2', 'dev-3']);
  assert.equal(webGroup.lastSeenAt, 400);

  const phoneGroup = aggregated.find((d: any) => d.platform === 'android');
  assert.ok(phoneGroup);
  assert.equal(phoneGroup.sessionCount, 1);
  assert.equal(phoneGroup.current, false);
});
