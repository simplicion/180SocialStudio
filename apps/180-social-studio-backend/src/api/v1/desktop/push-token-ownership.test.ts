/**
 * Run: npx tsx --test --test-force-exit apps/backend/src/api/v1/desktop/push-token-ownership.test.ts
 * A push token belongs to exactly one device record; revoking a device drops its push token.
 * Redis is pointed at a closed port so the registry uses process memory (NODE_ENV=test).
 */
process.env.NODE_ENV = 'test';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
process.env.DESKTOP_DEVICE_JWT_SECRET = 'unit-test-secret-unit-test-secret-1234';

import test, { before } from 'node:test';
import assert from 'node:assert/strict';

let d: typeof import('./desktop-device');
before(async () => {
  d = await import('./desktop-device');
});

let seq = 0;
const pushToken = () => `fcm-${'x'.repeat(40)}-${Date.now()}-${seq++}`;
const pushOf = async (companyId: string, userId: string, deviceId: string) =>
  (await d.listDevices(companyId, userId)).find((x) => x.deviceId === deviceId)?.push;

test("registering a push token already attached to another user's device detaches it there", async () => {
  const token = pushToken();
  const a = await d.registerDevice({ companyId: 'co-a', userId: 'alice', platform: 'android' });
  await d.setDevicePushToken({ companyId: 'co-a', userId: 'alice', deviceId: a.deviceId, provider: 'fcm', token });
  assert.equal((await pushOf('co-a', 'alice', a.deviceId))?.token, token);

  // Same phone, another user (even another company) signs in and registers.
  const b = await d.registerDevice({ companyId: 'co-b', userId: 'bob', platform: 'android' });
  await d.setDevicePushToken({ companyId: 'co-b', userId: 'bob', deviceId: b.deviceId, provider: 'fcm', token });
  assert.equal(await pushOf('co-a', 'alice', a.deviceId), undefined, "alice's device no longer holds the token");
  assert.equal((await pushOf('co-b', 'bob', b.deviceId))?.token, token);
  assert.ok((await d.listDevices('co-a', 'alice')).some((x) => x.deviceId === a.deviceId), 'the device itself is kept');
});

test('a device replacing its own token does not touch other devices; the old token is released', async () => {
  const t1 = pushToken();
  const t2 = pushToken();
  const a = await d.registerDevice({ companyId: 'co-a', userId: 'carol', platform: 'ios' });
  await d.setDevicePushToken({ companyId: 'co-a', userId: 'carol', deviceId: a.deviceId, provider: 'apns', token: t1 });
  await d.setDevicePushToken({ companyId: 'co-a', userId: 'carol', deviceId: a.deviceId, provider: 'apns', token: t2 });
  // t1 now claimed by someone else must not affect carol's current (t2) registration.
  const b = await d.registerDevice({ companyId: 'co-a', userId: 'dave', platform: 'ios' });
  await d.setDevicePushToken({ companyId: 'co-a', userId: 'dave', deviceId: b.deviceId, provider: 'apns', token: t1 });
  assert.equal((await pushOf('co-a', 'carol', a.deviceId))?.token, t2);
});

test('revoking a device releases its push token; clearDevicePushOnLogout clears it', async () => {
  const token = pushToken();
  const a = await d.registerDevice({ companyId: 'co-a', userId: 'erin', platform: 'android' });
  await d.setDevicePushToken({ companyId: 'co-a', userId: 'erin', deviceId: a.deviceId, provider: 'fcm', token });
  assert.equal(await d.revokeDevice('co-a', 'erin', a.deviceId), true);

  // Re-registering the token elsewhere after the revoke works and nothing points back at the revoked device.
  const b = await d.registerDevice({ companyId: 'co-a', userId: 'erin', platform: 'android' });
  await d.setDevicePushToken({ companyId: 'co-a', userId: 'erin', deviceId: b.deviceId, provider: 'fcm', token });
  assert.equal(await d.clearDevicePushOnLogout({ companyId: 'co-a', userId: 'erin', deviceId: b.deviceId }), true);
  assert.equal(await pushOf('co-a', 'erin', b.deviceId), undefined);
  assert.equal(await d.clearDevicePushOnLogout({ companyId: 'co-a', userId: 'erin', deviceId: 'unknown' }), false);
});
