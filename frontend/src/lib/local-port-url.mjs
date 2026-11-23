// Browser-side URLs must never use untrusted discovered hostnames or protocols.
// localhost deliberately refers to the browser's machine, not the Docker container.
export function localPortUrl(port, { protocol = "tcp", internal = false, httpRootUrl = null } = {}) {
  const raw = String(port ?? "");
  if (!/^[1-9][0-9]{0,4}$/.test(raw) || Number(raw) > 65535) return null;
  if (String(protocol).toLowerCase() !== "tcp" || internal) return null;
  let scheme = "http:";
  if (typeof httpRootUrl === "string") {
    try {
      const root = new URL(httpRootUrl);
      const rootPort = root.port || (root.protocol === "https:" ? "443" : "80");
      if (["http:", "https:"].includes(root.protocol) &&
          ["localhost", "127.0.0.1", "[::1]"].includes(root.hostname.toLowerCase()) &&
          !root.username && !root.password && Number(rootPort) === Number(raw)) {
        scheme = root.protocol;
      }
    } catch {
      // Metadata is optional and untrusted. Retain the safe HTTP fallback.
    }
  }
  return `${scheme}//localhost:${Number(raw)}/`;
}
