# Historical and offline services dashboard (issue #5)

## Where to find it

The main dashboard has **Live ports** and **History** tabs. The sidebar remains for live server navigation; selecting a server returns to Live ports. History has its **own filters** that are separate from the existing live-port search and health indicators.

The History tab reads saved entries from the authenticated `/api/service-registry` endpoint. No browser session is required **to collect** history—when the backend is configured with `SERVICE_REGISTRY_ENABLED=true`, its background scanner continues sampling even with all browser tabs closed.

## Search and use

- Search by last-known service/process name.
- Filter by exact port, TCP listening status (`listening`, `offline`, `unknown`), and source (`system` or `docker`).
- Use paginated results (24 at a time), with first/last-seen timestamps and the latest known endpoint.
- Open a record to see its full historical endpoint list and identity-confidence label.
- Explicitly **Forget** a selected record after confirmation. This deletes history only; it does **not** stop the process, alter Docker/systemd, or delete existing per-port notes.
- **Reload list** in History and Pinned fetches saved entries and scan status from the backend without launching discovery. Both views also reload automatically every 30 seconds while mounted; **Scan now** explicitly runs a host discovery scan before reloading the saved list.

## State interpretation

**Listening**: this TCP socket was observed. It is not a promise that an HTTP page is healthy.

**Offline**: an authoritative scan of the relevant source no longer observed that service.

**Unknown**: the source was partially observable, failed, or Portracker restarted and has not yet observed an authoritative snapshot. Its historical last-seen timestamp remains.

A port can be reused. Registry records are keyed by saved service/episode IDs, not port alone. When ownership is uncertain, the UI explicitly says so.

The scanner is server-wide opt-in. If disabled, the History page explains how to enable it; previous saved history remains browseable.

## Boundaries

This feature does **not** automatically fetch website page titles/favicons (#6), discover systemd or Compose ownership (#7/#8), or launch processes (#9). These enhancements will appear in the same saved-service detail panel without merging it into live port health state.

## Validation

Backend Jest verifies paginated preview fields and authentication; frontend Node tests verify status/port/page formatting; browser contracts exercise History-to-Live navigation and mobile/desktop layouts. Native AMD64 and ARM64 image/browser checks run in the fork's CI.


## Pinned services (schema v9)

**Pinned** is a first-class top-level tab next to **Live ports** and **History**.
The **Pin** control on a saved History card or in service details marks a
logical historical service for quick access. The Pinned tab uses the same
service details and **copy-only** preferred recovery command as History.
Pinned services are sorted **Offline → Unknown → Listening**, with the most
recently pinned first within each status group.

Pins are stored in SQLite on the service ID, **not** on a port, PID, browser
local storage key, or Docker container ID. They persist across complete scans,
Offline states, Portracker restarts, and recognized logical-service restarts.
When an unrelated application takes over the same port, it must not inherit a
pin. If a provisional identity cannot be proven across restarts, the new record
is not pinned automatically. Forgetting a historical service deletes its pin.

The History list stays unfiltered unless `pinnedOnly=true` is requested.
`PUT /api/service-registry/:id/pin` accepts only
`{"pinned": true}` or `{"pinned": false}`, is idempotent, and is guarded by
the dashboard's existing session authorization and same-origin protections.
The list and pin update responses do not return private provenance or recovery
instructions. Clicking **Pin** does **not** restart the process.

### Manual verification

- Pin Python HTTP server 4177 in History; confirm it appears in Pinned.
- Stop the server and perform a complete scan; its Pinned card stays available
  as Offline. Open it to copy saved recovery instructions without executing.
- Restart from the same cwd/executable and port; if logical identity was
  established, the pin remains on the same service record.
- Run another application on that port; verify it does not steal the pin.
- Pin at least one Listening, Unknown and Offline entry; verify ordering,
  search, pagination, refresh, browser reload and container restart.
- Unpin in either History or Pinned, and verify it disappears from Pinned
  without being forgotten from History. Check narrow/mobile layout and keyboard
  access.

## Docker / native host-proxy correlation (schema v10, issue #36)

A Docker-published TCP port may be reported twice: the Docker API identifies the
actual application container and the NixOS native TCP collector sees a separate
`docker-proxy` listener forwarding that host binding. These represent
**two source observations of one exposure**, not two applications to pin.

When **both source scans are complete**, Docker inspection has returned real
container evidence, and there is a unique, **recent listening** match with
the **same host IP, TCP port and local server ID**, Portracker persistently
links the native proxy to its Docker service. Default **History → All sources**
shows **one Docker-owned card**, labelled `docker + system`, with the container
name, Compose provenance, and Docker recovery instructions. **Source → Native
system** still shows the raw host-proxy observation for troubleshooting.
Explicit **Source → Docker** still shows the Docker record.

This is intentionally a **non-destructive presentation merge**: the DB preserves
both original service IDs, independent source statuses, historical endpoints,
provenance, and any user-authored notes. System proxy records with a pin, notes,
or a preferred startup command remain visible; they are never silently hidden
or moved. The association survives offline transitions, restarts and database
reopening; deleting the canonical Docker record reveals its original native
record again. If Docker inspection fails, the scanner does not infer a new link
from a Linux port alone. Another application reusing a port must not be linked
on endpoint equality alone: Docker provenance and the `docker-proxy` process
name must both be present, with fresh and unambiguous observations.

Existing **historical, already-offline** duplicates from before schema v10
are **not** guessed into a match. They remain accessible until a genuinely
confirmed live pairing or explicit user cleanup; this is safer than merging
potentially unrelated past port occupants.

### Manual verification on NixOS

1. Run Phase 7 of [manual acceptance issue #21](https://github.com/ash0x0/portracker/issues/21)
   with the restricted Docker socket proxy (IPv4-only `DISABLE_IPV6=1` if required).
2. Check `Docker: complete` and `System: complete`, and discover port
   4181 or 4183 while its test container is running.
3. Under History → **All sources**, the Nginx container appears once,
   with a `docker + system` source label. Open the card to see the **Docker
   / Compose provenance** section; it is not replaced by `docker-proxy`.
4. Set Source → **Native system** to see the original `docker-proxy` record;
   Source → **Docker** to see the actual container record.
5. Stop the container; after complete scans, the single canonical record
   becomes Offline and retains its provenance. Test a normal unrelated
   Python listener on the same port later; it must remain a separate record.
6. Existing pins and recovery notes are retained. Check source-scoped
   failure handling by stopping the Docker API proxy temporarily; the
   independent Linux scanner must still work.


## Phase C — Grouped Pinned Services (issues #43 and #44)

The **Pinned** tab has its own **Services** list, styled like Live ports
instead of reusing History's multi-column card grid. Each row has a
chevron, icon, status indicator, source label and up to five visible TCP
port chips. A `+N more` indicator leads to all remembered port chips when
expanded. Grey chips represent historical endpoints, not necessarily
currently reachable listeners. Offline and unknown favorites remain visible.

### Identity and grouping boundaries

- A durable registry service UUID owns its **pin, notes, recovery command,
  status, provenance and historical endpoints**. A service publishing five
  ports appears as **one service**, not five bookmarks.
- Only a **verified** Docker daemon fingerprint + Compose project may create
  a *visual* parent containing multiple different pinned service IDs. The
  server determines project membership from persisted provenance. It does
  **not** combine or rewrite child registry records; unpinned project siblings
  never become pinned.
- Native listeners or unverified Docker processes with similar names, same
  user, same port or shared paths are **not** merged. Source-specific Docker/
  Linux correlation retains the non-destructive behavior from issue #36.
- `GET /api/service-registry/pinned-groups` accepts History-equivalent
  validated `limit`, `offset`, `status`, `source`, `search`, and
  `portPrefix` filters. It filters durable pinned records **before**
  grouping and paginates after grouping, so sibling entries never split
  across pages. Endpoints and provenance are bulk-read from SQLite. The
  payload does not expose private Compose working directories or daemon
  fingerprints; authorization and no-store caching match History.

### Accidental-unpin protection

Collapsed Pinned rows have **no clickable Unpin action**. Expanding a
single-service row shows its recovery/metadata details with an explicit
**Unpin** button; multi-service Compose parents first show child service
selectors, and Unpin affects the selected child ID only. When one sibling
is unpinned, the project remains visible until the last pinned child is
removed, and the remaining child becomes selected. History continues to
offer fast Pin/Unpin on the summary card.

### Local manual acceptance (NixOS)

1. Pull `main`, rebuild Portracker with existing persistent SQLite volume,
   the **original** `SESSION_SECRET`, and (if enabled) the private Docker
   socket proxy overlay from issue #21. This feature needs **no DB migration**.
2. Pin a Docker/Compose service with several published ports in History.
   Open Pinned and verify **one Services row** with port chips and `+N`
   overflow if more than five ports. Expand to inspect all ports and
   existing Docker provenance/recovery details.
3. Pin a second *verified* service from the same Compose project. The group
   should have one project header and separate child selectors. Unpin one
   child **inside details**; the other stays pinned and keeps its notes.
4. Ensure Pinned collapsed rows have no interactive Unpin control; History
   still has it. Check Offline favorites retain historical ports and
   that unrelated native processes remain separate.
5. Verify mobile wrapping, page/filters and 30-second background refresh
   preserve the expanded selection and scroll position.

## Pinned appearance customization (issue #78)

Expand a Pinned row and choose **Edit appearance** for a single-service row,
or **Edit project appearance** for a verified Compose project. A project edit
changes only the visual parent, not any member service's identity, pin, recovery
instructions, or override. For Compose children, choose **Edit selected service**
in the child details toolbar; this remains available even when only one child
is pinned.

The editor starts with the effective visible name. It displays the original
automatically detected name for troubleshooting. Choose a built-in local icon,
**Automatic** (the latest cached favicon or a safe fallback), or select a local
PNG/JPEG/WebP/ICO image to upload. An uploaded icon is a user-provided image,
not a verified website favicon. Images are restricted to 128 KiB and are
validated again by the server. No user-supplied remote URLs are fetched.

**Reset name** and **Reset icon** are independent draft changes, committed
only when **Save appearance** succeeds. Cancel or Escape discards the draft;
failed saves retain it. A 409 conflict indicates that another session updated
the appearance; explicitly reload the latest values before trying again.
Custom service labels/icons also appear in History and service details and
remain visible while a service is Offline.

Editing neither executes recovery commands nor performs a discovery scan.
The 30-second list reload does not overwrite an open edit form. Saving an
alias can change whether the item matches the current search or filters;
clear the name filter or adjust filters to find the renamed item.

### Browser acceptance

Run the existing `scripts/browser-contracts.mjs` checks through the fork's
browser CI. The appearance contracts cover project/child independence,
save/reset, upload preview, optimistic conflict behavior, reload while editing,
draft cancellation, browser reload, and narrow/mobile viewports. For full
database, authorization, upload validation and disk-reopen checks, use the
targeted backend tests introduced by issues #76 and #77. Actual NixOS
and Docker/proxy behavior still requires manual host acceptance.

### API contract and prerequisites

This frontend expects the revisioned, authenticated endpoints from #76/#77:

- `PATCH /api/service-registry/:id/appearance`
- `PATCH /api/service-registry/pinned-groups/:groupId/appearance`
- `POST /api/service-registry/custom-icons` (raw local raster bytes)
- `GET /api/service-registry/custom-icons/:hash` (protected, raster-only)

Read models expose the effective `displayName` (service) or `name` (group),
`detectedName`, `appearanceRevision`, and `iconChoice` (a safe object of
type `automatic`, `glyph` plus a whitelisted `name`, or `upload` plus
a validated `hash`). A name reset sends `name: null`; an icon reset
sends `icon: "automatic"`; omitted fields are unchanged. The backend
requires authenticated same-origin mutations. Merge the backend from #76/#77
and revalidate this UI against it before release.
