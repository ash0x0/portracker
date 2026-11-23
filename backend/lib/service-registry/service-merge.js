'use strict';

// Explicit user assertion that two same-source observations are the same service.
// A transactional merge never guesses from names or ports and never runs commands.
class RegistryMergeConflict extends Error {
  constructor(message) {
    super(message);
    this.code = 'merge_conflict';
  }
}

function createServiceMerger(db, getService) {
  const lookup = db.prepare('SELECT * FROM registry_services WHERE id = ?');
  const lookupNotes = db.prepare('SELECT * FROM registry_recovery_notes WHERE service_id = ?');
  const lookupAppearance = db.prepare('SELECT * FROM registry_service_appearance WHERE service_id = ?');
  const lookupMetadata = db.prepare('SELECT * FROM registry_http_metadata WHERE service_id = ?');
  const sourceLink = db.prepare('SELECT docker_service_id FROM registry_source_links WHERE system_service_id = ?');

  const merge = db.transaction((targetId, sourceId, at) => {
    if (typeof targetId !== 'string' || typeof sourceId !== 'string' ||
        !targetId || !sourceId || targetId.length > 128 || sourceId.length > 128 ||
        targetId === sourceId || !Number.isSafeInteger(at) || at < 0) {
      throw new TypeError('Invalid merge selection');
    }
    const target = lookup.get(targetId);
    const source = lookup.get(sourceId);
    if (!target || !source) return null;
    if (target.server_id !== source.server_id || target.source !== source.source) {
      throw new TypeError('Only services on the same host and discovery source can be merged');
    }

    const targetNotes = lookupNotes.get(targetId);
    const sourceNotes = lookupNotes.get(sourceId);
    const targetAppearance = lookupAppearance.get(targetId);
    const sourceAppearance = lookupAppearance.get(sourceId);
    const mismatch = (left, right) => Boolean(left && right && left !== right);
    if (mismatch(targetNotes?.notes, sourceNotes?.notes) ||
        (targetNotes?.start_command && sourceNotes?.start_command &&
          (targetNotes.start_command !== sourceNotes.start_command ||
            targetNotes.start_cwd !== sourceNotes.start_cwd)) ||
        mismatch(targetAppearance?.name, sourceAppearance?.name) ||
        mismatch(targetAppearance?.icon_choice, sourceAppearance?.icon_choice)) {
      throw new RegistryMergeConflict(
        'Both entries have different saved notes, commands, names or icons. Resolve them before merging.'
      );
    }
    const targetDocker = sourceLink.get(targetId);
    const sourceDocker = sourceLink.get(sourceId);
    if (targetDocker && sourceDocker &&
        targetDocker.docker_service_id !== sourceDocker.docker_service_id) {
      throw new RegistryMergeConflict('Both entries are linked to different Docker services');
    }

    // Preserve the durable target ID, earliest sighting and latest source status.
    db.prepare(
      'UPDATE registry_services SET first_seen_at = MIN(first_seen_at, ?), ' +
      'last_seen_at = MAX(last_seen_at, ?), updated_at = MAX(updated_at, ?), ' +
      "status = CASE WHEN status = 'listening' OR ? = 'listening' THEN 'listening' " +
      "WHEN status = 'unknown' OR ? = 'unknown' THEN 'unknown' ELSE 'offline' END, " +
      'is_pinned = MAX(is_pinned, ?), ' +
      'pinned_at = CASE WHEN pinned_at IS NULL THEN ? WHEN ? IS NULL THEN pinned_at ' +
      'ELSE MIN(pinned_at, ?) END, ' +
      "identity_confidence = CASE WHEN identity_confidence = 'verified' OR ? = 'verified' " +
      "THEN 'verified' WHEN identity_confidence = 'provisional' OR ? = 'provisional' " +
      "THEN 'provisional' ELSE 'uncertain' END WHERE id = ?"
    ).run(source.first_seen_at, source.last_seen_at, at, source.status, source.status,
      source.is_pinned, source.pinned_at, source.pinned_at, source.pinned_at,
      source.identity_confidence, source.identity_confidence, targetId);

    // Aliases are scoped by collector, server and kind. They keep both prior
    // process episodes and known logical identities resolving to the target.
    const saveAlias = db.prepare(
      'INSERT INTO registry_identity_aliases (server_id, source, identity_kind, identity_key, service_id) ' +
      'VALUES (?, ?, ?, ?, ?) ON CONFLICT(server_id, source, identity_kind, identity_key) ' +
      'DO UPDATE SET service_id = excluded.service_id'
    );
    for (const item of [target, source]) {
      if (item.identity_key) saveAlias.run(item.server_id, item.source, 'process', item.identity_key, targetId);
      if (item.logical_identity_key) {
        saveAlias.run(item.server_id, item.source, 'logical', item.logical_identity_key, targetId);
      }
    }
    db.prepare('UPDATE registry_identity_aliases SET service_id = ? WHERE service_id = ?')
      .run(targetId, sourceId);
    const runs = db.prepare(
      'SELECT run_key FROM registry_process_runs WHERE service_id IN (?, ?)'
    ).all(targetId, sourceId);
    for (const row of runs) {
      saveAlias.run(target.server_id, target.source, 'process', row.run_key, targetId);
    }
    db.prepare(
      'INSERT INTO registry_process_runs (service_id, run_key, first_seen_at, last_seen_at) ' +
      'SELECT ?, run_key, first_seen_at, last_seen_at FROM registry_process_runs ' +
      'WHERE service_id = ? ON CONFLICT(service_id, run_key) DO UPDATE SET ' +
      'first_seen_at = MIN(first_seen_at, excluded.first_seen_at), ' +
      'last_seen_at = MAX(last_seen_at, excluded.last_seen_at)'
    ).run(targetId, sourceId);
    db.prepare('DELETE FROM registry_process_runs WHERE service_id = ?').run(sourceId);

    db.prepare(
      'INSERT INTO registry_endpoints ' +
      '(id, service_id, host_ip, host_port, protocol, internal, source, first_seen_at, last_seen_at) ' +
      'SELECT lower(hex(randomblob(16))), ?, host_ip, host_port, protocol, internal, source, ' +
      'first_seen_at, last_seen_at FROM registry_endpoints WHERE service_id = ? ' +
      'ON CONFLICT(service_id, host_ip, host_port, protocol, internal, source) ' +
      'DO UPDATE SET first_seen_at = MIN(first_seen_at, excluded.first_seen_at), ' +
      'last_seen_at = MAX(last_seen_at, excluded.last_seen_at)'
    ).run(targetId, sourceId);
    db.prepare('DELETE FROM registry_endpoints WHERE service_id = ?').run(sourceId);

    if (sourceNotes) {
      if (!targetNotes) {
        db.prepare('UPDATE registry_recovery_notes SET service_id = ? WHERE service_id = ?')
          .run(targetId, sourceId);
      } else {
        db.prepare(
          'UPDATE registry_recovery_notes SET notes = ?, revision = ?, updated_at = ?, ' +
          'start_command = ?, start_cwd = ?, start_revision = ?, start_updated_at = ? ' +
          'WHERE service_id = ?'
        ).run(targetNotes.notes || sourceNotes.notes,
          Math.max(targetNotes.revision, sourceNotes.revision) + 1,
          Math.max(targetNotes.updated_at || 0, sourceNotes.updated_at || 0) || null,
          targetNotes.start_command || sourceNotes.start_command,
          targetNotes.start_command ? targetNotes.start_cwd : sourceNotes.start_cwd,
          Math.max(targetNotes.start_revision, sourceNotes.start_revision) + 1,
          Math.max(targetNotes.start_updated_at || 0, sourceNotes.start_updated_at || 0) || null,
          targetId);
      }
      db.prepare('DELETE FROM registry_recovery_notes WHERE service_id = ?').run(sourceId);
    }
    if (sourceAppearance) {
      if (!targetAppearance) {
        db.prepare('UPDATE registry_service_appearance SET service_id = ? WHERE service_id = ?')
          .run(targetId, sourceId);
      } else {
        db.prepare(
          'UPDATE registry_service_appearance SET name = ?, icon_choice = ?, ' +
          'revision = ?, updated_at = ? WHERE service_id = ?'
        ).run(targetAppearance.name || sourceAppearance.name,
          targetAppearance.icon_choice || sourceAppearance.icon_choice,
          Math.max(targetAppearance.revision, sourceAppearance.revision) + 1,
          Math.max(targetAppearance.updated_at, sourceAppearance.updated_at, at), targetId);
      }
      db.prepare('DELETE FROM registry_service_appearance WHERE service_id = ?').run(sourceId);
    }

    const targetMeta = lookupMetadata.get(targetId);
    const sourceMeta = lookupMetadata.get(sourceId);
    if (sourceMeta) {
      if (!targetMeta) {
        db.prepare('UPDATE registry_http_metadata SET service_id = ? WHERE service_id = ?')
          .run(targetId, sourceId);
      } else {
        const newest = (sourceMeta.fetched_at || 0) > (targetMeta.fetched_at || 0)
          ? sourceMeta : targetMeta;
        const oldest = newest === targetMeta ? sourceMeta : targetMeta;
        db.prepare(
          'UPDATE registry_http_metadata SET title = ?, visit_url = ?, icon_hash = ?, ' +
          'fetched_at = ?, last_attempt_at = ?, error_code = ? WHERE service_id = ?'
        ).run(newest.title || oldest.title, newest.visit_url || oldest.visit_url,
          newest.icon_hash || oldest.icon_hash,
          Math.max(newest.fetched_at || 0, oldest.fetched_at || 0) || null,
          Math.max(newest.last_attempt_at, oldest.last_attempt_at), newest.error_code, targetId);
      }
      db.prepare('DELETE FROM registry_http_metadata WHERE service_id = ?').run(sourceId);
    }

    // Each provenance table stores one most-recent source-owned snapshot.
    for (const table of ['registry_linux_provenance', 'registry_docker_provenance']) {
      const oldRow = db.prepare('SELECT captured_at FROM ' + table + ' WHERE service_id = ?').get(sourceId);
      if (!oldRow) continue;
      const newRow = db.prepare('SELECT captured_at FROM ' + table + ' WHERE service_id = ?').get(targetId);
      if (!newRow || oldRow.captured_at > newRow.captured_at) {
        db.prepare('DELETE FROM ' + table + ' WHERE service_id = ?').run(targetId);
        db.prepare('UPDATE ' + table + ' SET service_id = ? WHERE service_id = ?')
          .run(targetId, sourceId);
      } else db.prepare('DELETE FROM ' + table + ' WHERE service_id = ?').run(sourceId);
    }

    if (target.source === 'docker') {
      db.prepare('UPDATE registry_source_links SET docker_service_id = ? WHERE docker_service_id = ?')
        .run(targetId, sourceId);
    } else {
      db.prepare(
        'INSERT OR IGNORE INTO registry_source_links (system_service_id, docker_service_id, linked_at) ' +
        'SELECT ?, docker_service_id, linked_at FROM registry_source_links WHERE system_service_id = ?'
      ).run(targetId, sourceId);
      db.prepare('DELETE FROM registry_source_links WHERE system_service_id = ?').run(sourceId);
    }
    db.prepare('DELETE FROM registry_services WHERE id = ?').run(sourceId);
    return getService(targetId);
  });

  return (targetId, sourceId, at = Date.now()) => merge(targetId, sourceId, at);
}

module.exports = { createServiceMerger, RegistryMergeConflict };
