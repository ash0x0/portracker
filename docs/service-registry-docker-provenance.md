# Docker and Docker Compose provenance (issue #8)

Portracker can remember the *logical* Docker Compose service behind a published
TCP port, even if the container is recreated or its host port changes.

## Identity vs sensitive metadata

The registry's existing Docker snapshot already calls `listContainers()` and
`inspectContainer()` for running containers. This feature **reuses that same
inspection** to read strictly allowlisted Compose labels; it does not invoke
Docker commands or modify containers.

A high-confidence logical identity requires:

1. Exact `com.docker.compose.project` and `com.docker.compose.service` labels
   from Docker's inspected `Config.Labels`, not guesses from network names.
2. A successfully read and hashed unique Docker daemon ID from read-only
   `getSystemInfo()`. The hash avoids persisting the raw daemon ID or
   connection credentials.

That identity is stable across container IDs, image changes and host-port
remapping for a service within the same Compose project and Docker daemon.
Different projects or daemons remain separate. If the Docker socket proxy
blocks `info` or labels are missing, the registry preserves the older
**provisional container-ID identity** instead of claiming a verified match.

Docker API failures and partial inspect results still follow #4's strict
source-scoped semantics: a failed Docker query cannot mark native Linux
listeners offline. An internal `EXPOSE` or Docker host-network process is
not evidence that a port is published, so no fake localhost URL is created.

## Optional private Compose details

The scanner can use trusted project/service labels for identity without storing
private host paths. To persist and show richer read-only Docker metadata:

```env
ENABLE_AUTH=true
SERVICE_REGISTRY_ENABLED=true
SERVICE_REGISTRY_DOCKER_PROVENANCE_ENABLED=true
```

When authentication is disabled, private metadata collection is disabled and
already saved Docker host paths are hidden from the API. Only an authenticated
saved-service **detail** response includes `dockerProvenance`. List responses
remain free of sensitive filesystem paths and raw Docker inspect data.

The allowlisted saved fields are: Docker-daemon fingerprint, most recently
observed container ID and name, image reference, network mode, Compose
project/service, Compose project working directory, up to eight Docker-host
Compose configuration paths, observation timestamp and confidence. Config
paths are labelled `pathScope: docker-host`, **not verified as files mounted
inside Portracker**. Docker labels besides those specific Compose keys,
Docker environment variables, mounts, commands and entrypoints are never
persisted. Paths with control characters or invalid syntax are excluded.

The snapshot is read-only and needs no write access to Docker. A stopped
container may no longer appear in `listContainers()` but its previously
captured metadata remains available in SQLite indefinitely until you
explicitly forget that history record. This feature does not make stopped
containers appear to be listening.

## Phase D: Docker discovery enabled by default

The fork's `docker-compose.registry-fork.yml` now **starts a separate
read-only Docker socket proxy** by default for rootful local Docker. The
Portracker application accesses only `tcp://docker-api-proxy:2375` over
an internal, unexposed `docker-monitor` network. The proxy mounts the
host socket, enforces `POST=0`, `CONTAINERS=1`, `INFO=1` and
`DISABLE_IPV6=1` for IPv4-only NixOS hosts; the application does not
mount docker.sock.

The scanner still attempts Docker inventory when the endpoint is unavailable,
but reports it as `collector_unavailable` without marking native source
history Offline. The new `capabilities.docker` status distinguishes
`requested`/`configured` from `available` (a **complete, confirmed
Docker scan**) and preserves the timestamp of the last known success.
UI History/Pinned show safe guidance, without leaking private Docker API URLs
or raw inspection metadata.

Docker container inspect is sensitive **even in read-only mode**: Config.Env
and Mounts may include secrets available to the monitor process. Do not
attach arbitrary containers to the private proxy network, expose its port, or
set `POST=1`. Other Portracker Docker mutation operations are expected
to fail against this GET-only endpoint.

For rootless Docker, set `PORTRACKER_DOCKER_SOCK` to the actual socket
path *before* running Compose. If the socket doesn't exist, Compose might
fail to mount it; start only the `portracker` service with
`docker compose -f docker-compose.registry-fork.yml up -d --build portracker`
and native System/HTTP discovery will still operate. See
[the NixOS guide](service-registry-nixos.md) for details.

## NixOS and Docker socket access

On NixOS, Compose's working directory is a **path on the Docker host**. The
Docker container running Portracker may not have that directory mounted. Avoid
interpreting it as a usable working directory within the monitor. Images and
paths can become stale when containers are replaced or NixOS configurations
change. If the daemon's `info` endpoint is blocked by a restricted
Docker socket proxy, history continues using provisional container IDs.
Explicit host-port publication remains the criterion for a Docker listener.

The UI shows a confidence label and saved Compose paths, but **does not create
or execute a restart command**. Read-only, safely quoted recovery hints are
tracked separately in #9.

## API and validation

- `GET /api/service-registry`: retains safe historical summaries, including
  `identityConfidence` for verified Compose identities.
- `GET /api/service-registry/:id`: adds `dockerProvenance` only with
  authenticated private provenance enabled.
- `DELETE /api/service-registry/:id`: forgets the stored provenance along with
  that service history record; it does not stop or remove a container.

Schema v5 is an idempotent addition to the existing SQLite registry.
Tests cover Compose recreation/remapping, duplicate service names across
projects and daemon identities, secret-label rejection, restricted Docker APIs,
host-network/internal-only ports, SQLite persistence, authentication gating,
and browser details. Full native AMD64/ARM64 CI validates the feature in this
fork without publishing images.
