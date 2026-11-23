'use strict';

// Port equality is weak evidence: only reattach recent, unique, same-owner
// system endpoints on a complete snapshot. Generic runtimes are not app names.
const REUSE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const GENERIC_OWNERS = new Set([
  'unknown', 'node', 'nodejs', 'python', 'python2', 'python3',
  'bun', 'deno', 'java', 'ruby', 'perl', 'php', 'sh', 'bash', 'zsh',
  'fish', 'dash', 'npx', 'npm', 'pnpm', 'yarn', 'docker-proxy',
  'containerd', 'systemd', 'sudo', 'sleep', 'busybox',
]);

function specificOwner(value) {
  if (typeof value !== 'string') return false;
  const name = value.trim().toLowerCase();
  if (name.length < 3 || name.length > 120 || GENERIC_OWNERS.has(name) ||
      /^python[0-9.]*$/.test(name) || /^node[0-9.]*$/.test(name)) return false;
  return /^[a-z0-9][a-z0-9_. :+-]*$/.test(name);
}

function endpointKey(item) {
  return [item.hostIp, item.hostPort, item.protocol, item.internal].join('|');
}

function createEndpointReconciler(db) {
  const matching = db.prepare(
    'SELECT DISTINCT s.id, s.display_name, s.identity_key, s.logical_identity_key, ' +
    's.last_seen_at, s.status FROM registry_services s ' +
    'JOIN registry_endpoints e ON e.service_id = s.id ' +
    'WHERE s.server_id = ? AND s.source = ? AND ' +
    'e.host_ip = ? AND e.host_port = ? AND e.protocol = ? AND ' +
    'e.internal = ? AND e.source = ? AND s.last_seen_at <= ? ' +
    'ORDER BY s.last_seen_at DESC, s.id LIMIT 4'
  );
  function candidates(item, at) {
    return matching.all(item.serverId, item.source, item.hostIp, item.hostPort,
      item.protocol, item.internal, item.source, at);
  }
  const compatible = (old, item, at) =>
    old.display_name === item.owner && specificOwner(item.owner) &&
    at >= old.last_seen_at && at - old.last_seen_at <= REUSE_WINDOW_MS &&
    (!item.logicalKey || !old.logical_identity_key ||
      old.logical_identity_key === item.logicalKey);

  function findReusable(item, at, currentProcessKeys, endpointCounts) {
    if (item.source !== 'system' || !specificOwner(item.owner) ||
        endpointCounts.get(endpointKey(item)) !== 1) return null;
    const matches = candidates(item, at);
    if (matches.length !== 1) return null;
    const old = matches[0];
    if (!compatible(old, item, at)) return null;
    // A process still present in this exact snapshot must not be collapsed
    // with a second process that happens to use an identical endpoint.
    if (old.identity_key && currentProcessKeys.has(old.identity_key)) return null;
    return old;
  }

  const current = db.prepare(
    'SELECT DISTINCT s.id, s.server_id, s.source, s.display_name AS owner, ' +
    's.logical_identity_key AS logical_key, e.host_ip, e.host_port, ' +
    'e.protocol, e.internal FROM registry_services s ' +
    'JOIN registry_endpoints e ON e.service_id = s.id ' +
    "WHERE s.server_id = ? AND s.source = 'system' " +
    "AND s.status = 'listening' AND s.last_seen_at = ? AND e.last_seen_at = ? " +
    'AND e.source = s.source'
  );
  // Consolidate one preexisting offline counterpart of a known current
  // listener. Never collapse an ambiguous chain of reused port owners.
  function coalesceCurrent(serverId, at, mergeServices) {
    let count = 0;
    const handled = new Set();
    for (const item of current.all(serverId, at, at)) {
      if (handled.has(item.id) || !specificOwner(item.owner)) continue;
      const matches = candidates({
        serverId, source: 'system', hostIp: item.host_ip,
        hostPort: item.host_port, protocol: item.protocol, internal: item.internal,
      }, at);
      if (matches.length !== 2) continue;
      const old = matches.find(row => row.id !== item.id && row.status === 'offline');
      if (!old || !compatible(old, {
        owner: item.owner, logicalKey: item.logical_key,
      }, at)) continue;
      // The earlier row is the stable target: its pin, recovery and appearance
      // persist, while the current process aliases and endpoint move to it.
      try {
        if (mergeServices(old.id, item.id, at)) {
          handled.add(item.id);
          count++;
        }
      } catch (error) {
        if (error.code !== 'merge_conflict') throw error;
        // Two separately annotated entries need explicit user resolution.
      }
    }
    return count;
  }

  return { findReusable, coalesceCurrent };
}

module.exports = { createEndpointReconciler, specificOwner, endpointKey };
