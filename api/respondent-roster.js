'use strict';

const crypto = require('crypto');
const Papa = require('papaparse');
const { nanoid } = require('nanoid');
const lifecycle = require('./lifecycle');
const { isLegacyPlaceholderRespondent } = require('./respondent-utils');

const MAX_ROSTER_SIZE = 1500;
const MAX_BATCH_SIZE = 1500;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CANONICAL_LANGUAGES = new Map([
  'english', 'spanish', 'french', 'german', 'italian', 'portuguese',
  'dutch', 'polish', 'russian', 'japanese', 'chinese', 'korean',
].map((language) => [language, language[0].toUpperCase() + language.slice(1)]));
const COMMAND_KEYS = new Set(['expectedRevision', 'updates', 'additions', 'deletions']);
const UPDATE_KEYS = new Set(['respondentId', 'name', 'email', 'language', 'canRespond']);
const ADDITION_KEYS = new Set(['name', 'email', 'language', 'canRespond']);

function rosterError(status, code, message, details) {
  return new lifecycle.LifecycleError(status, code, message, details);
}

function assertPlainObject(value, code, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw rosterError(400, code, message);
}

function assertKnownKeys(value, allowed, code) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw rosterError(400, code, 'Roster request contains immutable or unknown fields.', { fields: unknown.sort() });
}

function normalizeEditableFields(input, kind, index) {
  assertPlainObject(input, 'roster_item_invalid', `Roster ${kind} at index ${index} must be an object.`);
  assertKnownKeys(input, kind === 'update' ? UPDATE_KEYS : ADDITION_KEYS, 'roster_fields_invalid');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const email = typeof input.email === 'string' ? input.email.trim() : '';
  const languageInput = typeof input.language === 'string' ? input.language.trim() : '';
  const language = CANONICAL_LANGUAGES.get(languageInput.toLowerCase());
  if (!name || name.length > 100) throw rosterError(422, 'respondent_name_invalid', 'Each respondent name must contain 1 to 100 characters.', { index, kind });
  if (!email || email.length > 255 || !EMAIL_RE.test(email)) throw rosterError(422, 'respondent_email_invalid', 'Each respondent email must be valid and contain at most 255 characters.', { index, kind });
  if (!language || language.length > 255) throw rosterError(422, 'respondent_language_invalid', 'Each respondent language must be supported.', { index, kind });
  if (typeof input.canRespond !== 'boolean') throw rosterError(422, 'respondent_can_respond_invalid', 'Each respondent Can Respond value must be true or false.', { index, kind });
  return { name, email, language, canRespond: input.canRespond };
}

function normalizeCommand(command) {
  assertPlainObject(command, 'roster_request_invalid', 'Roster request must be an object.');
  assertKnownKeys(command, COMMAND_KEYS, 'roster_fields_invalid');
  if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0) {
    throw rosterError(400, 'roster_revision_invalid', 'A non-negative integer roster revision is required.');
  }
  const updates = command.updates === undefined ? [] : command.updates;
  const additions = command.additions === undefined ? [] : command.additions;
  const deletions = command.deletions === undefined ? [] : command.deletions;
  if (!Array.isArray(updates) || !Array.isArray(additions) || !Array.isArray(deletions)) {
    throw rosterError(400, 'roster_request_invalid', 'Updates, additions, and deletions must be arrays.');
  }
  if (updates.length + additions.length + deletions.length === 0) throw rosterError(400, 'roster_empty', 'At least one roster change is required.');
  if (updates.length + additions.length + deletions.length > MAX_BATCH_SIZE) throw rosterError(413, 'roster_batch_too_large', `A roster mutation may contain at most ${MAX_BATCH_SIZE} changes.`);

  const normalizedUpdates = updates.map((item, index) => {
    const fields = normalizeEditableFields(item, 'update', index);
    if (!Number.isSafeInteger(item.respondentId) || item.respondentId <= 0) throw rosterError(422, 'respondent_id_invalid', 'Each updated respondent requires a positive integer respondent ID.', { index });
    return { respondentId: item.respondentId, ...fields };
  });
  const normalizedAdditions = additions.map((item, index) => normalizeEditableFields(item, 'addition', index));
  const normalizedDeletions = deletions.map((respondentId, index) => {
    if (!Number.isSafeInteger(respondentId) || respondentId <= 0) throw rosterError(422, 'respondent_id_invalid', 'Each deleted respondent requires a positive integer respondent ID.', { index });
    return respondentId;
  });
  const allIds = [...normalizedUpdates.map((item) => item.respondentId), ...normalizedDeletions];
  if (new Set(allIds).size !== allIds.length) throw rosterError(422, 'respondent_id_duplicate', 'A respondent ID may appear only once in a roster mutation.');
  return { expectedRevision: command.expectedRevision, updates: normalizedUpdates, additions: normalizedAdditions, deletions: normalizedDeletions };
}

function validateFinalRoster(currentRows, command) {
  const byId = new Map(currentRows.map((row) => [Number(row.respondent_id), row]));
  const requestedIds = [...command.updates.map((item) => item.respondentId), ...command.deletions];
  const unknownIds = requestedIds.filter((id) => !byId.has(id));
  if (unknownIds.length) throw rosterError(404, 'respondent_not_found', 'One or more respondents do not belong to this survey.', { respondentIds: [...new Set(unknownIds)].sort((a, b) => a - b) });

  for (const id of requestedIds) {
    if (isLegacyPlaceholderRespondent(byId.get(id))) throw rosterError(422, 'placeholder_protected', 'The legacy placeholder respondent cannot be changed or deleted.');
  }

  const updates = new Map(command.updates.map((item) => [item.respondentId, item]));
  const deletions = new Set(command.deletions);
  const finalRows = [];
  for (const row of currentRows) {
    const id = Number(row.respondent_id);
    if (deletions.has(id)) continue;
    if (isLegacyPlaceholderRespondent(row)) {
      finalRows.push({ name: row.name, email: row.contact_info, language: row.lang, canRespond: row.can_respond, placeholder: true });
      continue;
    }
    const replacement = updates.get(id);
    finalRows.push(replacement || normalizeEditableFields({ name: row.name, email: row.contact_info, language: row.lang, canRespond: row.can_respond }, 'existing respondent', id));
  }
  finalRows.push(...command.additions);
  if (finalRows.filter((row) => !row.placeholder).length > MAX_ROSTER_SIZE) throw rosterError(422, 'roster_too_large', `A survey roster may contain at most ${MAX_ROSTER_SIZE} respondents.`);
  const names = new Set();
  for (const row of finalRows) {
    if (!row.placeholder && isLegacyPlaceholderRespondent({ name: row.name, email: row.email, canRespond: row.canRespond })) throw rosterError(422, 'placeholder_protected', 'The legacy placeholder respondent cannot be created.');
    if (names.has(row.name)) throw rosterError(409, 'respondent_name_duplicate', 'Final respondent names must be unique within the survey.');
    names.add(row.name);
  }
  return finalRows;
}

function temporaryName(respondentId, reservedNames) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const value = `~roster~${crypto.randomBytes(16).toString('hex')}~${Number(respondentId).toString(36)}`;
    if (value.length <= 100 && !reservedNames.has(value)) {
      reservedNames.add(value);
      return value;
    }
  }
  throw rosterError(500, 'temporary_name_unavailable', 'Unable to safely stage respondent renames.');
}

async function applyRosterMutation(client, survey, actorUserId, rawCommand, hooks = {}) {
  const command = normalizeCommand(rawCommand);
  if (Number(survey.lifecycle_version) !== command.expectedRevision) {
    throw rosterError(409, 'roster_stale', 'The respondent roster changed in another session. Refresh and reapply your edits.', { currentRevision: Number(survey.lifecycle_version) });
  }
  const rosterResult = await client.query(
    'SELECT respondent_id,name,contact_info,can_respond,lang,survey_name,uuid,response,email_sent FROM respondent WHERE survey_id=$1 ORDER BY respondent_id FOR UPDATE',
    [survey.id]
  );
  const currentRows = rosterResult.rows;
  validateFinalRoster(currentRows, command);
  await hooks.afterValidation?.();

  const currentById = new Map(currentRows.map((row) => [Number(row.respondent_id), row]));
  for (const respondentId of command.deletions) {
    const result = await client.query('DELETE FROM respondent WHERE respondent_id=$1 AND survey_id=$2', [respondentId, survey.id]);
    if (result.rowCount !== 1) throw rosterError(409, 'roster_stale', 'The respondent roster changed in another session. Refresh and reapply your edits.');
  }
  await hooks.afterDeletions?.();

  const renamed = command.updates.filter((item) => currentById.get(item.respondentId).name !== item.name);
  const reservedNames = new Set([...currentRows.map((row) => row.name), ...command.updates.map((row) => row.name), ...command.additions.map((row) => row.name)]);
  for (const item of renamed) {
    const result = await client.query('UPDATE respondent SET name=$1 WHERE respondent_id=$2 AND survey_id=$3', [temporaryName(item.respondentId, reservedNames), item.respondentId, survey.id]);
    if (result.rowCount !== 1) throw rosterError(409, 'roster_stale', 'The respondent roster changed in another session. Refresh and reapply your edits.');
  }
  await hooks.afterStaging?.();

  // Keep the legacy uniqueness key aligned with authoritative survey_id. This also
  // prevents stale/null survey_name rows from evading complete-roster validation.
  await client.query('UPDATE respondent SET survey_name=$1 WHERE survey_id=$2 AND survey_name IS DISTINCT FROM $1', [survey.name, survey.id]);
  for (const item of command.updates) {
    const result = await client.query(
      'UPDATE respondent SET name=$1,contact_info=$2,lang=$3,can_respond=$4,survey_name=$5 WHERE respondent_id=$6 AND survey_id=$7',
      [item.name, item.email, item.language, item.canRespond, survey.name, item.respondentId, survey.id]
    );
    if (result.rowCount !== 1) throw rosterError(409, 'roster_stale', 'The respondent roster changed in another session. Refresh and reapply your edits.');
  }
  await hooks.afterUpdates?.();

  for (const item of command.additions) {
    await client.query(
      'INSERT INTO respondent(name,contact_info,uuid,survey_name,survey_id,can_respond,lang) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [item.name, item.email, nanoid(), survey.name, survey.id, item.canRespond, item.language]
    );
  }
  await hooks.afterAdditions?.();

  const versionResult = await client.query('UPDATE survey SET lifecycle_version=lifecycle_version+1 WHERE id=$1 RETURNING lifecycle_version', [survey.id]);
  const revision = Number(versionResult.rows[0]?.lifecycle_version);
  await lifecycle.strictAudit(client, {
    organizationId: survey.organization_id,
    actorUserId,
    surveyId: survey.id,
    eventType: 'respondent.roster_updated',
    metadata: {
      previousRevision: command.expectedRevision,
      revision,
      updatedCount: command.updates.length,
      addedCount: command.additions.length,
      deletedCount: command.deletions.length,
      renamedCount: renamed.length,
    },
  });
  await hooks.afterAudit?.();
  return { revision, updatedCount: command.updates.length, addedCount: command.additions.length, deletedCount: command.deletions.length };
}

async function mutateRoster(pool, user, surveyId, command, hooks) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const survey = await lifecycle.loadAuthorizedSurvey(client, user, surveyId, 'editor', 'UPDATE');
    if (survey.archived_at || survey.lifecycle_status !== 'draft') throw rosterError(409, 'survey_not_editable', 'Survey configuration is locked after launch.');
    const result = await applyRosterMutation(client, survey, user.id, command, hooks);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error?.code === '23503') throw rosterError(409, 'respondent_delete_conflict', 'This respondent has associated delivery history and cannot be deleted.');
    if (error?.code === '23505') throw rosterError(409, 'respondent_name_duplicate', 'Final respondent names must be unique within the survey.');
    throw error;
  } finally {
    client.release();
  }
}

function parseRespondentCsv(csvData) {
  if (typeof csvData !== 'string' || !csvData.trim()) throw rosterError(400, 'csv_required', 'CSV data is required.');
  const result = Papa.parse(csvData, {
    header: true,
    skipEmptyLines: 'greedy',
    preview: MAX_BATCH_SIZE + 1,
    transformHeader: (header) => String(header).trim(),
  });
  if (result.errors.length || (result.meta.renamedHeaders && Object.keys(result.meta.renamedHeaders).length)) {
    throw rosterError(400, 'csv_invalid', 'The respondent CSV could not be parsed.', { row: result.errors[0]?.row ?? 0 });
  }
  if (result.data.length > MAX_BATCH_SIZE) throw rosterError(413, 'roster_batch_too_large', `A roster mutation may contain at most ${MAX_BATCH_SIZE} changes.`);
  const additions = result.data.map((row, index) => {
    const first = String(row.First ?? '').trim();
    const last = String(row.Last ?? '').trim();
    const rawCanRespond = row.Respondent ?? row['Can Respond'] ?? 'true';
    const normalizedCanRespond = String(rawCanRespond).trim().toLowerCase();
    if (!['true', 'false'].includes(normalizedCanRespond)) throw rosterError(422, 'respondent_can_respond_invalid', 'CSV Can Respond values must be true or false.', { index });
    return normalizeEditableFields({
      name: `${first} ${last}`.trim(),
      email: row.Email,
      language: row.Language || 'English',
      canRespond: normalizedCanRespond === 'true',
    }, 'addition', index);
  });
  if (!additions.length) throw rosterError(400, 'csv_empty', 'CSV data is empty.');
  return additions;
}

module.exports = {
  MAX_ROSTER_SIZE,
  MAX_BATCH_SIZE,
  normalizeCommand,
  validateFinalRoster,
  temporaryName,
  applyRosterMutation,
  mutateRoster,
  parseRespondentCsv,
};
