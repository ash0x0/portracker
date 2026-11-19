# Persistent localhost service registry — implementation roadmap

> **Scope:** All feature development and tracking in `ash0x0/portracker`.  
> **Target:** Opt-in functionality on Linux, especially NixOS, without changing existing live port monitoring defaults.  
> **Workflow:** One issue and one focused PR for each milestone below. PRs merge into this fork's `main` in dependency order; upstream is out of scope.

## Goal and user story

After any service listens on a local port, Portracker should **automatically discover it, remember it permanently, and make it recoverable**. For HTTP services it should capture the actual browser tab title and favicon; for services with identifiable ownership it should save the process manager, original project location, and a **read-only** restart recipe. When the service exits, disappears, or the machine reboots, its entry remains visible with a meaningful status.

## Architectural principles

- Separate **live observations** (the current port scan) from **historical identities** (an enduring catalog). An endpoint/port is not an application identity.
- Process IDs and container IDs are observations, not durable application IDs. Derive stable identities from reliable available provenance; otherwise use conservative revisions and mark uncertain relationships. Preserve both records if a port might have changed ownership.
- An **empty successful scan** means observed listeners disappeared; a **failed or partial scan** means status is *unknown* and must never mark every record offline.
- A **listening TCP socket** is not the same as a healthy HTTP endpoint. Keep network reachability, listener presence, and application health distinct.
- Every write is idempotent. Scan records must survive restarts and schema migrations without requiring a browser tab.
- No unsanitized command lines, environment variables, cookies, credentials, or page bodies in SQLite or HTTP responses.
- Metadata probes are bounded, host-aware, opt-in, and do not bypass current SSRF protections; no JavaScript execution.
- Data collection is **read-only**. Do not introduce systemd/Docker start/stop APIs or a general command runner.
- Maintain compatibility with existing API routes and peer installations; new routes are version-tolerant.

## Milestones and PR boundaries

### 1. Durable observation data model & application identity

**Modules:** `backend/db.js`, new `backend/lib/service-registry/` DAO, migration and DAO tests.

- Add indexed SQLite history tables for logical services and observed listeners, scoped to a known host/server.
- Record first/last seen, address/port/protocol, source, safe owner/Compose identifiers, observation fingerprint and last known display name.
- Avoid PID-only keys. Distinguish unrelated apps sharing port 3000 at different times; preserve historical records on conflict.
- Make migration idempotent and safe against existing databases; expose a paginated read-only history API if feasible without scanner coupling.
- Add an explicit future-facing `forget` operation with bounded input and auth checks; never silently expire records.
- **Done:** DAO tests cover initial insert, repeat, port reuse, DB reopen, migration and explicit deletion. No additional background scanning in this PR.

### 2. Continuous discovery & state reconciliation

**Modules:** existing collectors, app lifecycle, new scheduler.

- Opt-in low-frequency host scan, independent of connected dashboard browsers.
- Feed successful complete snapshots to the DAO and reconcile entries as active/offline. Mark **unknown** (or retain last known state with stale indicator) on failed/partial scans.
- Avoid overlap, rapid retries, thundering herd, or sync SQLite writes on every UI refresh. Allow configuration of frequency.
- Keep individual collector errors visible and make multi-source scans non-destructive.
- **Done:** start and stop a temporary listener and verify state changes; injected collector error never marks all history offline.

### 3. Historical services UI

**Modules:** new history view and API client/hook components, no rewrite of existing live dashboard.

- Search, sort, filter by running/offline/unknown, host, source and text; show first/last seen and counts.
- Separate online TCP listening state from HTTP health; show confidence and staleness.
- Display saved historical details, URL, and placeholders for future title/favicon/provenance fields.
- Explicit forget action with confirmation; never auto-delete on stopped port. Responsive and keyboard-accessible.
- **Done:** UI tests for empty, online, offline, unknown, port reuse, and larger paginated datasets.

### 4. HTTP website title, favicon and URL enrichment

**Modules:** opt-in metadata probe and safe icon cache, DAO fields, historical UI.

- Probe only likely HTTP(S) listeners or verified web endpoints; resolve local URL correctly including loopback/IPv6.
- Parse `<title>`, common favicon link relations, optional `/favicon.ico` fallback. Resolve relative URLs; store a small, validated cached icon blob or local file reference.
- Respect user overrides. Don't lose previously fetched metadata when an app goes offline.
- Rate-limit, cap response/image bytes, enforce content types, timeouts, redirect count, and target address/hostname policies.
- **Done:** Next.js/Vite-style fixture yields expected title and relative icon offline; authentication, non-HTTP and malicious responses degrade safely.

### 5. Native Linux ownership and systemd provenance

**Modules:** read-only Linux collector enrichment and provenance fields.

- Capture safely obtainable process executable name/path, cwd and redacted argv; record observation confidence.
- Attribute systemd **system** versus **user** units from reliable cgroup/metadata; avoid guessing from process names.
- Include NixOS caveats (systemd units, user services, Nix store paths, `nix develop`, `direnv`).
- Be transparent about missing privileges, namespaces and inaccessible `/proc`.
- **Done:** test native manual process, system unit, user unit, absent permissions, and PID reuse; no secrets stored.

### 6. Docker and Docker Compose provenance

**Modules:** Docker collector and Compose attribution.

- Persist stable container name/image and service/project labels alongside container ID.
- Capture Compose project, service, config files and working directory **only when exposed reliably** by labels/inspection.
- Understand stopped or recreated containers and container-level port remappings; never equate container ID with application identity.
- Do not elevate Docker access, write to Docker socket or require privileged permissions beyond existing discovery.
- **Done:** Compose and ordinary Docker fixtures produce distinguishable saved provenance and survive recreation.

### 7. Read-only recovery recipes and manual overrides

**Modules:** recipe renderer/selector and history detail panel.

- Systemd system: `systemctl start <unit>`; user: `systemctl --user start <unit>`.
- Docker container: `docker start <container>` **only if relevant container is known**; Compose: `docker compose ... up -d <service>` only when project/config context is known.
- Manual process: saved cwd with **sanitized, unverified** last-observed command; optionally infer package scripts/manifests.
- Explicit confidence labels, editable user-authored notes/override, copy-to-clipboard; no command execution.
- NixOS declarative enablement instructions are separate from immediate starts and never guessed without evidence.
- **Done:** recipes remain after reboot, never silently fabricate an executable command, and correctly escape untrusted content.

### 8. NixOS integration, regression/acceptance tests and documentation

**Modules:** test fixtures, documentation, deployment notes.

- Test end-to-end across Linux systemd, user systemd, Docker/Compose, and manual `npm/pnpm`-style dev servers.
- Verify read-only and opt-in operation from Docker with PID namespace and existing scanner restrictions; document `/proc`, host network and rootless limitations.
- Test two apps using same localhost port sequentially, restart persistence, scanner failure, HTTP title/favicon offline state, and confidence of recovery recipe.
- Verify backward compatibility, reasonable CPU/storage overhead and DB backup/migration behavior.
- Publish setup and privacy/security guidance (auth, local access, Docker API restrictions).
- **Done:** reproducible demonstration and documented trade-offs on NixOS.

## PR / issue protocol

For each milestone:
1. Open an issue with the narrow scope, dependency links, security requirements, acceptance tests and proposed modules.
2. Create a branch named `feature/service-registry-<area>` from the fork's latest main (or declared prerequisite branch, if unavoidable).
3. Implement and test the minimum end-to-end slice; update documentation for user-facing changes.
4. Open a PR **against `ash0x0/portracker:main`**, link the fork issue, include test evidence and explicitly name limitations.
5. Do not merge or start another dependent feature PR until the current change has been reviewed/validated (unless explicitly requested to parallelize).

## Acceptance scenario

1. Start a local development server on port 3000 with title **BuildPro** and favicon.
2. Observe it; Portracker creates history and captures metadata without manual registration.
3. Stop the process, restart Portracker and reboot NixOS: the saved entry remains searchable and offline.
4. Start a *different* service on port 3000: both identities remain distinct.
5. For known systemd/Docker/Compose services, inspect provenance and copy the saved restart recipe.
6. For unknown launch mechanisms, see `unknown` or `unverified` rather than a fabricated instruction.
