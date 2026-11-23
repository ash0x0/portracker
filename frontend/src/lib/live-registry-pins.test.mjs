import test from "node:test";
import assert from "node:assert/strict";
import { matchLivePinTarget, reconcileLivePinSnapshot } from "./live-registry-pins.mjs";

const port = { source: "system", host_ip: "127.0.0.1", host_port: 4177, protocol: "tcp", internal: false };
const target = { id: "stable-a", pinned: false, source: "system", hostIp: "127.0.0.1", hostPort: 4177, protocol: "tcp", internal: false };
test("matches only an exact unique active saved identity", () => {
  assert.equal(matchLivePinTarget([port], [target]).target.id, "stable-a");
  for (const changes of [
    { source: "docker" }, { host_ip: "0.0.0.0" }, { host_port: 4178 },
    { protocol: "udp" }, { internal: true },
  ]) {
    assert.equal(matchLivePinTarget([{ ...port, ...changes }], [target]).target, null);
  }
});
test("rejects stale duplicates, distinct group children and incomplete responses", () => {
  assert.equal(matchLivePinTarget([port], [target, { ...target, id: "old-service" }]).target, null);
  assert.equal(matchLivePinTarget([port], [target], true).target, null);
  assert.equal(matchLivePinTarget([port, { ...port, host_port: 4178 }],
    [target, { ...target, id: "stable-b", hostPort: 4178 }]).target, null);
  assert.equal(matchLivePinTarget([port, { ...port, host_port: 4178 }], [target]).target, null);
  assert.equal(matchLivePinTarget([{ ...port, host_ip: "[::1]" }],
    [{ ...target, hostIp: "::1" }]).target?.id, "stable-a");
});

test("in-flight refresh cannot undo confirmed pin mutations", () => {
  const overrides = new Map([["stable-a", true]]);
  const staleResponse = { truncated: false, items: [{ ...target, pinned: false }] };
  assert.equal(reconcileLivePinSnapshot(staleResponse, overrides).items[0].pinned, true);
  assert.equal(overrides.get("stable-a"), true);
  const acknowledged = { ...staleResponse, items: [{ ...target, pinned: true }] };
  assert.equal(reconcileLivePinSnapshot(acknowledged, overrides).items[0].pinned, true);
  assert.equal(overrides.size, 0);
});
