import test from "node:test";
import assert from "node:assert/strict";
import { localPortUrl } from "./local-port-url.mjs";

test("opens only valid published TCP localhost ports", () => {
  assert.equal(localPortUrl(3000), "http://localhost:3000/");
  assert.equal(localPortUrl("65535"), "http://localhost:65535/");
  for (const invalid of [null, "", 0, 65536, -1, "1.5", "3000/path", "0x50", " 8080 "]) {
    assert.equal(localPortUrl(invalid), null);
  }
  assert.equal(localPortUrl(3000, { protocol: "udp" }), null);
  assert.equal(localPortUrl(3000, { internal: true }), null);
});
test("only trusts localhost metadata for an exact matching HTTPS scheme", () => {
  assert.equal(localPortUrl(443, { httpRootUrl: "https://127.0.0.1/" }), "https://localhost:443/");
  assert.equal(localPortUrl(3000, { httpRootUrl: "https://localhost:3000/other" }), "https://localhost:3000/");
  for (const root of [
    "https://attacker.example:3000/", "javascript:alert(1)",
    "https://localhost:3001/", "https://user:pass@localhost:3000/",
    "https://localhost.evil.example:3000/", "not a URL",
  ]) {
    assert.equal(localPortUrl(3000, { httpRootUrl: root }), "http://localhost:3000/");
  }
});
