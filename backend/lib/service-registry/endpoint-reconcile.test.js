'use strict';

const Database = require('better-sqlite3');
const { describe, test, expect } = require('@jest/globals');
const { createServiceRegistry } = require('./registry');
const { createRecoveryNotesStore } = require('./recovery-notes');

const port = (owner, pid, hostPort = 4096) => ({
  source: 'system', protocol: 'tcp', host_ip: '127.0.0.1',
  host_port: hostPort, owner, pid,
  boot_id: '01234567-89ab-cdef-0123-456789abcdef',
});
function fixture(testCase) {
  const db = new Database(':memory:');
  try { return testCase(db, createServiceRegistry(db)); }
  finally { db.close(); }
}

describe('same-port reboot reconciliation', () => {
  test('reattaches unique specific application after startup markStale and PID change', () =>
    fixture((db, registry) => {
      registry.reconcileSource({
        source: 'system', complete: true, at: 1000,
        rows: [port('opencode', 101)],
      });
      const id = registry.listServices().items[0].id;
      registry.setPinned(id, true, 1300);
      const notes = createRecoveryNotesStore(db);
      notes.saveNotes(id, 'opencode web --port 4096', 0);
      registry.markStale('local');
      registry.reconcileSource({
        source: 'system', complete: true, at: 2000,
        rows: [port('opencode', 202)],
      });
      expect(registry.listServices().total).toBe(1);
      expect(registry.getService(id)).toMatchObject({
        status: 'listening', pinned: true, firstSeenAt: 1000, runCount: 2,
      });
      expect(notes.get(id).text).toContain('opencode');
      expect(registry.listLivePinTargets().items).toHaveLength(1);
    }));

  test('consolidates already-duplicated online/offline entries at a complete scan', () =>
    fixture((_db, registry) => {
      registry.reconcileSource({
        source: 'system', complete: true, at: 1000, rows: [port('opencode', 101)],
      });
      const old = registry.listServices().items[0];
      registry.setPinned(old.id, true, 1400);
      // Partial scan must not assign an unverified restart identity.
      registry.reconcileSource({
        source: 'system', complete: false, at: 2000, rows: [port('opencode', 202)],
      });
      expect(registry.listServices().total).toBe(2);
      registry.reconcileSource({
        source: 'system', complete: true, at: 3000, rows: [port('opencode', 202)],
      });
      expect(registry.listServices().total).toBe(1);
      expect(registry.getService(old.id)).toMatchObject({ status: 'listening', pinned: true });
      expect(registry.getService(old.id).runCount).toBe(2);
    }));

  test('different owner and generic runtime do not merge solely because of port', () =>
    fixture((_db, registry) => {
      registry.reconcileSource({ source: 'system', complete: true,
        at: 1000, rows: [port('node', 101)] });
      registry.reconcileSource({ source: 'system', complete: true,
        at: 2000, rows: [port('node', 202)] });
      expect(registry.listServices().total).toBe(2);
      registry.reconcileSource({ source: 'system', complete: true,
        at: 3000, rows: [port('vscode', 303)] });
      expect(registry.listServices().total).toBe(3);
    }));

  test('two simultaneous listeners on an identical endpoint remain separate', () =>
    fixture((_db, registry) => {
      registry.reconcileSource({ source: 'system', complete: true, at: 1000,
        rows: [port('opencode', 101), port('opencode', 202)] });
      expect(registry.listServices().total).toBe(2);
      expect(registry.listServices({ status: 'listening' }).total).toBe(2);
    }));

  test('old same-port sightings outside the safe interval remain historical', () =>
    fixture((_db, registry) => {
      const week = 7 * 86400000;
      registry.reconcileSource({ source: 'system', complete: true, at: 1000,
        rows: [port('opencode', 101)] });
      registry.reconcileSource({ source: 'system', complete: true, at: 1000 + week + 1,
        rows: [port('opencode', 202)] });
      expect(registry.listServices().total).toBe(2);
    }));

  test('conflicting user annotations block automatic duplicate consolidation', () =>
    fixture((db, registry) => {
      registry.reconcileSource({ source: 'system', complete: true, at: 1000,
        rows: [port('opencode', 101)] });
      const oldId = registry.listServices().items[0].id;
      const notes = createRecoveryNotesStore(db);
      notes.saveNotes(oldId, 'manual old recovery', 0);
      registry.reconcileSource({ source: 'system', complete: false, at: 2000,
        rows: [port('opencode', 202)] });
      const currentId = registry.listServices().items.find(item => item.id !== oldId).id;
      notes.saveNotes(currentId, 'different recovery', 0);
      registry.reconcileSource({ source: 'system', complete: true, at: 3000,
        rows: [port('opencode', 202)] });
      expect(registry.listServices().total).toBe(2);
      expect(notes.get(oldId).text).toBe('manual old recovery');
      expect(notes.get(currentId).text).toBe('different recovery');
    }));

  test('no fallback on partial scans, even for a specific owner and exact port', () =>
    fixture((_db, registry) => {
      registry.reconcileSource({ source: 'system', complete: true, at: 1000,
        rows: [port('opencode', 101)] });
      registry.reconcileSource({ source: 'system', complete: false, at: 2000,
        rows: [port('opencode', 202)] });
      expect(registry.listServices().total).toBe(2);
      expect(registry.listServices({ status: 'offline' }).total).toBe(0);
    }));
});
