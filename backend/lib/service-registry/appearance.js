'use strict';

// The same PATCH contract will support icons later without mixing the
// independently versioned discovered metadata into user-owned annotations.
function validateNamePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) ||
      !Object.prototype.hasOwnProperty.call(patch, 'name') ||
      !Object.prototype.hasOwnProperty.call(patch, 'revision') ||
      Object.keys(patch).some(key => !['name', 'revision'].includes(key))) {
    throw new TypeError('Expected name and revision');
  }
  if (!Number.isSafeInteger(patch.revision) || patch.revision < 0) {
    throw new TypeError('Invalid appearance revision');
  }
  if (patch.name === null) return { name: null, revision: patch.revision };
  if (typeof patch.name !== 'string') throw new TypeError('Invalid appearance name');
  const name = patch.name.trim().normalize('NFC');
  // Reject invalid Unicode, newlines, controls and direction-spoofing marks.
  if (!name || [...name].length > 80 ||
      Buffer.from(name, 'utf8').toString('utf8') !== name ||
      /[\p{Cc}\u00ad\u061c\u200e\u200f\u202a-\u202e\u2066-\u206f]/u.test(name)) {
    throw new TypeError('Invalid appearance name');
  }
  return { name, revision: patch.revision };
}

function createAppearanceStore(db) {
  const serviceExists = db.prepare('SELECT id FROM registry_services WHERE id = ?');
  const serviceRow = db.prepare(
    'SELECT name, revision, updated_at FROM registry_service_appearance WHERE service_id = ?'
  );
  const groupRow = db.prepare(
    'SELECT name, revision, updated_at FROM registry_group_appearance WHERE group_id = ?'
  );
  const saveService = db.prepare(
    'INSERT INTO registry_service_appearance (service_id, name, revision, updated_at) ' +
    'VALUES (?, ?, ?, ?) ON CONFLICT(service_id) DO UPDATE SET ' +
    'name = excluded.name, revision = excluded.revision, updated_at = excluded.updated_at'
  );
  const saveGroup = db.prepare(
    'INSERT INTO registry_group_appearance (group_id, name, revision, updated_at) ' +
    'VALUES (?, ?, ?, ?) ON CONFLICT(group_id) DO UPDATE SET ' +
    'name = excluded.name, revision = excluded.revision, updated_at = excluded.updated_at'
  );

  function update(table, key, patch, detectedName) {
    if (typeof key !== 'string' || !key || key.length > 128) {
      throw new TypeError('Invalid appearance ID');
    }
    const { name, revision } = validateNamePatch(patch);
    if (table === 'service' && !serviceExists.get(key)) return null;
    const current = (table === 'service' ? serviceRow : groupRow).get(key);
    const priorRevision = current?.revision ?? 0;
    if (revision !== priorRevision) {
      const error = new Error('Appearance changed; reload and retry');
      error.code = 'appearance_conflict';
      throw error;
    }
    const updated = (current?.name ?? null) !== name;
    const nextRevision = priorRevision + (updated ? 1 : 0);
    const updatedAt = updated ? Date.now() : (current?.updated_at ?? null);
    if (updated) {
      (table === 'service' ? saveService : saveGroup).run(key, name, nextRevision, updatedAt);
    }
    return {
      name: name ?? detectedName, detectedName, customName: name,
      appearanceRevision: nextRevision, appearanceUpdatedAt: updatedAt,
    };
  }
  const saveServiceName = db.transaction((id, patch) => {
    const row = serviceExists.get(id);
    if (!row) return null;
    const detected = db.prepare('SELECT display_name FROM registry_services WHERE id = ?')
      .get(id).display_name;
    return update('service', id, patch, detected);
  });
  const saveGroupName = db.transaction((id, patch, detectedName) =>
    update('group', id, patch, detectedName)
  );

  function groupAppearances(ids) {
    const result = new Map();
    // Fetch only active presentation groups, never the entire dormant history.
    for (let offset = 0; offset < ids.length; offset += 200) {
      const batch = ids.slice(offset, offset + 200);
      const statement = db.prepare(
        'SELECT group_id, name, revision, updated_at FROM registry_group_appearance ' +
        'WHERE group_id IN (' + batch.map(() => '?').join(',') + ')'
      );
      for (const row of statement.all(...batch)) result.set(row.group_id, row);
    }
    return result;
  }

  return { saveServiceName, saveGroupName, groupAppearances };
}

module.exports = { createAppearanceStore, validateNamePatch };
