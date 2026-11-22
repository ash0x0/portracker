'use strict';

const { GLYPHS } = require('./custom-icons');

const OWN = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const HASH = /^[a-f0-9]{64}$/;
const GLYPH_SET = new Set(GLYPHS);

function validateName(name) {
  if (name === null) return null;
  if (typeof name !== 'string') throw new TypeError('Invalid appearance name');
  const cleaned = name.trim().normalize('NFC');
  // Reject invalid Unicode, newlines, controls and direction-spoofing marks.
  if (!cleaned || [...cleaned].length > 80 ||
      Buffer.from(cleaned, 'utf8').toString('utf8') !== cleaned ||
      /[\p{Cc}\p{Zl}\p{Zp}\u00ad\u061c\u200b\u200e\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(cleaned)) {
    throw new TypeError('Invalid appearance name');
  }
  return cleaned;
}

function validateIcon(icon) {
  if (icon === 'automatic') return null;
  if (!icon || typeof icon !== 'object' || Array.isArray(icon)) {
    throw new TypeError('Invalid icon choice');
  }
  if (icon.type === 'glyph' && Object.keys(icon).length === 2 &&
      typeof icon.name === 'string' && GLYPH_SET.has(icon.name)) {
    return 'glyph:' + icon.name;
  }
  if (icon.type === 'upload' && Object.keys(icon).length === 2 &&
      typeof icon.hash === 'string' && HASH.test(icon.hash)) {
    return 'upload:' + icon.hash;
  }
  throw new TypeError('Invalid icon choice');
}

function decodeIconChoice(value) {
  if (typeof value !== 'string') return { type: 'automatic' };
  if (value.startsWith('glyph:') && GLYPH_SET.has(value.slice(6))) {
    return { type: 'glyph', name: value.slice(6) };
  }
  if (value.startsWith('upload:') && HASH.test(value.slice(7))) {
    return { type: 'upload', hash: value.slice(7) };
  }
  // Fail closed on corrupt/unsupported rows, not as HTML or external URLs.
  return { type: 'automatic' };
}

function validateAppearancePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) ||
      !OWN(patch, 'revision') ||
      Object.keys(patch).some(key => !['name', 'icon', 'revision'].includes(key)) ||
      (!OWN(patch, 'name') && !OWN(patch, 'icon'))) {
    throw new TypeError('Expected name and/or icon with revision');
  }
  if (!Number.isSafeInteger(patch.revision) || patch.revision < 0) {
    throw new TypeError('Invalid appearance revision');
  }
  return {
    revision: patch.revision,
    ...(OWN(patch, 'name') ? { name: validateName(patch.name) } : {}),
    ...(OWN(patch, 'icon') ? { iconChoice: validateIcon(patch.icon) } : {}),
  };
}

// Maintains source compatibility with #76 name-only validation tests.
const validateNamePatch = validateAppearancePatch;

function createAppearanceStore(db) {
  const serviceExists = db.prepare('SELECT display_name FROM registry_services WHERE id = ?');
  const serviceRow = db.prepare(
    'SELECT name, icon_choice, revision, updated_at FROM registry_service_appearance WHERE service_id = ?'
  );
  const groupRow = db.prepare(
    'SELECT name, icon_choice, revision, updated_at FROM registry_group_appearance WHERE group_id = ?'
  );
  const getIcon = db.prepare('SELECT hash FROM registry_custom_icons WHERE hash = ?');
  const saveService = db.prepare(
    'INSERT INTO registry_service_appearance (service_id, name, icon_choice, revision, updated_at) ' +
    'VALUES (?, ?, ?, ?, ?) ON CONFLICT(service_id) DO UPDATE SET ' +
    'name = excluded.name, icon_choice = excluded.icon_choice, ' +
    'revision = excluded.revision, updated_at = excluded.updated_at'
  );
  const saveGroup = db.prepare(
    'INSERT INTO registry_group_appearance (group_id, name, icon_choice, revision, updated_at) ' +
    'VALUES (?, ?, ?, ?, ?) ON CONFLICT(group_id) DO UPDATE SET ' +
    'name = excluded.name, icon_choice = excluded.icon_choice, ' +
    'revision = excluded.revision, updated_at = excluded.updated_at'
  );
  // Atomic reference check; this handles two users selecting the same hash,
  // group overrides, forgetting a service and resetting independently.
  const deleteOrphan = db.prepare(
    'DELETE FROM registry_custom_icons WHERE hash = ? ' +
    "AND NOT EXISTS (SELECT 1 FROM registry_service_appearance a WHERE a.icon_choice = 'upload:' || ?) " +
    "AND NOT EXISTS (SELECT 1 FROM registry_group_appearance a WHERE a.icon_choice = 'upload:' || ?)"
  );
  function releaseIcon(hash) {
    if (typeof hash === 'string' && HASH.test(hash)) deleteOrphan.run(hash, hash, hash);
  }

  function update(table, key, patch, detectedName) {
    if (typeof key !== 'string' || !key || key.length > 128) {
      throw new TypeError('Invalid appearance ID');
    }
    const parsed = validateAppearancePatch(patch);
    if (table === 'service' && !serviceExists.get(key)) return null;
    const current = (table === 'service' ? serviceRow : groupRow).get(key);
    const priorRevision = current?.revision ?? 0;
    if (parsed.revision !== priorRevision) {
      const error = new Error('Appearance changed; reload and retry');
      error.code = 'appearance_conflict';
      throw error;
    }
    const name = OWN(parsed, 'name') ? parsed.name : (current?.name ?? null);
    const iconChoice = OWN(parsed, 'iconChoice') ? parsed.iconChoice :
      (current?.icon_choice ?? null);
    if (iconChoice?.startsWith('upload:') && !getIcon.get(iconChoice.slice(7))) {
      const error = new Error('Uploaded icon not found');
      error.code = 'icon_not_found';
      throw error;
    }
    const changed = (current?.name ?? null) !== name ||
      (current?.icon_choice ?? null) !== iconChoice;
    const revision = priorRevision + (changed ? 1 : 0);
    const updatedAt = changed ? Date.now() : (current?.updated_at ?? null);
    if (changed) {
      (table === 'service' ? saveService : saveGroup)
        .run(key, name, iconChoice, revision, updatedAt);
      if (current?.icon_choice?.startsWith('upload:') &&
          current.icon_choice !== iconChoice) {
        releaseIcon(current.icon_choice.slice(7));
      }
    }
    return {
      name: name ?? detectedName, detectedName, customName: name,
      iconChoice: decodeIconChoice(iconChoice),
      appearanceRevision: revision, appearanceUpdatedAt: updatedAt,
    };
  }

  const saveServiceAppearance = db.transaction((id, patch) => {
    const row = serviceExists.get(id);
    if (!row) return null;
    return update('service', id, patch, row.display_name);
  });
  const saveGroupAppearance = db.transaction((id, patch, detectedName) =>
    update('group', id, patch, detectedName)
  );

  function groupAppearances(ids) {
    const result = new Map();
    // Query only active verified groups; dormant groups may be numerous.
    for (let offset = 0; offset < ids.length; offset += 200) {
      const batch = ids.slice(offset, offset + 200);
      const statement = db.prepare(
        'SELECT group_id, name, icon_choice, revision, updated_at ' +
        'FROM registry_group_appearance WHERE group_id IN (' +
        batch.map(() => '?').join(',') + ')'
      );
      for (const row of statement.all(...batch)) result.set(row.group_id, row);
    }
    return result;
  }

  function serviceIconBeforeForget(id) {
    const choice = serviceRow.get(id)?.icon_choice;
    return typeof choice === 'string' && choice.startsWith('upload:') ?
      choice.slice(7) : null;
  }

  return {
    saveServiceAppearance, saveGroupAppearance,
    saveServiceName: saveServiceAppearance, saveGroupName: saveGroupAppearance,
    groupAppearances, releaseIcon, serviceIconBeforeForget,
  };
}

module.exports = {
  createAppearanceStore, validateAppearancePatch, validateNamePatch, decodeIconChoice,
};
