'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { describe, test, expect } = require('@jest/globals');
const { createServiceRegistry } = require('./registry');
const { createRecoveryNotesStore } = require('./recovery-notes');
const { createAppearanceStore } = require('./appearance');

const socket = (port, pid, owner = 'opencode') => ({
  source: 'system', protocol: 'tcp', host_ip: '127.0.0.1',
  host_port: port, owner, pid, boot_id: '01234567-89ab-cdef-0123-456789abcdef',
});

describe('explicit manual service merge', () => {
  test('combines two live entries, endpoints, process aliases, history, and a pin', () => {
    const db = new Database(':memory:');
    try {
      const registry = createServiceRegistry(db);
      const first = registry.observe(socket(4096, 101), { at: 1000 });
      const second = registry.observe(socket(49374, 202), { at: 1100 });
      registry.setPinned(second.id, true, 1200);
      const notes = createRecoveryNotesStore(db);
      notes.saveNotes(second.id, 'Start OpenCode from the CLI', 0, 1300);
      const merged = registry.mergeServices(first.id, second.id, 1400);
      expect(merged.id).toBe(first.id);
      expect(merged.pinned).toBe(true);
      expect(merged.firstSeenAt).toBe(1000);
      expect(merged.endpoints.map(e => e.hostPort).sort()).toEqual([4096, 49374]);
      expect(merged.runCount).toBe(2);
      expect(notes.get(first.id).text).toContain('OpenCode');
      expect(registry.getService(second.id)).toBeNull();
      expect(registry.listServices().total).toBe(1);

      // Separate current PIDs from the original two episodes continue to map
      // to the canonical identity during authoritative scans.
      registry.reconcileSource({
        source: 'system', complete: true, at: 2000,
        rows: [socket(4096, 101), socket(49374, 202)],
      });
      expect(registry.listServices().total).toBe(1);
      expect(registry.getService(first.id).status).toBe('listening');
      expect(registry.listLivePinTargets().items.map(item => item.hostPort).sort())
        .toEqual([4096, 49374]);
    } finally { db.close(); }
  });

  test('rejects annotation conflicts without changing either service', () => {
    const db = new Database(':memory:');
    try {
      const registry = createServiceRegistry(db);
      const a = registry.observe(socket(4096, 101));
      const b = registry.observe(socket(49374, 202));
      const notes = createRecoveryNotesStore(db);
      notes.saveNotes(a.id, 'first', 0);
      notes.saveNotes(b.id, 'second', 0);
      expect(() => registry.mergeServices(a.id, b.id)).toThrow('different saved');
      expect(registry.listServices().total).toBe(2);
      expect(notes.get(a.id).text).toBe('first');
      expect(notes.get(b.id).text).toBe('second');
      expect(db.prepare('SELECT COUNT(*) AS n FROM registry_identity_aliases').get().n).toBe(0);
    } finally { db.close(); }
  });

  test('cannot merge across sources, servers, or with itself', () => {
    const db = new Database(':memory:');
    try {
      const registry = createServiceRegistry(db);
      const a = registry.observe(socket(4096, 101));
      const b = registry.observe({ ...socket(4096, 202), source: 'docker', container_id: 'abcd' });
      const c = registry.observe(socket(49374, 303), { serverId: 'remote' });
      expect(() => registry.mergeServices(a.id, b.id)).toThrow('same host');
      expect(() => registry.mergeServices(a.id, c.id)).toThrow('same host');
      expect(() => registry.mergeServices(a.id, a.id)).toThrow('Invalid merge');
      expect(registry.mergeServices(a.id, 'absent')).toBeNull();
      expect(registry.listServices().total).toBe(2);
    } finally { db.close(); }
  });

  test('aliases, notes, metadata and pins survive SQLite reopen', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portracker-merge-'));
    const file = path.join(dir, 'registry.sqlite');
    let targetId;
    try {
      const db = new Database(file);
      const registry = createServiceRegistry(db);
      const a = registry.observe(socket(4096, 101), { at: 1000 });
      const b = registry.observe(socket(49374, 202), { at: 1100 });
      targetId = a.id;
      registry.setPinned(b.id, true, 1200);
      const notes = createRecoveryNotesStore(db);
      notes.saveStart(b.id, 'opencode web --port 4096', '', 0);
      const appearance = createAppearanceStore(db);
      appearance.saveServiceAppearance(b.id, { name: 'OpenCode', revision: 0 });
      registry.mergeServices(a.id, b.id, 1300);
      db.close();

      const reopened = new Database(file);
      try {
        const resumed = createServiceRegistry(reopened);
        expect(resumed.getService(targetId)).toMatchObject({
          pinned: true, displayName: 'OpenCode', runCount: 2,
        });
        expect(createRecoveryNotesStore(reopened).getStart(targetId).command)
          .toContain('opencode web');
        expect(resumed.observe(socket(49374, 202), { at: 2000 }).id).toBe(targetId);
        expect(resumed.listServices().total).toBe(1);
      } finally { reopened.close(); }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
