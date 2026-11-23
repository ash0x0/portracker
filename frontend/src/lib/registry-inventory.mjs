const SOURCES = ["system", "docker"];
const DEFAULT_INTERVAL_MS = 30000;

function normalizedEndpoint(row) {
  if (!row || row.internal || row.error) return null;
  const source = row.source;
  if (!SOURCES.includes(source)) return null;
  const protocol = String(row.protocol || "tcp").toLowerCase();
  if (protocol !== "tcp") return null;
  const port = Number(row.host_port ?? row.hostPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const rawHost = row.host_ip ?? row.hostIp;
  if (typeof rawHost !== "string" || !rawHost.trim()) return null;
  const hostIp = rawHost.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostIp || /\s/.test(hostIp)) return null;
  const key = JSON.stringify([source, hostIp === "*" ? "0.0.0.0" : hostIp, port, protocol]);
  return { source, hostIp, port, protocol, key };
}

function endpointMap(rows) {
  const result = new Map();
  for (const row of rows || []) {
    const endpoint = normalizedEndpoint(row);
    if (endpoint) result.set(endpoint.key, endpoint);
  }
  return result;
}

function eligibleSource(source, scan, liveAt, now) {
  if (!scan?.enabled) return { eligible: false, reason: "disabled" };
  const state = (scan.sources || []).find(item => item.source === source);
  if (!state) return { eligible: false, reason: "not scanned" };
  if (state.outcome !== "complete") {
    return { eligible: false, reason: state.outcome || "unknown" };
  }
  const interval = Number(scan.intervalMs) || DEFAULT_INTERVAL_MS;
  const freshness = Math.max(interval * 3, 90000);
  if (!Number.isFinite(state.lastSuccessAt) ||
      now - state.lastSuccessAt > freshness ||
      Math.abs(liveAt - state.lastSuccessAt) > freshness) {
    return { eligible: false, reason: "stale" };
  }
  return { eligible: true, reason: "complete" };
}

export function compareLocalInventory({ live, targets, scan, now = Date.now() }) {
  if (!live || !live.ok || !Array.isArray(live.data) ||
      !Number.isFinite(live.scannedAt)) {
    return { state: "unavailable", reason: "No successful local Live Ports snapshot yet" };
  }
  if (!targets || !Array.isArray(targets.items) || targets.truncated) {
    return { state: "unavailable", reason: targets?.truncated
      ? "Saved endpoint inventory exceeds the comparison limit"
      : "Saved endpoint inventory unavailable" };
  }
  if (!scan?.enabled) {
    return { state: "unavailable", reason: "History discovery is disabled" };
  }
  const coverage = SOURCES.map(source => ({
    source, ...eligibleSource(source, scan, live.scannedAt, now),
  }));
  const allowed = new Set(coverage.filter(item => item.eligible).map(item => item.source));
  if (!allowed.size) {
    return { state: "unavailable", reason: "No current complete registry source scans", coverage };
  }

  const liveMap = endpointMap(live.data);
  const savedMap = endpointMap(targets.items);
  const liveOnly = [];
  const savedOnly = [];
  let matched = 0;
  for (const [key, entry] of liveMap) {
    if (!allowed.has(entry.source)) continue;
    if (savedMap.has(key)) matched++;
    else liveOnly.push(entry);
  }
  for (const [key, entry] of savedMap) {
    if (allowed.has(entry.source) && !liveMap.has(key)) savedOnly.push(entry);
  }
  const count = source => ({
    source,
    live: [...liveMap.values()].filter(item => item.source === source).length,
    saved: [...savedMap.values()].filter(item => item.source === source).length,
  });
  return {
    state: allowed.size === SOURCES.length ? "complete" : "partial",
    matched, liveOnly, savedOnly, coverage,
    counts: SOURCES.filter(source => allowed.has(source)).map(count),
    liveAt: live.scannedAt,
  };
}

export function endpointLabel(endpoint) {
  const ip = endpoint.hostIp.includes(":") ? "[" + endpoint.hostIp + "]" : endpoint.hostIp;
  return endpoint.source + " " + ip + ":" + endpoint.port + "/" + endpoint.protocol;
}
