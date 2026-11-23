'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const express = require('express');
const { describe, test, expect } = require('@jest/globals');
const { createServiceRegistry } = require('./registry');
const { createCustomIconStore, validateImage, MAX_BLOBS, MAX_BYTES } = require('./custom-icons');
const { createHttpMetadataStore } = require('./http-store');
const { createDockerProvenanceStore } = require('./docker-provenance-store');
const { createRegistryRouter } = require('../../routes/service-registry');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64'
);
const WEBP = Buffer.from(
  'UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoQABAAAUAmJaACdLoB+AADsAD+645f/PzO7cX9Vv/wpr4U18Ka/4QIAAA=', 'base64'
);
const ICO = Buffer.from(
  'AAABAAEAEBAAAAAAIABWAAAAFgAAAIlQTkcNChoKAAAADUlIRFIAAAAQAAAAEAgGAAAAH/P/YQAAAB1JREFUeJxj/GIm8p+BAsBEieZRA0YNGDVgMBkAAFfPAl0/pwDhAAAAAElFTkSuQmCC', 'base64'
);
const JPEG = Buffer.from([
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkS',
  'Ew8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJ',
  'CQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy',
  'MjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAA',
  'AAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAA',
  'AAAABAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCQgKQD/9k=',
].join(''), 'base64');
const observe = (registry, pid, port = 3000) => registry.observe({
  source: 'system', owner: 'node', pid,
  host_ip: '127.0.0.1', host_port: port, protocol: 'tcp',
});
const choice = hash => ({ type: 'upload', hash });

function fixture(run) {
  const db = new Database(':memory:');
  try {
    const registry = createServiceRegistry(db);
    const icons = createCustomIconStore(db);
    return run({ db, registry, icons });
  } finally { db.close(); }
}
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function variantPng(i, extraLength = 7) {
  const type = Buffer.from('tIME');
  const data = Buffer.alloc(extraLength);
  data.writeUInt32BE(i >>> 0, 0);
  const chunk = Buffer.alloc(12 + extraLength);
  chunk.writeUInt32BE(extraLength);
  type.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([type, data])), 8 + extraLength);
  return Buffer.concat([PNG.subarray(0, -12), chunk, PNG.subarray(-12)]);
}

describe('secure uploaded registry icons (schema v12)', () => {
  test('validates small PNG, JPEG, WebP and ICO; deduplicates exact bytes', () =>
    fixture(({ db, icons }) => {
      expect(db.prepare('SELECT MAX(version) AS n FROM registry_schema_versions').get().n).toBe(13);
      for (const [bytes, mime] of [[PNG, 'image/png'], [JPEG, 'image/jpeg'],
        [WEBP, 'image/webp'], [ICO, 'image/vnd.microsoft.icon']]) {
        expect(validateImage(bytes, mime)).toBe(
          mime === 'image/vnd.microsoft.icon' ? 'image/x-icon' : mime);
        const a = icons.save(bytes, mime);
        const b = icons.save(Buffer.from(bytes), mime);
        expect(a.hash).toBe(b.hash);
        expect(icons.get(a.hash).bytes.equals(bytes)).toBe(true);
      }
      expect(icons.stats().count).toBe(4);
      createServiceRegistry(db);
      expect(db.prepare('SELECT COUNT(*) AS n FROM registry_schema_versions').get().n).toBe(13);
    }));

  test('rejects spoofed MIME, SVG, HTML, truncation, corrupt PNG and unsupported content', () =>
    fixture(({ icons }) => {
      for (const [bytes, mime] of [
        [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/png'],
        [Buffer.from('<!doctype html>'), 'image/png'],
        [PNG, 'image/svg+xml'], [PNG, 'image/jpeg'],
        [PNG.subarray(0, PNG.length - 1), 'image/png'],
        [Buffer.concat([PNG, Buffer.from([1])]), 'image/png'],
        [Buffer.alloc(MAX_BYTES + 1), 'image/png'],
        [Buffer.from(WEBP.subarray(0, 20)), 'image/webp'],
        [Buffer.from(ICO.subarray(0, 20)), 'image/x-icon'],
      ]) {
        expect(() => icons.save(bytes, mime)).toThrow(TypeError);
      }
      const corrupt = Buffer.from(PNG);
      corrupt[40] ^= 0x01;
      expect(() => icons.save(corrupt, 'image/png')).toThrow(TypeError);
      const jpegExif = Buffer.concat([
        JPEG.subarray(0, 2), Buffer.from([0xff, 0xe1, 0x00, 0x08]),
        Buffer.from([0x45, 0x78, 0x69, 0x66, 0, 0]), JPEG.subarray(2),
      ]);
      expect(() => icons.save(jpegExif, 'image/jpeg')).toThrow(TypeError);
      expect(icons.get('bad')).toBeNull();
      expect(icons.stats().count).toBe(0);
    }));

  test('caps distinct uploads, but accepts identical content when full', () =>
    fixture(({ icons }) => {
      const initial = icons.save(PNG, 'image/png');
      for (let i = 0; i < MAX_BLOBS - 1; i++) {
        icons.save(variantPng(i), 'image/png');
      }
      expect(icons.stats().count).toBe(MAX_BLOBS);
      expect(icons.save(PNG, 'image/png').hash).toBe(initial.hash);
      expect(() => icons.save(variantPng(MAX_BLOBS + 1), 'image/png'))
        .toThrow('Custom icon storage is full');
    }));

  test('independent name/icon PATCHes share revisions; reset preserves HTTP favicon', () =>
    fixture(({ registry, icons, db }) => {
      const a = observe(registry, 100);
      const b = observe(registry, 200, 3001);
      const hash = icons.save(PNG, 'image/png').hash;
      const http = createHttpMetadataStore(db);
      const detected = http.recordSuccess(a.id, {
        title: 'Detected favicon', rootUrl: 'http://127.0.0.1:3000/',
        iconBytes: PNG, iconType: 'image/png',
      }, 1000).iconHash;
      const first = registry.setServiceAppearance(a.id, {
        name: 'My App', revision: 0,
      });
      expect(first).toMatchObject({
        displayName: 'My App', iconChoice: { type: 'automatic' }, appearanceRevision: 1,
      });
      const iconOnly = registry.setServiceAppearance(a.id, {
        icon: choice(hash), revision: 1,
      });
      expect(iconOnly).toMatchObject({
        displayName: 'My App', customName: 'My App',
        iconChoice: choice(hash), appearanceRevision: 2,
      });
      expect(registry.setServiceAppearance(b.id, { icon: choice(hash), revision: 0 })
        .iconChoice).toEqual(choice(hash));
      expect(() => registry.setServiceAppearance(a.id, {
        icon: { type: 'glyph', name: 'terminal' }, revision: 1,
      })).toThrow('Appearance changed');
      const glyph = registry.setServiceAppearance(a.id, {
        icon: { type: 'glyph', name: 'database' }, revision: 2,
      });
      expect(glyph).toMatchObject({
        displayName: 'My App', iconChoice: { type: 'glyph', name: 'database' },
        appearanceRevision: 3,
      });
      expect(icons.get(hash)).not.toBeNull(); // b still references it
      const reset = registry.setServiceAppearance(b.id, {
        icon: 'automatic', revision: 1,
      });
      expect(reset.iconChoice).toEqual({ type: 'automatic' });
      expect(icons.get(hash)).toBeNull(); // last reference was released
      expect(registry.setServiceAppearance(a.id, {
        icon: 'automatic', revision: 3,
      }).displayName).toBe('My App');
      expect(http.getMetadata(a.id).iconHash).toBe(detected);
      expect(registry.getService(a.id).detectedName).toBe('node');
    }));

  test('Compose parent overrides remain independent from child and sibling icons', () =>
    fixture(({ db, registry, icons }) => {
      const docker = createDockerProvenanceStore(db);
      const service = id => registry.observe({
        source: 'docker', owner: id, container_id: id.repeat(12),
        host_ip: '127.0.0.1', host_port: id === 'a' ? 4000 : 4001, protocol: 'tcp',
      });
      const a = service('a'), b = service('b');
      for (const s of [a, b]) {
        docker.record(s.id, {
          containerId: 'f'.repeat(64), containerName: 'compose-' + s.id,
          image: 'nginx:stable', hostFingerprint: 'a'.repeat(64),
          composeProject: 'demo', composeService: s.id,
        });
        registry.setPinned(s.id, true);
      }
      const hash = icons.save(PNG, 'image/png').hash;
      const group = registry.listPinnedGroups().items[0];
      expect(group.kind).toBe('compose');
      registry.setGroupAppearance(group.id, { icon: choice(hash), revision: 0 });
      registry.setServiceAppearance(a.id, {
        icon: { type: 'glyph', name: 'terminal' }, revision: 0,
      });
      const updated = registry.listPinnedGroups().items[0];
      expect(updated.iconChoice).toEqual(choice(hash));
      expect(updated.services.find(s => s.id === a.id).iconChoice)
        .toEqual({ type: 'glyph', name: 'terminal' });
      expect(updated.services.find(s => s.id === b.id).iconChoice)
        .toEqual({ type: 'automatic' });
      registry.setGroupAppearance(group.id, { icon: 'automatic', revision: 1 });
      expect(icons.get(hash)).toBeNull();
      registry.setPinned(a.id, false);
      registry.setPinned(a.id, true);
      expect(registry.getService(a.id).iconChoice.type).toBe('glyph');
    }));

  test('forget releases custom blobs and file reopen preserves surviving service icon', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-custom-icon-'));
    const filename = path.join(dir, 'history.sqlite');
    try {
      const db = new Database(filename);
      const registry = createServiceRegistry(db);
      const icons = createCustomIconStore(db);
      const a = observe(registry, 101), b = observe(registry, 102, 3002);
      const hash = icons.save(PNG, 'image/png').hash;
      registry.setServiceAppearance(a.id, { icon: choice(hash), revision: 0 });
      registry.setServiceAppearance(b.id, { icon: choice(hash), revision: 0 });
      registry.forgetService(a.id);
      expect(icons.get(hash)).not.toBeNull();
      db.close();
      const again = new Database(filename);
      try {
        const reopenedRegistry = createServiceRegistry(again);
        const reopenedIcons = createCustomIconStore(again);
        expect(reopenedRegistry.getService(b.id).iconChoice).toEqual(choice(hash));
        expect(reopenedIcons.get(hash).bytes.equals(PNG)).toBe(true);
        reopenedRegistry.forgetService(b.id);
        expect(reopenedIcons.get(hash)).toBeNull();
      } finally { again.close(); }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('invalid choices, unknown hashes and missing revisions never mutate annotations', () =>
    fixture(({ registry }) => {
      const s = observe(registry, 123);
      for (const icon of [
        { type: 'glyph', name: 'script' }, { type: 'upload', hash: 'bad' },
        { type: 'upload', hash: 'a'.repeat(64) }, { type: 'remote', url: 'http://a/' },
        { type: 'glyph', name: '<svg>' }, null,
      ]) {
        expect(() => registry.setServiceAppearance(s.id, { icon, revision: 0 })).toThrow();
      }
      expect(() => registry.setServiceAppearance(s.id, { revision: 0 })).toThrow();
      expect(() => registry.setServiceAppearance(s.id, { icon: 'automatic' })).toThrow();
      expect(registry.getService(s.id).appearanceRevision).toBe(0);
    }));
});

describe('custom icon HTTP authentication, validation and serving', () => {
  test('binary upload requires session and correct origin; local hash GET is protected', async () => {
    const db = new Database(':memory:');
    const registry = createServiceRegistry(db);
    const icons = createCustomIconStore(db);
    const old = process.env.ENABLE_AUTH;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      if (req.headers['x-test-session'] === 'yes') req.session = { userId: 'test' };
      next();
    });
    app.use('/api/service-registry', createRegistryRouter(registry, { customIconStore: icons }));
    const server = await new Promise(resolve =>
      { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    const url = 'http://127.0.0.1:' + server.address().port + '/api/service-registry';
    const send = (suffix, method, body, headers = {}) => fetch(url + suffix, { method, body,
      headers: { 'x-test-session': 'yes', ...headers } });
    try {
      process.env.ENABLE_AUTH = 'true';
      expect((await fetch(url + '/custom-icons', {
        method: 'POST', body: PNG, headers: { 'Content-Type': 'image/png' },
      })).status).toBe(401);
      expect((await send('/custom-icons', 'POST', PNG, {
        Origin: 'https://untrusted.test', 'Content-Type': 'image/png',
      })).status).toBe(403);
      const uploaded = await send('/custom-icons', 'POST', PNG, { 'Content-Type': 'image/png' });
      expect(uploaded.status).toBe(201);
      const { hash } = await uploaded.json();
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      expect((await send('/custom-icons', 'POST', PNG, {
        'Content-Type': 'image/jpeg',
      })).status).toBe(400);
      expect((await send('/custom-icons', 'POST', Buffer.alloc(MAX_BYTES + 1), {
        'Content-Type': 'image/png',
      })).status).toBe(413);
      expect((await fetch(url + '/custom-icons/' + hash)).status).toBe(401);
      const image = await send('/custom-icons/' + hash, 'GET');
      expect(image.status).toBe(200);
      expect(image.headers.get('x-content-type-options')).toBe('nosniff');
      expect(image.headers.get('cross-origin-resource-policy')).toBe('same-origin');
      expect(image.headers.get('content-type')).toContain('image/png');
      expect(Buffer.from(await image.arrayBuffer()).equals(PNG)).toBe(true);
      expect((await send('/custom-icons/' + 'f'.repeat(64), 'GET')).status).toBe(404);
      expect((await send('/custom-icons/not-hash', 'GET')).status).toBe(404);
      process.env.ENABLE_AUTH = 'false';
      expect((await send('/custom-icons', 'POST', PNG, {
        'Content-Type': 'image/png',
      })).status).toBe(403);
    } finally {
      await new Promise(resolve => server.close(resolve));
      db.close();
      if (old === undefined) delete process.env.ENABLE_AUTH;
      else process.env.ENABLE_AUTH = old;
    }
  });
});
