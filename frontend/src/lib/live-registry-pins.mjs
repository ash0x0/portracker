// Never infer a logical identity from a port number alone. The collector and
// registry must agree on source, binding, protocol and internal/published state.
function normalizeHost(value) {
  const raw = String(value ?? "").toLowerCase();
  return raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;
}

export function matchLivePinTarget(ports, targets, truncated = false) {
  if (truncated) return { target: null, reason: "Registry has more active endpoints than can be matched safely" };
  if (!Array.isArray(ports) || ports.length === 0) {
    return { target: null, reason: "No published TCP ports to pin" };
  }
  const matched = [];
  for (const port of ports) {
    if (!port || port.internal || String(port.protocol).toLowerCase() !== "tcp") {
      return { target: null, reason: "Only published TCP listeners can be pinned" };
    }
    const candidates = (targets || []).filter(item =>
      item && !item.internal &&
      item.source === port.source &&
      String(item.protocol).toLowerCase() === "tcp" &&
      Number(item.hostPort) === Number(port.host_port) &&
      normalizeHost(item.hostIp) === normalizeHost(port.host_ip)
    );
    const ids = new Set(candidates.map(item => item.id));
    if (ids.size !== 1) {
      return { target: null, reason: ids.size > 1
        ? "Several saved services share this endpoint; open History to choose"
        : "Not discovered in History yet; check registry discovery" };
    }
    matched.push(candidates[0]);
  }
  if (new Set(matched.map(item => item.id)).size !== 1) {
    return { target: null, reason: "Group contains multiple services; expand and pin each port individually" };
  }
  return { target: matched[0], reason: null };
}

/**
 * A read started before a pin mutation may finish after it. Keep the confirmed
 * mutation authoritative until a later registry response acknowledges it.
 */
export function reconcileLivePinSnapshot(snapshot, confirmedPins) {
  if (!snapshot || !Array.isArray(snapshot.items)) return snapshot;
  return {
    ...snapshot,
    items: snapshot.items.map(item => {
      if (!confirmedPins.has(item.id)) return item;
      const pinned = confirmedPins.get(item.id);
      if (item.pinned === pinned) {
        confirmedPins.delete(item.id);
        return item;
      }
      return { ...item, pinned };
    }),
  };
}
