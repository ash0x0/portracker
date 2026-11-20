# Portracker fork: NixOS service registry

This guide applies to **ash0x0/portracker**, not the original published
Portracker Docker image. It covers the fork's opt-in persistent History tab,
actual HTTP root titles/favicons, Linux/systemd and Docker/Compose provenance,
and read-only recovery instructions.

**Validation scope:** Linux Jest fixtures and AMD64/ARM64 Docker/browser
contracts run automatically in fork CI. Real host NixOS systemd services,
rootless Docker, and per-user /proc visibility still require the manual
checks below. Passing CI is not a claim that a real NixOS host was tested.

## Fastest deployment: Docker Compose built from the fork

From a checkout of this fork:

1. Back up your existing Portracker database.
2. Export your session secret in the calling shell. **On an existing installation,
   reuse the original secret**, otherwise old sessions will be invalidated.
   On a new installation only, generate one and save it securely:

       export SESSION_SECRET="$(openssl rand -hex 32)"

3. Build and run the standalone fork Compose file:

       docker compose -f docker-compose.registry-fork.yml up --build -d

4. Visit http://127.0.0.1:4999, complete authentication setup and open History.
5. Verify the running image:

       docker compose -f docker-compose.registry-fork.yml images

The fork-specific file is **standalone**: do not combine it with the
original docker-compose.yml, which still uses the upstream
mostafawahied/portracker:latest image. Compose merge behavior may otherwise
retain the original publicly bound port and elevated capabilities.

The fork file builds from this checkout, persists ./portracker-data, binds
port 4999 **only on 127.0.0.1**, requires authentication, and enables
historical scans, Linux metadata and recovery notes. Phase D enables bounded
HTTP root title/favicon enrichment by default and automatically selects a
validated private numeric bridge gateway from the container routing table.
Docker inventory is attempted by default via a **separate restricted
Docker socket proxy**, connected over a private internal-only network.
Portracker itself never mounts the Docker socket; the proxy has no published
port and only permits GET/HEAD API requests.

If the proxy fails or Docker is not accessible, Portracker's web UI and
native System history continue operating. **History/Pinned → Discovery
capabilities** distinguishes configured probes from confirmed success and
provides a safe failure reason. HTTP metadata failures do not delete cached
favicons or titles, and Docker failure never falsely closes native services.

**Security warning:** mounting docker.sock with :ro does NOT make its API
read-only. Only the separate `docker-api-proxy` has the real socket; the
proxy enforces `POST=0`, `CONTAINERS=1`, `INFO=1`,
`DISABLE_IPV6=1`, and is attached only to Docker's `internal: true`
monitoring network. The proxy still exposes sensitive read-only Docker
inspection metadata (possibly environment variables/mounts) **to the trusted
Portracker process**. Do not put untrusted containers on that network,
publish port 2375, or enable `POST=1`. The application's other Docker
write operations may be rejected by the read-only proxy; this is intentional
for this secure discovery deployment.

**Docker socket missing / rootless:** The default proxy bind source is
`/var/run/docker.sock`. For a rootless daemon, export your actual local
socket path before Compose, e.g.:

    export PORTRACKER_DOCKER_SOCK="$XDG_RUNTIME_DIR/docker.sock"

If no socket exists at all, the proxy may fail to start (or Compose may
report a bind error). **Start only the monitor**, without weakening security:

    docker compose -f docker-compose.registry-fork.yml up -d --build portracker

The UI, native history, and safe HTTP enrichment still run; Docker capability
shows unavailable. When a socket becomes available, run the full Compose
command to start the proxy. Existing Phase 7 temporary overlay
`/tmp/portracker-phase7.override.yml` is no longer required; do **not**
combine it with this standalone fork file during regular upgrades. Explicitly
opt out of HTTP probes with `SERVICE_REGISTRY_HTTP_ENABLED=false` in the
calling shell or override the gateway with a verified private numeric
`SERVICE_REGISTRY_HTTP_HOST`. No firewall/global network rules are changed.

This Compose file uses pid: host, a read-only host /proc bind mount and
SYS_PTRACE, but not SYS_ADMIN or unconfined AppArmor. The Docker network
namespace is still separate from the host. Inside a bridge container,
127.0.0.1 is generally NOT the host loopback, even with HOST_PROC. Rootless
Docker may also store its socket outside /var/run/docker.sock.

## Native NixOS installation: best for localhost developer services

Native deployment avoids many host/container PID and network-namespace
limitations when observing dev servers running directly on NixOS.

Use Node.js 22 and the NixOS-compatible native build dependencies. From the
fork checkout:

    npm ci
    npm ci --prefix backend
    npm ci --prefix frontend
    npm run build --prefix frontend
    mkdir -p backend/public
    cp -a frontend/dist/. backend/public/
    mkdir -p "$HOME/.local/state/portracker"

Create backend/.env (mode 0600) with values appropriate to your account.
The backend explicitly loads backend/.env; a root-level .env.example copy is
not sufficient.

    PORT=4999
    DATABASE_PATH=/home/YOUR_USER/.local/state/portracker/portracker.sqlite
    ENABLE_AUTH=true
    SESSION_SECRET=YOUR_LONG_RANDOM_SESSION_SECRET
    SERVICE_REGISTRY_ENABLED=true
    SERVICE_REGISTRY_SCAN_INTERVAL_MS=30000
    SERVICE_REGISTRY_HTTP_ENABLED=true
    SERVICE_REGISTRY_PROVENANCE_ENABLED=true
    SERVICE_REGISTRY_DOCKER_PROVENANCE_ENABLED=true
    SERVICE_REGISTRY_RECOVERY_ENABLED=true

Replace the home directory with a real absolute path, generate your own
session secret and never commit it. Start the backend:

    node backend/index.js

Native Linux HTTP metadata probes use 127.0.0.1 and only target recorded,
likely-HTTP TCP ports, with strict response/redirect limits. They cannot
retrieve live browser tab titles or client-side SPA route metadata.

**Network exposure warning:** the current backend explicitly listens
on 0.0.0.0:4999. Native deployments need NixOS firewall protection, a
suitable network namespace or an intentionally managed reverse proxy.
Enabling authentication does not automatically restrict the listening IP.

For a persistent system service, an optional NixOS module can reference a
prebuilt checkout at /opt/portracker and a separate secret EnvironmentFile.
This is an example, NOT a module tested on a real NixOS host:

    { pkgs, ... }:
    {
      users.groups.portracker = {};
      users.users.portracker = {
        isSystemUser = true;
        group = "portracker";
      };
      systemd.services.portracker-fork = {
        wantedBy = [ "multi-user.target" ];
        after = [ "network.target" ];
        serviceConfig = {
          Type = "simple";
          User = "portracker";
          Group = "portracker";
          WorkingDirectory = "/opt/portracker";
          ExecStart = "${pkgs.nodejs_22}/bin/node /opt/portracker/backend/index.js";
          StateDirectory = "portracker";
          EnvironmentFile = "/run/secrets/portracker-fork.env";
          Restart = "on-failure";
          NoNewPrivileges = true;
        };
      };
    }

Use the separate EnvironmentFile for DATABASE_PATH=/var/lib/portracker/portracker.sqlite,
ENABLE_AUTH, SESSION_SECRET and your feature flags. Keep secrets outside the
world-readable Nix store. Make the built checkout readable by the dedicated
service account and keep /var/lib/portracker writable by that account.

The dedicated account may not be able to read other users' /proc/<PID>/cwd
or exe. This is normal and must degrade to unknown, never trigger a
privileged fallback. Running under a systemd **user** service owned by your
desktop account can offer better visibility into your own dev processes.

Saved /nix/store executable paths do not prove a restart command will work
after a NixOS rebuild. Maintain your declarative module configuration or
document nix develop / direnv / pnpm dev in per-service recovery notes.
No privileged start endpoint is implemented.

## Manual NixOS acceptance checklist

These checks require a real NixOS host; the automated CI does not replace them.

1. Start Portracker, close all browsers, start a local HTTP server serving
   a known HTML title and a small local PNG favicon, and keep it up longer
   than one 30-second scan interval. Open History afterward to confirm
   automatic discovery and captured root metadata.
2. Stop the server. After an authoritative complete system scan, it should
   be Offline with its original icon/title. An incomplete scan must produce
   Unknown rather than falsely claiming the server stopped.
3. Restart Portracker before an authoritative scan. Previously listening
   services must initially become Unknown. After a complete scan, the
   saved service should return to Listening or become Offline appropriately.
4. Restart **the same app from the same cwd/executable and endpoint**, with
   trusted process evidence captured; its logical History record and recovery
   notes should be reused. Start a **different application** on that port,
   or a different Python app from another cwd, and verify it does not inherit
   those notes. Multiple simultaneously running processes must never merge.
   Logical matching is conservative: absent /proc evidence still creates a
   separate provisional episode.
5. Start a systemd system unit and a systemd --user unit with actual
   TCP listeners. Verify they are distinguished; interactive session scopes
   and the per-user manager are not falsely presented as application units.
6. Start standalone Docker and Compose apps. With an authorized restricted
   Docker API, check Compose identity on recreation/remapping and confirm
   unrelated projects do not merge. Host-network and internal-only ports
   must not become invented host-published endpoints.
7. Deny Docker inspection or a /proc process metadata read. Previously
   captured provenance must survive; a failed source must not erase
   unrelated native listener history.
8. Save manual recovery notes, reload History, restart the backend and
   verify notes persist. Copying a recipe must copy text only; no shell,
   Docker POST, DBus or systemd mutation is allowed.
9. Check legacy Live ports, peer inventory, server health and Docker health
   alongside History. In mobile width, verify the detail panel, controls
   and saved icons are readable without horizontal overflow.

Polling cannot discover a process that starts and exits entirely between
scans. The root HTTP title may be absent on authenticated, JSON-only,
TLS-untrusted or client-side-rendered apps without meaning the port is down.

## Backups, retention, privacy and rollback

- Before upgrading, back up SQLite and separately protect backend/.env
  or your managed secrets. With Portracker **stopped**, a normal filesystem
  copy of the DB is safe; while running, use SQLite's online backup API
  rather than copying only the active DB file. For example:

      sqlite3 portracker.sqlite ".backup 'pre-upgrade.sqlite'"

- History database migrations are additive schema versions 1 through 10
  (including durable pins and source-owned Docker proxy correlations).
  Automatic schema downgrades are not implemented. Keep a verified pre-upgrade
  backup if you might run an older binary.
- Active cached raster icon payloads are capped at 128 distinct images
  of at most 128 KiB each (maximum 16 MiB before SQLite/WAL overhead).
  HTML reads are capped at 256 KiB. Historical service rows are not
  automatically deleted: use the History view's confirmed Forget action.
- The scheduler uses at least a 10-second interval, single-flight scans
  and source-specific failure tracking. HTTP metadata limits each scan
  to four candidate listeners, two concurrent probes, and five-minute
  retry/one-day refresh; process provenance reads up to 128 PIDs per
  cycle. Monitor CPU, memory, DB page count and WAL size on the real host.
- To stop observations: set SERVICE_REGISTRY_ENABLED=false and restart.
  To stop outgoing root probes alone, set
  SERVICE_REGISTRY_HTTP_ENABLED=false. Saved history remains. Disabling
  recovery prevents access to saved private instructions but does not
  silently delete user data.
- Review firewall, authenticated access, Docker socket scope, host-proc
  permissions, private IP probing, DNS/address pinning, response MIME and
  byte caps, SQL parameterization and shell argument quoting before
  broadening deployment. No recovery command execution endpoints exist.
- For rollback, stop the new version, restore the verified pre-upgrade
  SQLite backup to its original path, then start the prior version.
  Do not manually remove schema-version entries from a populated database.

Other focused guides: docs/service-registry-http-metadata.md,
docs/service-registry-linux-provenance.md,
docs/service-registry-docker-provenance.md,
docs/service-registry-recovery.md, and docs/service-registry-roadmap.md.
