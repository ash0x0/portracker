import assert from 'node:assert/strict';
import test from 'node:test';
import { compareLocalInventory, endpointLabel } from './registry-inventory.mjs';

const NOW = 1730000090000;
const live = rows => ({ ok: true, data: rows, scannedAt: NOW - 1000 });
const saved = rows => ({ items: rows, truncated: false });
const scan = (system = 'complete', docker = 'complete') => ({
  enabled: true, intervalMs: 30000,
  sources: [
    { source: 'system', outcome: system, lastSuccessAt: NOW - 2000 },
    { source: 'docker', outcome: docker, lastSuccessAt: NOW - 2000 },
  ],
});
const ep = (source, host_ip, host_port, extra = {}) => ({
  source, host_ip, host_port, protocol: 'tcp', ...extra,
});
const row = (source, hostIp, hostPort, extra = {}) => ({
  source, hostIp, hostPort, protocol: 'tcp', ...extra,
});

test('compares source-owned endpoints, not logical service cards or list lengths', () => {
  const current = live([
    ep('system', '127.0.0.1', 4100), ep('system', '127.0.0.1', 4101),
    ep('docker', '0.0.0.0', 8080), ep('system', '0.0.0.0', 8080),
  ]);
  const registry = saved([
    row('system', '127.0.0.1', 4100), row('system', '127.0.0.1', 4101),
    row('docker', '0.0.0.0', 8080), row('system', '0.0.0.0', 8080),
  ]);
  const result = compareLocalInventory({ live: current, targets: registry, scan: scan(), now: NOW });
  assert.equal(result.state, 'complete');
  assert.equal(result.matched, 4);
  assert.equal(result.liveOnly.length, 0);
  assert.equal(result.savedOnly.length, 0);
  assert.deepEqual(result.counts, [
    { source: 'system', live: 3, saved: 3 },
    { source: 'docker', live: 1, saved: 1 },
  ]);
});

test('skips UDP, internal sockets, unsupported collectors and duplicate endpoints', () => {
  const current = live([
    ep('system', '127.0.0.1', 80), ep('system', '127.0.0.1', 80),
    ep('docker', '0.0.0.0', 9000, { internal: true }),
    ep('system', '127.0.0.1', 53, { protocol: 'udp' }),
    ep('truenas', '127.0.0.1', 3000),
  ]);
  const result = compareLocalInventory({
    live: current, targets: saved([row('system', '127.0.0.1', 80)]),
    scan: scan(), now: NOW,
  });
  assert.equal(result.matched, 1);
  assert.equal(result.liveOnly.length, 0);
  assert.equal(result.savedOnly.length, 0);
});

test('keeps IPv6 and differing bind addresses distinct', () => {
  const result = compareLocalInventory({
    live: live([ep('system', '::1', 3000), ep('system', '0.0.0.0', 5000)]),
    targets: saved([row('system', '[::1]', 3000), row('system', '127.0.0.1', 5000)]),
    scan: scan(), now: NOW,
  });
  assert.equal(result.matched, 1);
  assert.equal(result.liveOnly.length, 1);
  assert.equal(result.savedOnly.length, 1);
  assert.equal(endpointLabel(result.savedOnly[0]), 'system 127.0.0.1:5000/tcp');
});

test('a recycled port can match as an endpoint, never as proven service identity', () => {
  const result = compareLocalInventory({
    live: live([ep('system', '127.0.0.1', 4177, { owner: 'python' })]),
    targets: saved([row('system', '127.0.0.1', 4177, { id: 'different-service' })]),
    scan: scan(), now: NOW,
  });
  assert.equal(result.matched, 1);
  assert.equal(result.state, 'complete');
});

test('partial Docker collection excludes Docker instead of claiming discrepancies', () => {
  const result = compareLocalInventory({
    live: live([ep('system', '127.0.0.1', 80), ep('docker', '0.0.0.0', 8000)]),
    targets: saved([row('system', '127.0.0.1', 80)]),
    scan: scan('complete', 'failed'), now: NOW,
  });
  assert.equal(result.state, 'partial');
  assert.equal(result.matched, 1);
  assert.equal(result.liveOnly.length, 0);
  assert.deepEqual(result.coverage.filter(s => !s.eligible).map(s => s.source), ['docker']);
});

test('no authorized comparison for disabled, stale, restarted or truncated inventories', () => {
  const args = { live: live([ep('system', '127.0.0.1', 80)]),
    targets: saved([]), now: NOW };
  assert.equal(compareLocalInventory({ ...args,
    scan: { ...scan(), enabled: false } }).state, 'unavailable');
  assert.equal(compareLocalInventory({ ...args,
    scan: scan('partial', 'failed') }).state, 'unavailable');
  assert.equal(compareLocalInventory({ ...args, targets: { items: [], truncated: true },
    scan: scan() }).state, 'unavailable');
  assert.equal(compareLocalInventory({ ...args, scan: { ...scan(),
    sources: [{ source: 'system', outcome: 'complete', lastSuccessAt: NOW - 200000 }] },
  }).state, 'unavailable');
  assert.equal(compareLocalInventory({ ...args, live: { ok: false, data: [] },
    scan: scan() }).state, 'unavailable');
});

test('older local samples invalidate freshness even when source scans are current', () => {
  const result = compareLocalInventory({
    live: { ok: true, scannedAt: NOW - 400000, data: [ep('system', '127.0.0.1', 80)] },
    targets: saved([row('system', '127.0.0.1', 80)]),
    scan: scan(), now: NOW,
  });
  assert.equal(result.state, 'unavailable');
});
