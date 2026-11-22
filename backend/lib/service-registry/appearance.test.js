'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { describe, expect, test } = require('@jest/globals');
const { createServiceRegistry } = require('./registry');
const { createDockerProvenanceStore } = require('./docker-provenance-store');
const { validateNamePatch } = require('./appearance');

const native = (pid, host_port = 4177, owner = 'python3') => ({
  host_ip: '127.0.0.1', host_port, protocol: 'tcp', source: 'system', pid, owner,
});
const docker = (id, port) => ({
  host_ip: '127.0.0.1', host_port: port, protocol: 'tcp',
  source: 'docker', container_id: id.repeat(12), owner: id,
});
function fixture(run) {
  const db = new Database(':memory:');
  try { return run(db, createServiceRegistry(db)); }
  finally { db.close(); }
}
function dockerEvidence(store, service, label, daemon = 'd'.repeat(64), project = 'my-stack') {
  store.record(service.id, {
    containerId: label.repeat(64), containerName: label, image: 'nginx:stable',
    composeProject: project, composeService: label, hostFingerprint: daemon,
  }, Date.now());
}

describe('durable service and Compose presentation names (schema v11)', () => {
  test('additive upgrade from v10 and repeated migration preserve saved records', () =>
    fixture((db, registry) => {
      const service = registry.observe(native(101));
      registry.setPinned(service.id, true);
      db.exec('DROP TABLE registry_service_appearance; DROP TABLE registry_group_appearance; ' +
        'DELETE FROM registry_schema_versions WHERE version = 11');
      const migrated = createServiceRegistry(db);
      expect(migrated.getService(service.id)).toMatchObject({
        pinned: true, displayName: 'python3', detectedName: 'python3',
        customName: null, appearanceRevision: 0,
      });
      createServiceRegistry(db);
      expect(db.prepare('SELECT COUNT(*) AS count FROM registry_schema_versions').get().count)
        .toBe(11);
      expect(db.prepare('SELECT name FROM sqlite_master ' +
        "WHERE name = 'registry_service_appearance'").get()).toBeDefined();
    }));

  test('name is normalized; resets never erase optimistic revisions', () =>
    fixture((db, registry) => {
      const service = registry.observe(native(102));
      expect(registry.setServiceAppearance(service.id, { name: null, revision: 0 }))
        .toMatchObject({ displayName: 'python3', appearanceRevision: 0 });
      const edited = registry.setServiceAppearance(service.id, {
        name: '  Caf\u00e9 Dev ☕  ', revision: 0,
      });
      expect(edited).toMatchObject({
        displayName: 'Café Dev ☕', detectedName: 'python3',
        customName: 'Café Dev ☕', appearanceRevision: 1,
      });
      expect(edited.appearanceUpdatedAt).toEqual(expect.any(Number));
      expect(db.prepare('SELECT display_name FROM registry_services WHERE id = ?')
        .get(service.id).display_name).toBe('python3');
      const repeat = registry.setServiceAppearance(service.id, {
        name: 'Café Dev ☕', revision: 1,
      });
      expect(repeat.appearanceRevision).toBe(1);
      expect(repeat.appearanceUpdatedAt).toBe(edited.appearanceUpdatedAt);
      expect(() => registry.setServiceAppearance(service.id, {
        name: 'Other', revision: 0,
      })).toThrow('Appearance changed');
      const reset = registry.setServiceAppearance(service.id, { name: null, revision: 1 });
      expect(reset).toMatchObject({
        displayName: 'python3', customName: null, appearanceRevision: 2,
      });
      expect(() => registry.setServiceAppearance(service.id, {
        name: 'Stale edit', revision: 1,
      })).toThrow('Appearance changed');
    }));

  test('rejects blank, control, bidi, invalid surrogate, and overlong names', () => {
    for (const value of ['', ' \t ', 'first\nsecond', 'a\u0000b',
      'safe\u202eunsafe', '\u200eHidden', '\u061cHidden', 'a\u2028newline', '\u200bHidden', '\ud800',
      'a'.repeat(81)]) {
      expect(() => validateNamePatch({ name: value, revision: 0 }))
        .toThrow('Invalid appearance name');
    }
    for (const patch of [null, [], {}, { name: 'valid' },
      { name: 'valid', revision: -1 }, { name: 'valid', revision: 1.5 },
      { name: 1, revision: 0 }, { name: 'valid', revision: 0, injected: 'no' }]) {
      expect(() => validateNamePatch(patch)).toThrow(TypeError);
    }
    expect(validateNamePatch({ name: '😀'.repeat(80), revision: 0 }).name)
      .toBe('😀'.repeat(80));
  });

  test('history and pinned search use effective name with literal LIKE characters', () =>
    fixture((_db, registry) => {
      const a = registry.observe(native(111, 4181, 'node'));
      const b = registry.observe(native(222, 4182, 'node'));
      registry.setPinned(a.id, true);
      registry.setPinned(b.id, true);
      registry.setServiceAppearance(a.id, { name: 'Notes_% sandbox', revision: 0 });
      expect(registry.listServices({ search: 'Notes_%' }).items.map(s => s.id))
        .toEqual([a.id]);
      expect(registry.listServices({ search: '%' }).total).toBe(1);
      expect(registry.listServices({ search: '_' }).total).toBe(1);
      expect(registry.listServices({ search: 'node' }).total).toBe(1);
      expect(registry.listPinnedGroups({ search: 'Notes_%' }).serviceTotal).toBe(1);
      expect(registry.listPinnedGroups({ search: 'Notes_%' }).items[0].name)
        .toBe('Notes_% sandbox');
      expect(registry.listPinnedGroups({ portPrefix: '418', search: 'sandbox' }).total)
        .toBe(1);
      expect(registry.listPinnedGroups({ portPrefix: '42', search: 'sandbox' }).total)
        .toBe(0);
    }));

  test('service names persist through offline/restart but never transfer to port reuse', () =>
    fixture((_db, registry) => {
      const make = (pid, ticks, cwd = '/home/dev/site') => ({
        ...native(pid),
        process_start_ticks: ticks,
        provenance: { kind: 'session_scope', confidence: 'observed',
          uid: 1000, pid, startTicks: ticks, cwd, executablePath: '/usr/bin/python3' },
      });
      registry.reconcileSource({ source: 'system', rows: [make(100, '1')],
        complete: true, at: 1000 });
      const first = registry.listServices().items[0];
      registry.setServiceAppearance(first.id, { name: 'Development Site', revision: 0 });
      registry.setPinned(first.id, true, 1200);
      registry.reconcileSource({ source: 'system', rows: [], complete: true, at: 2000 });
      expect(registry.getService(first.id).displayName).toBe('Development Site');
      registry.reconcileSource({ source: 'system', rows: [make(200, '2')],
        complete: true, at: 3000 });
      expect(registry.listServices().total).toBe(1);
      expect(registry.getService(first.id).displayName).toBe('Development Site');
      registry.reconcileSource({ source: 'system', rows: [], complete: true, at: 4000 });
      registry.reconcileSource({ source: 'system', rows: [make(300, '3', '/other/app')],
        complete: true, at: 5000 });
      const different = registry.listServices().items.find(s => s.id !== first.id);
      expect(different).toMatchObject({ customName: null, detectedName: 'python3' });
      expect(registry.getService(first.id).customName).toBe('Development Site');
    }));

  test('unpin keeps name; forget deletes annotation instead of reassigning it', () =>
    fixture((db, registry) => {
      const service = registry.observe(native(123));
      registry.setPinned(service.id, true);
      registry.setServiceAppearance(service.id, { name: 'Remember me', revision: 0 });
      registry.setPinned(service.id, false);
      registry.setPinned(service.id, true);
      expect(registry.getService(service.id).displayName).toBe('Remember me');
      expect(registry.forgetService(service.id)).toBe(true);
      expect(db.prepare('SELECT * FROM registry_service_appearance WHERE service_id = ?')
        .get(service.id)).toBeUndefined();
      expect(registry.getService(service.id)).toBeNull();
    }));

  test('Compose parent and children have independent names and filtered search', () =>
    fixture((db, registry) => {
      const store = createDockerProvenanceStore(db);
      const a = registry.observe(docker('a', 4181));
      const b = registry.observe(docker('b', 5181));
      dockerEvidence(store, a, 'a');
      dockerEvidence(store, b, 'b');
      registry.setPinned(a.id, true);
      registry.setPinned(b.id, true);
      const group = registry.listPinnedGroups().items[0];
      expect(group.kind).toBe('compose');
      expect(group.detectedName).toBe('my-stack');
      expect(registry.setGroupAppearance(group.id, { name: 'My Workspace', revision: 0 }))
        .toMatchObject({ name: 'My Workspace', appearanceRevision: 1 });
      registry.setServiceAppearance(a.id, { name: 'API Sandbox', revision: 0 });
      const current = registry.listPinnedGroups().items[0];
      expect(current.name).toBe('My Workspace');
      expect(current.services.find(s => s.id === a.id).displayName).toBe('API Sandbox');
      expect(current.services.find(s => s.id === b.id).displayName).toBe('b');
      expect(registry.listPinnedGroups({ search: 'my workspace' }).serviceTotal).toBe(2);
      expect(registry.listPinnedGroups({ search: 'API Sandbox' }).serviceTotal).toBe(1);
      expect(registry.listPinnedGroups({ search: 'workspace', portPrefix: '41' }))
        .toMatchObject({ serviceTotal: 1, total: 1 });
      expect(registry.listPinnedGroups({ search: 'workspace', portPrefix: '41' })
        .items[0].services.map(s => s.id)).toEqual([a.id]);
      expect(registry.listPinnedGroups({ search: '_' }).total).toBe(0);
      expect(registry.setGroupAppearance(group.id, { name: null, revision: 1 }))
        .toMatchObject({ name: 'my-stack', customName: null, appearanceRevision: 2 });
      expect(registry.listPinnedGroups().items[0].name).toBe('my-stack');
    }));

  test('group overrides stay dormant across unpin/re-pin, not exposed to a new daemon', () =>
    fixture((db, registry) => {
      const store = createDockerProvenanceStore(db);
      const service = registry.observe(docker('c', 4188));
      dockerEvidence(store, service, 'c');
      registry.setPinned(service.id, true);
      const original = registry.listPinnedGroups().items[0];
      registry.setGroupAppearance(original.id, { name: 'Office stack', revision: 0 });
      registry.setPinned(service.id, false);
      expect(registry.listPinnedGroups().total).toBe(0);
      expect(registry.setGroupAppearance(original.id, {
        name: 'No pinned members', revision: 1,
      })).toBeNull();
      registry.setPinned(service.id, true);
      expect(registry.listPinnedGroups().items[0].name).toBe('Office stack');
      dockerEvidence(store, service, 'c', 'e'.repeat(64));
      const changed = registry.listPinnedGroups().items[0];
      expect(changed.id).not.toBe(original.id);
      expect(changed.name).toBe('my-stack');
      expect(registry.setGroupAppearance(original.id, {
        name: 'Old daemon', revision: 1,
      })).toBeNull();
    }));

  test('file-backed overrides survive reopen while detected name and notes remain intact', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-names-'));
    const file = path.join(dir, 'history.sqlite');
    try {
      const first = new Database(file);
      const registry = createServiceRegistry(first);
      const service = registry.observe(native(555));
      registry.setPinned(service.id, true);
      registry.setServiceAppearance(service.id, { name: 'Remembered Site', revision: 0 });
      first.close();

      const reopened = new Database(file);
      try {
        const again = createServiceRegistry(reopened);
        expect(again.getService(service.id)).toMatchObject({
          displayName: 'Remembered Site', detectedName: 'python3',
          customName: 'Remembered Site', appearanceRevision: 1, pinned: true,
        });
        expect(again.listPinnedGroups().items[0].name).toBe('Remembered Site');
        expect(reopened.prepare('SELECT display_name FROM registry_services WHERE id = ?')
          .get(service.id).display_name).toBe('python3');
      } finally { reopened.close(); }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
