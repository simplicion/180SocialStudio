/**
 * Run: npx tsx --test --test-force-exit packages/video-engine-runtime/src/tests/17-free-media-providers.test.ts
 *
 * Test suite for Free & Open-Source Media Providers:
 * - Openverse (WordPress Foundation)
 * - Wikimedia Commons
 * - Internet Archive (Archive.org)
 * - Jamendo & Unsplash (Key-gated)
 * - License normalization (CC0, PD, CC-BY, CC-BY-SA) and non-commercial rejection
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeLicense,
  FreeMediaQuery,
  FreeMediaItem,
} from '../tools/sourcing/free-media-providers';

test('normalizeLicense: accepts commercial CC0 and Public Domain', () => {
  const cc0 = normalizeLicense('cc0');
  assert.ok(cc0);
  assert.equal(cc0.licenseClass, 'cc0');
  assert.equal(cc0.creditRequired, false);

  const pd = normalizeLicense('publicdomain');
  assert.ok(pd);
  assert.equal(pd.licenseClass, 'pd');
  assert.equal(pd.creditRequired, false);
});

test('normalizeLicense: rejects non-commercial (NC) and no-derivatives (ND)', () => {
  assert.equal(normalizeLicense('by-nc'), null);
  assert.equal(normalizeLicense('by-nc-sa'), null);
  assert.equal(normalizeLicense('by-nd'), null);
  assert.equal(normalizeLicense('cc-by-nc-4.0'), null);
  assert.equal(normalizeLicense('noncommercial'), null);
});

test('normalizeLicense: accepts CC-BY and CC-BY-SA with credit requirement', () => {
  const by = normalizeLicense('by', '4.0');
  assert.ok(by);
  assert.equal(by.licenseClass, 'cc-by');
  assert.equal(by.creditRequired, true);

  const bySa = normalizeLicense('by-sa', '4.0');
  assert.ok(bySa);
  assert.equal(bySa.licenseClass, 'cc-by-sa');
  assert.equal(bySa.creditRequired, true);
});

test('normalizeLicense: rejects invalid or empty license codes', () => {
  assert.equal(normalizeLicense(''), null);
  assert.equal(normalizeLicense(null), null);
  assert.equal(normalizeLicense('all-rights-reserved'), null);
});
