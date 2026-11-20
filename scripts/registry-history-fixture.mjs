import { registryRecoveryFixture, applyRegistryFixtureNote } from './registry-recovery-fixture.mjs';

function createRegistryRequestHandler(records, recoveryNotes, recoveryStarts) {
  return async route => {
    const req = route.request();
    const uri = new URL(req.url());
    const suffix = uri.pathname.replace('/api/service-registry', '');
    const json = (body, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
    if (suffix.startsWith('/icons/')) {
      return route.fulfill({
        status: 200, contentType: 'image/png',
        headers: { 'x-content-type-options': 'nosniff' },
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WkW3+IAAAAASUVORK5CYII=', 'base64'),
      });
    }
    if (suffix === '/scan-status') {
      return json({ enabled: true, sources: [
        { source: 'system', outcome: 'complete', lastSuccessAt: 1730000000000 },
        { source: 'docker', outcome: 'failed', lastSuccessAt: 1729990000000 },
      ] });
    }
    if (req.method() === 'PUT' && suffix.endsWith('/pin')) {
      const id = decodeURIComponent(suffix.slice(1, -4));
      const item = records.find(row => row.id === id);
      if (!item) return json({ error: 'Saved service not found' }, 404);
      const payload = req.postDataJSON();
      if (typeof payload?.pinned !== 'boolean') return json({ error: 'Invalid pin' }, 400);
      item.pinned = payload.pinned;
      item.pinnedAt = payload.pinned ? (item.pinnedAt ?? 1730000000000) : null;
      return json({ id, pinned: item.pinned, pinnedAt: item.pinnedAt });
    }
    if (req.method() === 'PUT' && suffix.endsWith('/recovery-notes')) {
      const result = applyRegistryFixtureNote(req, suffix, recoveryNotes);
      return json(result.body, result.status);
    }
    if (req.method() === 'PUT' && suffix.endsWith('/recovery-start')) {
      const id = suffix.slice(1).split('/')[0];
      const item = records.find(row => row.id === id);
      if (!item) return json({ error: 'Saved service not found' }, 404);
      const body = req.postDataJSON();
      const old = recoveryStarts.get(id) || { command: '', cwd: '', line: '', version: 0 };
      if (body.version !== old.version) return json({ error: 'Preferred command conflict' }, 409);
      if (typeof body.command !== 'string' || typeof body.cwd !== 'string' ||
          body.command.length > 2000 || body.cwd.length > 1024 ||
          /[\r\n]/.test(body.command)) return json({ error: 'Invalid command' }, 400);
      const line = body.cwd ? "cd -- '" + body.cwd + "' && " + body.command : body.command;
      const preferred = { command: body.command, cwd: body.cwd, line,
        version: old.version + 1, updatedAt: Date.now() };
      recoveryStarts.set(id, preferred);
      return json({ preferred });
    }
    if (suffix && suffix !== '/') {
      const id = decodeURIComponent(suffix.slice(1));
      const item = records.find(row => row.id === id);
      if (!item) return json({ error: 'Saved service not found' }, 404);
      if (req.method() === 'DELETE') {
        records.splice(records.indexOf(item), 1);
        return route.fulfill({ status: 204, body: '' });
      }
      return json({ ...item, recovery: { ...registryRecoveryFixture(id, recoveryNotes),
        preferred: recoveryStarts.get(id) || { command: '', cwd: '', line: '', version: 0 },
      },
        dockerProvenance: id === 'history-fixture-78' ? {
        composeProject: 'demo', composeService: 'web',
        containerName: 'demo-web-1', image: 'nginx:stable',
        networkMode: 'bridge', hostFingerprint: 'a'.repeat(64),
        projectWorkingDir: '/home/dev/demo',
        configFilePaths: ['/home/dev/demo/compose.yml'],
        pathScope: 'docker-host', identityConfidence: 'verified',
        capturedAt: 1730000000000,
      } : null, linuxProvenance: id === 'history-fixture-79' ? {
        kind: 'systemd_user_service', confidence: 'observed',
        unitName: 'dev.service', unitScope: 'user',
        pid: 777, uid: 1000, processStartTicks: '876543',
        cwd: '/home/dev/app', executablePath: '/nix/store/node/bin/node',
        capturedAt: 1730000000000,
      } : null, endpoints: [
        { id: 'endpoint-' + id, source: item.source, hostIp: item.previewHostIp,
          hostPort: item.previewPort, protocol: 'tcp', lastSeenAt: item.lastSeenAt },
      ] });
    }
    const filters = uri.searchParams;
    const search = (filters.get('search') || '').toLowerCase();
    const source = filters.get('source');
    const status = filters.get('status');
    const port = filters.get('port');
    const portPrefix = filters.get('portPrefix');
    const pinnedOnly = filters.get('pinnedOnly') === 'true';
    const since = Number(filters.get('seenSince') || 0);
    const matching = records.filter(row =>
      (!search || row.displayName.toLowerCase().includes(search)) &&
      (!source || row.source === source) &&
      (!status || row.status === status) &&
      (!port || row.previewPort === Number(port)) &&
      (!portPrefix || String(row.previewPort).startsWith(portPrefix)) &&
      (!pinnedOnly || row.pinned) &&
      (!since || row.lastSeenAt >= since)
    ).sort((a, b) => {
      if (pinnedOnly) {
        const rank = { offline: 0, unknown: 1, listening: 2 };
        return rank[a.status] - rank[b.status] ||
          (b.pinnedAt || 0) - (a.pinnedAt || 0) || b.lastSeenAt - a.lastSeenAt;
      }
      return b.lastSeenAt - a.lastSeenAt;
    });
    const offset = Number(filters.get('offset') || 0);
    const limit = Number(filters.get('limit') || 24);
    return json({ items: matching.slice(offset, offset + limit), total: matching.length, offset, limit });
  };

}

export function createRegistryHistoryFixture() {
  const records = Array.from({ length: 105 }, (_, index) => ({
    id: 'history-fixture-' + index,
    serverId: 'local',
    displayName: index === 104 ? 'example-unknown' : 'example-service-' + index,
    source: index % 3 === 0 ? 'docker' : 'system',
    identityConfidence: 'uncertain',
    firstSeenAt: 1730000000000,
    lastSeenAt: 1730000000000 + index * 60000,
    status: index === 104 ? 'unknown' : 'offline',
    pinned: false,
    pinnedAt: null,
    previewHostIp: '127.0.0.1',
    previewPort: 3000 + index,
    previewProtocol: 'tcp',
    endpointCount: 1,
    httpTitle: index === 79 ? 'Verified Local Root' : null,
    httpRootUrl: index === 79 ? 'http://127.0.0.1:3079/' : null,
    iconHash: index === 79 ? 'a'.repeat(64) : null,
    metadataFetchedAt: index === 79 ? 1730000000000 : null,
  }));
  const recoveryNotes = new Map();
  const recoveryStarts = new Map();
  recoveryStarts.set('history-fixture-78', {
    command: 'docker compose up -d web', cwd: '/home/dev/demo',
    line: "cd -- '/home/dev/demo' && docker compose up -d web", version: 1,
  });
  const urlPattern = '**/api/service-registry**';
  const handleRegistryRequest = createRegistryRequestHandler(records, recoveryNotes, recoveryStarts);
  return { records, urlPattern, handleRegistryRequest };
}
