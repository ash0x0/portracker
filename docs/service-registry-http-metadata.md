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
- HTML is limited to **256 KiB**, web manifests to **32 KiB** and raster
  icons to **128 KiB each**. At most five icon fetches and one manifest fetch
  follow the root request, within an eight-second total budget. Each request
  has its own timeout and at most two same-origin redirects. The worker scans
  at most four targets per cycle, with two concurrent probes.
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

## Expanded favicon discovery and dashboard help (issue #55)

The backend now tries the first valid same-origin raster icon from multiple
HTML `rel=icon` links, Apple touch icon links, one bounded JSON web manifest,
and common `/favicon.ico`, `/favicon.png`, `/apple-touch-icon.png` and
`/icon.png` paths. Supported extensionless `/api/favicon`-style filenames
must have verified raster magic bytes. Opaque or missing MIME is accepted
only with an allowlisted PNG/JPEG/GIF/WebP/ICO signature. SVG, HTML disguised
as images, MIME mismatches, public IPs and cross-origin redirects are rejected.
An icon can be captured even when the root page returns an authentication
challenge or non-HTML response, provided the icon path is unauthenticated.

**Hermes and VS Code/code-server:** A verified icon requires a reachable
raster asset on the local probed HTTP port. Native editor processes may have
no HTTP root, while web IDEs may require login, redirect off-origin or expose
icons only behind a path prefix. Those limitations cannot be bypassed safely.
Recognized names get a generic *local* editor/terminal glyph when no actual
favicon was saved. This does not fetch a third-party CDN or claim a verified logo.

In History or Pinned, expand **Discovery capabilities → Icon and metadata
discovery — setup and troubleshooting** to see the sanitized HTTP mode,
last attempt, successful metadata probe, cached icon observation and failure
category. `capabilities.http.lastIconSuccessAt` exposes the last successful
icon-caching timestamp or null. These in-memory diagnostics reset on restart;
the cached icons and service history do not.

Native host: use `curl -I http://127.0.0.1:PORT/favicon.ico` to check a
service's root-facing icon. Portracker itself uses bounded GET requests, not HEAD.
Bridge deployment: automatic private gateway selection is on by default, but
host services bound only to `127.0.0.1` may be unreachable from a container.
Prefer running Portracker natively for such loopback-only tools. Do not
disable host firewalls or give the Docker socket broader privileges.

Override the host **only** after verifying a reachable private numeric IP:

    export SERVICE_REGISTRY_HTTP_HOST=172.18.0.1  # EXAMPLE: replace with yours
    docker compose -f docker-compose.registry-fork.yml up -d --build portracker

Opt out without deleting cached icons:

    export SERVICE_REGISTRY_HTTP_ENABLED=false
    docker compose -f docker-compose.registry-fork.yml up -d --build portracker

The restricted Docker proxy is separate from HTTP enrichment. Its absence
can disable Docker provenance but cannot justify broad network access.

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

## User-selected icons (fork issue #77)

Pinned/History services and verified Compose parent rows can have an explicitly
chosen icon without changing the scanner or automatic HTTP favicon metadata.
This extends the same revisioned appearance contract used for custom names:

- `PATCH /api/service-registry/:id/appearance` with
  `{"icon":{"type":"glyph","name":"terminal"},"revision":N}` or
  `{"icon":{"type":"upload","hash":"<64 lowercase hex chars>"},"revision":N}`.
- `PATCH /api/service-registry/pinned-groups/:groupId/appearance` uses
  the same shape for the verified Compose parent only. Child choices remain
  independent. Use `{"icon":"automatic","revision":N}` to restore discovered
  favicon/fallback. Omitting `icon` preserves it during a name-only edit;
  omitting `name` preserves it during an icon-only edit.
- `POST /api/service-registry/custom-icons` sends a **raw** binary body
  (`Content-Type: image/png`, `image/jpeg`, `image/webp` or `image/x-icon`,
  also accepting `image/vnd.microsoft.icon`). Returns
  `{"hash":"<sha256>","mime":"image/png"}`. No multipart filenames,
  remote URL fetching, file paths or base64 list payloads.
- `GET /api/service-registry/custom-icons/:hash` serves only validated,
  stored raster bytes with `nosniff`, same-origin CORP, `default-src 'none'`
  CSP and private caching. Uploads/appearance mutations require a signed-in
  session with `ENABLE_AUTH=true`; read protection matches cached favicons.

The server validates MIME against raster structure, enforces **128 KiB per file**
and bounded dimensions, rejects SVG/HTML, corrupt/truncated structures and
supported EXIF/text metadata, and restricts glyphs to the server's curated
allowlist. The separate `registry_custom_icons` table is SHA-256 deduplicated,
limited to **64 distinct images / 4 MiB total**. Full uploads return HTTP 507;
invalid payloads return 400/413. Unreferenced uploads expire after one hour
on a later upload. Reset/Forget reclaims an icon once its **final** service
or Compose reference is gone; dormant verified group overrides retain their
references. The SQLite file should be backed up as a single unit.

Effective icon priority: **uploaded choice → selected local glyph → discovered
favicon → safe automatic fallback**. Automatic favicon refresh and eviction
never overwrite or delete user-selected bytes. Settings follow durable registry
service IDs or daemon-fingerprinted, verified Compose group IDs—not ports, PIDs
or unrelated apps restarting on the same socket.

The uploader checks format structure, not whether an image is visually safe
for every conceivable decoder. Images are never executed as HTML/SVG and are
subject to the browser's image decoder. Keep a current browser and do not
upload sensitive photographs or screenshots.
