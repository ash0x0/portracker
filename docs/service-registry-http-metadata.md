# HTTP title and favicon enrichment (issue #6)

This feature adds optional, **backend-side** capture of the HTTP root document's
real `<title>` and a small same-origin favicon for previously discovered TCP
services. Unlike recognized dashboard logos, these values come from the local
service's own HTTP response and survive its shutdown in SQLite.

## Default-on HTTP metadata (Phase D / issue #39)

**Enabled by default** when the saved registry is enabled. `SERVICE_REGISTRY_HTTP_ENABLED=false`
turns probing off explicitly. Each observed *likely-HTTP* local port is
probed conservatively; there are no browser credentials or arbitrary URLs.

Native Linux uses `127.0.0.1`. Inside a Docker bridge, the backend reads
`/proc/net/route`, selects a valid **private numeric** IPv4 default gateway
(without DNS, hard-coded `172.17.0.1` guesses, or falling back to
container loopback), and only probes the host through that gateway. If the
route is missing, ambiguous, public or otherwise untrusted, metadata enrichment
is **unavailable** and TCP discovery continues normally. A host firewall or a
service bound *only* to `127.0.0.1` can still block container-to-host access;
Portracker does **not** disable the firewall or broaden the target's binding.

The fork's Compose now defaults to:

```env
SERVICE_REGISTRY_ENABLED=true
SERVICE_REGISTRY_HTTP_ENABLED=true
# Optional explicit private numeric IP for special networking:
# SERVICE_REGISTRY_HTTP_HOST=172.18.0.1
```

The default automatic gateway detection can be overridden by an explicit
private literal via `SERVICE_REGISTRY_HTTP_HOST`. A public IP, link-local
cloud metadata IP, hostname or IPv6 zone ID is rejected. Invalid configuration
never crashes the app: the registry runs without HTTP enrichment and surfaces
a sanitized reason in **History / Pinned → Discovery capabilities**.

The status API `GET /api/service-registry/scan-status` now reports
`capabilities.http`: `requested`, `configured` (safe target selected),
`available` (confirmed successful probe; null until a probe is attempted),
host `mode` (without exposing the IP), safe `reason`, and last attempt/
success and failure categories. Having a private route is **not** proof the
host webserver can be reached.

The scanner examines a bounded number of recently observed listening TCP
endpoints after each successful scan and retries failures after five minutes;
successful metadata is refreshed no more than once per day. The root document
can be a Next.js/Vite static HTML page, but this is **not a browser scraper**:
it cannot recover current browser tab titles, client-side SPA route titles,
login state, arbitrary deep paths, or JavaScript-rendered metadata.

## Network and storage security

- All targets originate from the existing *local* observed listener registry,
  not a user-provided URL, remote peer or browser input.
- Requests use numeric IP literals; DNS rebinding and unrestricted redirects
  are not possible. At most two **same-origin** HTTP redirects are followed.
- There are no cookies, authentication headers, network proxies, JavaScript,
  cross-origin favicon downloads, remote screenshots, or shell commands.
- HTTPS certificate verification remains enabled. Self-signed local TLS
  certificates fail conservatively; no global TLS bypass is enabled.
- HTML is limited to **256 KiB** and images to **128 KiB**, with short request
  timeouts, a four-target-per-cycle quota and two concurrent probes.
- HTML titles are sanitized and truncated; no HTML is rendered as trusted
  markup. Favicons are checked for common raster formats, and **SVG is
  never cached or served**.
- Icon bytes are content-addressed by SHA-256 and cached in SQLite, capped at
  128 distinct images. Only unreferenced icons are evicted; existing service
  history and referenced images are not silently discarded.
- Cached icons are served from a same-origin route with authentication,
  `X-Content-Type-Options: nosniff`, and a restricted response CSP.
- Probe errors are represented as non-sensitive categories and **never**
  overwrite last-known good metadata or change TCP listening status.

If an app uses a non-web listener or requires HTTP authentication, Portracker
retains the TCP history but may have no usable title or favicon. If a root
document redirects to a different origin, that request is blocked. Traditional
Homarr/selfhst icons can still be used as product-name-based fallbacks.

## API

- `GET /api/service-registry` and `/:id`: add `httpTitle`,
  `httpRootUrl`, `iconHash`, `metadataFetchedAt` when captured.
- `GET /api/service-registry/icons/:hash`: immutable cached raster icon
  content, behind existing Portracker authentication.

The `httpRootUrl` is the **backend-probed** URL; for bridge-mode Docker or
remote browser access it may only be reachable from the Portracker host.
It is shown as observed context, not as a guarantee of user-device access.

## Validation

The branch includes local HTTP fixtures for HTML titles, relative icons,
same-origin redirects, external-icon blocking, malicious redirects, MIME
confusion, oversized responses and real TCP behavior; SQLite persistence,
failure retries and favicon caching are covered by Jest and full native
AMD64/ARM64 GitHub Actions.
