'use strict';

const { createHash } = require('node:crypto');

// Visual groups are NOT registry identities. Only explicit, verified Compose
// provenance can combine distinct durable service IDs into a parent row.
function composeGroupId(serverId, info) {
  if (info?.identity_confidence !== 'verified' ||
      !/^[a-f0-9]{64}$/.test(info.daemon_fingerprint || '') ||
      typeof info.compose_project !== 'string' || info.compose_project.length === 0) {
    return null;
  }
  return 'compose:' + createHash('sha256').update(
    JSON.stringify([serverId, info.daemon_fingerprint, info.compose_project])
  ).digest('hex').slice(0, 32);
}

function groupPinnedServices(services, endpoints, evidence) {
  const perService = new Map();
  for (const endpoint of endpoints) {
    if (!perService.has(endpoint.service_id)) perService.set(endpoint.service_id, []);
    perService.get(endpoint.service_id).push({
      id: endpoint.id, hostIp: endpoint.host_ip, hostPort: endpoint.host_port,
      protocol: endpoint.protocol, internal: Boolean(endpoint.internal),
      source: endpoint.source, lastSeenAt: endpoint.last_seen_at,
    });
  }
  const provenance = new Map(evidence.map(row => [row.service_id, row]));
  const groups = new Map();
  for (const service of services) {
    const info = provenance.get(service.id);
    const composeId = service.source === 'docker'
      ? composeGroupId(service.serverId, info) : null;
    const isVerified = Boolean(composeId);
    const id = composeId || 'service:' + service.id;
    if (!groups.has(id)) {
      groups.set(id, {
        id, name: isVerified ? info.compose_project : service.displayName,
        detectedName: isVerified ? info.compose_project : (service.detectedName || service.displayName),
        customName: isVerified ? null : (service.customName || null),
        iconChoice: isVerified ? { type: 'automatic' } : (service.iconChoice || { type: 'automatic' }),
        appearanceRevision: isVerified ? 0 : (service.appearanceRevision || 0),
        appearanceUpdatedAt: isVerified ? null : (service.appearanceUpdatedAt || null),
        kind: isVerified ? 'compose' : 'service',
        services: [], ports: [], status: 'listening',
        pinnedAt: 0, lastSeenAt: 0, iconHash: null,
      });
    }
    const group = groups.get(id);
    group.services.push({
      ...service, composeService: isVerified ? info.compose_service : null,
      endpoints: perService.get(service.id) || [],
    });
    group.pinnedAt = Math.max(group.pinnedAt, service.pinnedAt || 0);
    group.lastSeenAt = Math.max(group.lastSeenAt, service.lastSeenAt || 0);
    const rank = { offline: 0, unknown: 1, listening: 2 };
    if (rank[service.status] < rank[group.status]) group.status = service.status;
    if (!group.iconHash && service.iconHash) group.iconHash = service.iconHash;
  }
  for (const group of groups.values()) {
    const unique = new Map();
    for (const service of group.services) {
      for (const endpoint of service.endpoints) {
        const key = endpoint.protocol + ':' + endpoint.hostPort;
        if (!unique.has(key)) {
          unique.set(key, { port: endpoint.hostPort, protocol: endpoint.protocol,
            internal: endpoint.internal, active: false, serviceIds: [] });
        }
        const chip = unique.get(key);
        chip.internal = chip.internal && endpoint.internal;
        chip.active = chip.active || (service.status === 'listening' &&
          endpoint.lastSeenAt === service.lastSeenAt);
        if (!chip.serviceIds.includes(service.id)) chip.serviceIds.push(service.id);
      }
    }
    group.ports = [...unique.values()].sort((a, b) =>
      a.port - b.port || a.protocol.localeCompare(b.protocol));
    group.serviceCount = group.services.length;
    group.sources = [...new Set(group.services.flatMap(service =>
      service.sources || [service.source]))];
    group.services.sort((a, b) => (a.customName || a.composeService || a.displayName)
      .localeCompare(b.customName || b.composeService || b.displayName) ||
      a.id.localeCompare(b.id));
  }
  const rank = { offline: 0, unknown: 1, listening: 2 };
  return [...groups.values()].sort((a, b) =>
    rank[a.status] - rank[b.status] || b.pinnedAt - a.pinnedAt ||
    a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

module.exports = { groupPinnedServices, composeGroupId };
