'use strict';

const crypto = require('crypto');
const { DEFAULT_SENDER, RENDERER_VERSION, normalizeTemplateText, buildInvitationPayload, payloadHash } = require('./email');
const { displayedRespondentPredicate } = require('./respondent-utils');
const {
  MAX_INSTRUCTION_CHARACTERS,
  MAX_INSTRUCTION_BYTES,
  derivedInstructions,
  effectiveInstructions,
  instructionMetadata,
  validateInstructionOverride,
} = require('./survey-instructions');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_LAUNCH_RECIPIENTS = 1000;
const MAX_LAUNCH_TEMPLATES = 100;
const ROLE_RANK = { viewer: 10, analyst: 20, editor: 30, admin: 40, owner: 50 };
let authoritativeSurveyValidator = null;
const setSurveyDefinitionValidator = (validator) => { authoritativeSurveyValidator = validator; };
const SUPPORTED_LANGUAGES = new Set([
  'english', 'spanish', 'french', 'german', 'italian', 'portuguese',
  'dutch', 'polish', 'russian', 'japanese', 'chinese', 'korean',
]);

class LifecycleError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}

function environmentName(env = process.env) {
  const value = env.EMAIL_WORKER_ENV || env.NODE_ENV || 'local';
  return value === 'production' ? 'prod' : value === 'development' || value === 'dev' ? 'local' : value;
}
function normalizeLanguage(value) { return String(value || '').trim().toLowerCase(); }
function fingerprint(input) { return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex'); }
function canRole(role, minimum) { return (ROLE_RANK[role] || 0) >= ROLE_RANK[minimum]; }
function publicError(error) { return { error: error.code || 'internal_error', message: error.message, ...(error.details ? { details: error.details } : {}) }; }

async function strictAudit(client, { organizationId, actorUserId, surveyId, eventType, metadata = {} }) {
  await client.query(`INSERT INTO audit_events(organization_id,actor_user_id,survey_id,event_type,metadata) VALUES($1,$2,$3,$4,$5::jsonb)`,
    [organizationId, actorUserId, surveyId, eventType, JSON.stringify(metadata)]);
}

async function loadAuthorizedSurvey(client, user, surveyId, minimumRole, lock = '') {
  if (!UUID_RE.test(String(surveyId || ''))) throw new LifecycleError(404, 'survey_not_found', 'Survey not found.');
  const result = await client.query(
    `SELECT s.*, om.role FROM survey s LEFT JOIN organization_memberships om ON om.organization_id=s.organization_id AND om.user_id=$1 WHERE s.id=$2 ${lock ? `FOR ${lock} OF s` : ''}`,
    [user.id, surveyId]);
  const survey = result.rows[0];
  const role = user.isPlatformAdmin || user.is_platform_admin ? 'owner' : survey?.role;
  if (!survey || !canRole(role, minimumRole)) throw new LifecycleError(404, 'survey_not_found', 'Survey not found.');
  return { ...survey, role };
}

async function loadReadinessData(client, survey) {
  // A pg Client executes one query at a time. Keep this sequential so launch
  // transactions remain compatible with pg 9 rather than relying on the
  // deprecated behavior of queueing concurrent client.query() calls.
  const recipientResult = await client.query(
    `SELECT respondent_id,name,contact_info,uuid,lang FROM respondent WHERE survey_id=$1 AND can_respond=true ORDER BY respondent_id LIMIT ${MAX_LAUNCH_RECIPIENTS + 1}`,
    [survey.id]
  );
  const templateResult = await client.query(
    `SELECT lang,text,invitation_subject FROM email WHERE survey_id=$1 ORDER BY lang LIMIT ${MAX_LAUNCH_TEMPLATES + 1}`,
    [survey.id]
  );
  const excludedResult = await client.query(
    `SELECT count(*)::int AS count FROM respondent r WHERE survey_id=$1 AND can_respond IS NOT TRUE AND ${displayedRespondentPredicate('r')}`,
    [survey.id]
  );
  return { recipients: recipientResult.rows, templates: templateResult.rows, excludedCount: Number(excludedResult.rows[0]?.count || 0) };
}

function evaluateReadiness(survey, data, config = process.env) {
  const blockers = [];
  const warnings = [];
  if (survey.archived_at) blockers.push({ code: 'survey_archived', message: 'The survey is archived.' });
  if (survey.lifecycle_status !== 'draft') blockers.push({ code: 'survey_not_draft', message: 'Only a draft survey can be launched.' });
  if (!Array.isArray(survey.questions?.elements) || survey.questions.elements.length === 0) blockers.push({ code: 'questions_missing', message: 'At least one survey question is required.' });
  else if (authoritativeSurveyValidator) {
    try { authoritativeSurveyValidator(survey.questions); }
    catch (error) { blockers.push({ code: 'questions_invalid', message: error.message || 'Survey questions are invalid.' }); }
  } else if (survey.questions.elements.some((question) => !question || typeof question !== 'object' || !String(question.name || '').trim() || !String(question.type || '').trim())) blockers.push({ code: 'questions_invalid', message: 'Every survey question requires a stable name and type.' });
  if (data.recipients.length === 0) blockers.push({ code: 'recipients_missing', message: 'At least one eligible respondent is required.' });
  if (data.recipients.length > MAX_LAUNCH_RECIPIENTS) blockers.push({ code: 'recipients_limit_exceeded', message: `A launch may contain at most ${MAX_LAUNCH_RECIPIENTS} eligible respondents.` });
  if (data.templates.length > MAX_LAUNCH_TEMPLATES) blockers.push({ code: 'templates_limit_exceeded', message: `A survey may contain at most ${MAX_LAUNCH_TEMPLATES} notification templates.` });

  const languages = new Set();
  const addresses = new Map();
  const excludedCount = Number(data.excludedCount || 0);
  for (const recipient of data.recipients) {
    const language = normalizeLanguage(recipient.lang);
    const address = String(recipient.contact_info || '').trim().toLowerCase();
    if (!EMAIL_RE.test(address)) blockers.push({ code: 'recipient_email_invalid', respondentId: recipient.respondent_id, message: 'An eligible respondent has an invalid email address.' });
    if (!recipient.uuid) blockers.push({ code: 'recipient_token_missing', respondentId: recipient.respondent_id, message: 'An eligible respondent has no invitation token.' });
    if (!language) blockers.push({ code: 'recipient_language_missing', respondentId: recipient.respondent_id, message: 'An eligible respondent has no language.' });
    else if (!SUPPORTED_LANGUAGES.has(language)) blockers.push({ code: 'recipient_language_unsupported', respondentId: recipient.respondent_id, language, message: `An eligible respondent uses unsupported language ${language}.` });
    else languages.add(language);
    if (addresses.has(address)) blockers.push({ code: 'recipient_email_duplicate', respondentId: recipient.respondent_id, message: 'Eligible respondent email addresses must be unique.' });
    addresses.set(address, recipient.respondent_id);
  }
  const templateMap = new Map();
  const templateSubjectMap = new Map();
  const templateCounts = new Map();
  for (const template of data.templates) {
    const language = normalizeLanguage(template.lang);
    if (!language) continue;
    templateCounts.set(language, (templateCounts.get(language) || 0) + 1);
    if (templateCounts.get(language) > 1) blockers.push({ code: 'template_duplicate', language, message: `More than one ${language} template is configured.` });
    const text = normalizeTemplateText(template.text);
    const subject = typeof template.invitation_subject === 'string' ? template.invitation_subject.trim() : '';
    if (text) templateMap.set(language, text);
    if (subject.length > 255) blockers.push({ code: 'template_subject_invalid', language, message: `The ${language} invitation subject must contain 255 characters or fewer.` });
    else if (subject) templateSubjectMap.set(language, subject);
    else if (text) blockers.push({ code: 'template_subject_missing', language, message: `A nonempty ${language} invitation subject is required.` });
  }
  for (const language of languages) if (!templateMap.has(language)) blockers.push({ code: 'template_missing', language, message: `A nonempty ${language} template is required.` });
  if (!config.SURVEY_URL) blockers.push({ code: 'survey_url_missing', message: 'Survey URL is not configured.' });
  if (!(config.RESEND_API_KEY || config.RESEND_KEY)) blockers.push({ code: 'provider_key_missing', message: 'Email provider is not configured.' });
  if (!(config.SURVEY_EMAIL_SENDER || DEFAULT_SENDER)) blockers.push({ code: 'sender_missing', message: 'Survey sender is not configured.' });
  const blockerCount = blockers.length;
  const publicBlockers = blockers.slice(0, 100);
  if (blockerCount > publicBlockers.length) publicBlockers.push({ code: 'blockers_truncated', message: `${blockerCount - publicBlockers.length} additional readiness blockers were omitted.` });
  const sortedLanguages = [...languages].sort();
  return {
    lifecycleStatus: survey.lifecycle_status,
    archived: Boolean(survey.archived_at),
    eligibleCount: data.recipients.length,
    excludedCount,
    languages: sortedLanguages,
    templateLanguages: [...templateMap.keys()].sort(),
    templateCoverage: sortedLanguages.map((language) => ({ language, covered: templateMap.has(language) })),
    blockers: publicBlockers,
    blockerCount,
    warnings,
    canLaunch: blockerCount === 0,
    templateMap,
    templateSubjectMap,
  };
}

async function applySuppressionReadiness(client, readiness, data, config) {
  const environment = environmentName(config);
  const control = await client.query('SELECT enforcement_enabled FROM email_suppression_control WHERE environment=$1', [environment]);
  if (!control.rows[0]?.enforcement_enabled) return readiness;
  const scope = String(config.RESEND_PROVIDER_ACCOUNT_SCOPE || '').trim();
  if (!scope) {
    readiness.blockers.push({ code:'provider_account_scope_missing', message:'Provider account scope is not configured.' });
    readiness.blockerCount += 1;
    readiness.canLaunch = false;
    return readiness;
  }
  const addresses = data.recipients.map((row) => String(row.contact_info || '').trim().toLowerCase());
  const result = await client.query(`SELECT count(DISTINCT normalized_address)::int AS suppressed_count FROM email_suppressions WHERE provider_account_scope=$1 AND normalized_address=ANY($2::text[]) AND (provider_active OR locally_overridden_at IS NULL)`, [scope,addresses]);
  const count = Number(result.rows[0]?.suppressed_count || 0);
  if (count > 0) {
    readiness.blockers.push({ code:'recipients_suppressed', count, message:`${count} eligible recipient${count === 1 ? ' is' : 's are'} suppressed. Resolve suppression before launching.` });
    readiness.blockerCount += 1;
    readiness.canLaunch = false;
  }
  return readiness;
}

async function getReadiness(pool, user, surveyId, config = process.env) {
  const client = await pool.connect();
  try {
    const survey = await loadAuthorizedSurvey(client, user, surveyId, 'editor');
    const data = await loadReadinessData(client, survey);
    const readiness = evaluateReadiness(survey, data, config);
    await applySuppressionReadiness(client, readiness, data, config);
    const env = environmentName(config);
    const maxAge = Math.max(5, Number(config.EMAIL_WORKER_HEARTBEAT_MAX_AGE_SECONDS || 45));
    const worker = await client.query(`SELECT 1 FROM email_worker_control c JOIN email_sending_control s USING(environment) WHERE c.environment=$1 AND c.claiming_enabled=true AND s.sending_enabled=true AND (s.minimum_release='' OR c.minimum_release='' OR s.minimum_release=c.minimum_release) AND EXISTS(SELECT 1 FROM email_worker_heartbeats h WHERE h.environment=c.environment AND h.enabled=true AND h.claiming=true AND h.heartbeat_at>now()-($2::text||' seconds')::interval AND (c.minimum_release='' OR h.release_revision=c.minimum_release) AND (s.minimum_release='' OR h.release_revision=s.minimum_release))`, [env,maxAge]);
    if (!worker.rowCount) readiness.blockers.push({code:'worker_unavailable',message:'No fresh compatible email worker is available.'});
    readiness.canLaunch = readiness.blockers.length === 0;
    return readiness;
  } finally { client.release(); }
}

function aggregateSelect(whereSql) {
  return `SELECT l.id,l.survey_id,l.kind,l.parent_launch_id,l.created_at,l.cancelled_at,
    count(DISTINCT d.id)::int AS target_count,
    count(DISTINCT d.id) FILTER(WHERE d.status IN ('pending','reminder_pending'))::int AS pending_count,
    count(DISTINCT d.id) FILTER(WHERE d.status IN ('leased','reminder_leased'))::int AS leased_count,
    count(DISTINCT d.id) FILTER(WHERE d.status IN ('retry_wait','reminder_retry_wait'))::int AS retry_wait_count,
    count(DISTINCT d.id) FILTER(WHERE d.status='accepted')::int AS accepted_count,
    count(DISTINCT d.id) FILTER(WHERE d.status='failed')::int AS failed_count,
    count(DISTINCT d.id) FILTER(WHERE d.status='uncertain')::int AS uncertain_count,
    count(DISTINCT d.id) FILTER(WHERE d.status='cancelled')::int AS cancelled_count,
    count(DISTINCT d.id) FILTER(WHERE d.provider_sent_at IS NOT NULL)::int AS provider_sent_count,
    count(DISTINCT d.id) FILTER(WHERE d.provider_delivered_at IS NOT NULL)::int AS provider_delivered_count,
    count(DISTINCT d.id) FILTER(WHERE d.provider_delayed_at IS NOT NULL)::int AS provider_delayed_count,
    count(DISTINCT d.id) FILTER(WHERE d.provider_bounced_at IS NOT NULL)::int AS provider_bounced_count,
    count(DISTINCT d.id) FILTER(WHERE d.provider_complained_at IS NOT NULL)::int AS provider_complained_count,
    count(DISTINCT d.id) FILTER(WHERE d.provider_suppressed_at IS NOT NULL)::int AS provider_suppressed_count,
    count(DISTINCT d.id) FILTER(WHERE d.provider_failed_at IS NOT NULL)::int AS provider_failed_count,
    count(DISTINCT d.id) FILTER(WHERE d.provider_bounced_at IS NOT NULL OR d.provider_complained_at IS NOT NULL OR d.provider_suppressed_at IS NOT NULL OR d.provider_failed_at IS NOT NULL)::int AS provider_problem_count,
    count(DISTINCT d.id) FILTER(WHERE d.status='accepted' AND d.provider_delivered_at IS NULL AND d.provider_bounced_at IS NULL AND d.provider_complained_at IS NULL AND d.provider_suppressed_at IS NULL AND d.provider_failed_at IS NULL)::int AS provider_waiting_count,
    count(DISTINCT d.id) FILTER(WHERE d.status='accepted' AND d.provider_sent_at IS NULL AND d.provider_delivered_at IS NULL AND d.provider_delayed_at IS NULL AND d.provider_bounced_at IS NULL AND d.provider_complained_at IS NULL AND d.provider_suppressed_at IS NULL AND d.provider_failed_at IS NULL)::int AS accepted_unverified_count,
    min(a.started_at) AS started_at,max(a.finished_at) FILTER(WHERE d.status IN ('accepted','failed','uncertain','cancelled')) AS finished_at,
    CASE
      WHEN count(DISTINCT d.id)>0 AND count(DISTINCT d.id) FILTER(WHERE d.status IN ('pending','reminder_pending'))=count(DISTINCT d.id) AND count(a.id)=0 THEN 'queued'
      WHEN count(DISTINCT d.id) FILTER(WHERE d.status IN ('pending','leased','retry_wait','reminder_pending','reminder_leased','reminder_retry_wait'))>0 THEN 'processing'
      WHEN count(DISTINCT d.id)>0 AND count(DISTINCT d.id) FILTER(WHERE d.status='cancelled')=count(DISTINCT d.id) THEN 'cancelled'
      WHEN count(DISTINCT d.id)>0 AND count(DISTINCT d.id) FILTER(WHERE d.status='accepted')=count(DISTINCT d.id) THEN 'completed'
      WHEN count(DISTINCT d.id)>0 AND count(DISTINCT d.id) FILTER(WHERE d.status='accepted')=0 AND count(DISTINCT d.id) FILTER(WHERE d.status IN ('failed','uncertain'))>0 THEN 'failed'
      ELSE 'completed_with_errors' END AS status
    FROM survey_launches l JOIN survey_email_deliveries d ON d.launch_id=l.id LEFT JOIN survey_email_attempts a ON a.delivery_id=d.id
    ${whereSql} GROUP BY l.id ORDER BY l.created_at DESC`;
}

async function loadReminderData(client, survey, { lockRecipients = false, providerScope = '' } = {}) {
  const scope=String(providerScope||'').trim();
  const recipients = await client.query(
    `SELECT r.respondent_id,r.name,r.contact_info,r.uuid,r.lang
       FROM respondent r
      WHERE r.survey_id=$1 AND r.can_respond=true AND r.response IS NULL
        AND ${displayedRespondentPredicate('r')}
        ${scope ? `AND NOT EXISTS(SELECT 1 FROM email_suppressions es WHERE es.provider_account_scope=$2 AND es.normalized_address=lower(btrim(r.contact_info)) AND (es.provider_active OR es.locally_overridden_at IS NULL))` : ''}
        AND NOT EXISTS(SELECT 1 FROM survey_email_deliveries prior JOIN survey_launches prior_launch ON prior_launch.id=prior.launch_id WHERE prior.survey_id=r.survey_id AND prior.respondent_id=r.respondent_id AND prior_launch.kind='reminder' AND (prior.status='uncertain' OR (prior_launch.provider_account_scope IS NULL AND prior.status IN ('reminder_pending','reminder_leased','reminder_retry_wait'))))
      ORDER BY r.respondent_id LIMIT ${MAX_LAUNCH_RECIPIENTS + 1}
      ${lockRecipients ? 'FOR SHARE OF r' : ''}`,
    scope ? [survey.id,scope] : [survey.id]
  );
  const templates = await client.query(
    `SELECT language,subject,body_text,configuration_version,updated_at
       FROM survey_reminder_templates WHERE survey_id=$1 ORDER BY language LIMIT ${MAX_LAUNCH_TEMPLATES + 1}`,
    [survey.id]
  );
  let suppressedExcludedCount=0;
  if(scope){const suppressed=await client.query(`SELECT count(*)::int AS count FROM respondent r WHERE r.survey_id=$1 AND r.can_respond=true AND r.response IS NULL AND ${displayedRespondentPredicate('r')} AND EXISTS(SELECT 1 FROM email_suppressions es WHERE es.provider_account_scope=$2 AND es.normalized_address=lower(btrim(r.contact_info)) AND (es.provider_active OR es.locally_overridden_at IS NULL))`,[survey.id,scope]);suppressedExcludedCount=Number(suppressed.rows[0]?.count||0);}
  const uncertain=await client.query(`SELECT count(DISTINCT r.respondent_id)::int AS count FROM respondent r JOIN survey_email_deliveries prior ON prior.survey_id=r.survey_id AND prior.respondent_id=r.respondent_id JOIN survey_launches prior_launch ON prior_launch.id=prior.launch_id AND prior_launch.kind='reminder' WHERE r.survey_id=$1 AND r.can_respond=true AND r.response IS NULL AND ${displayedRespondentPredicate('r')} AND prior.status='uncertain'`,[survey.id]);
  const legacyUnbound=await client.query(`SELECT count(DISTINCT r.respondent_id)::int AS count FROM respondent r JOIN survey_email_deliveries prior ON prior.survey_id=r.survey_id AND prior.respondent_id=r.respondent_id JOIN survey_launches prior_launch ON prior_launch.id=prior.launch_id AND prior_launch.kind='reminder' AND prior_launch.provider_account_scope IS NULL WHERE r.survey_id=$1 AND r.can_respond=true AND r.response IS NULL AND ${displayedRespondentPredicate('r')} AND prior.status IN ('reminder_pending','reminder_leased','reminder_retry_wait')`,[survey.id]);
  return { recipients: recipients.rows, templates: templates.rows, suppressedExcludedCount, uncertainExcludedCount:Number(uncertain.rows[0]?.count||0), legacyUnboundExcludedCount:Number(legacyUnbound.rows[0]?.count||0) };
}

function evaluateReminderReadiness(survey, data, config = process.env) {
  const blockers = [];
  if (survey.archived_at) blockers.push({ code:'survey_archived', message:'The survey is archived.' });
  if (survey.lifecycle_status !== 'active') blockers.push({ code:'survey_not_active', message:'Only a launched survey can receive reminders.' });
  if (data.recipients.length === 0) blockers.push({ code:'recipients_missing', message:'No incomplete eligible respondents can be reminded.' });
  if (data.recipients.length > MAX_LAUNCH_RECIPIENTS) blockers.push({ code:'recipients_limit_exceeded', message:`A reminder campaign may contain at most ${MAX_LAUNCH_RECIPIENTS} respondents.` });
  if (data.templates.length > MAX_LAUNCH_TEMPLATES) blockers.push({ code:'templates_limit_exceeded', message:`A survey may contain at most ${MAX_LAUNCH_TEMPLATES} reminder templates.` });
  const templateMap = new Map();
  const templateSubjectMap = new Map();
  const templateVersions = new Map();
  for (const template of data.templates) {
    const language = normalizeLanguage(template.language);
    const body = normalizeTemplateText(template.body_text);
    const subject = String(template.subject || '').trim();
    if (!language || !SUPPORTED_LANGUAGES.has(language)) blockers.push({ code:'template_language_unsupported', message:'A reminder template uses an unsupported language.' });
    else if (!body) blockers.push({ code:'template_body_missing', language, message:`The ${language} reminder body is empty.` });
    else if (!subject || subject.length > 255) blockers.push({ code:'template_subject_invalid', language, message:`The ${language} reminder subject is missing or too long.` });
    else { templateMap.set(language, body); templateSubjectMap.set(language, subject); templateVersions.set(language, Number(template.configuration_version)); }
  }
  const languages = new Set();
  let invalidEmailCount=0, missingTokenCount=0, unsupportedLanguageCount=0, duplicateAddressCount=0;
  const addresses=new Set();
  for (const recipient of data.recipients) {
    const language=normalizeLanguage(recipient.lang);
    const address=String(recipient.contact_info || '').trim().toLowerCase();
    languages.add(language);
    if (!EMAIL_RE.test(address)) invalidEmailCount += 1;
    if (addresses.has(address)) duplicateAddressCount += 1;
    addresses.add(address);
    if (!recipient.uuid) missingTokenCount += 1;
    if (!SUPPORTED_LANGUAGES.has(language)) unsupportedLanguageCount += 1;
  }
  if (invalidEmailCount) blockers.push({code:'recipient_email_invalid',count:invalidEmailCount,message:`${invalidEmailCount} target respondent${invalidEmailCount===1?' has':'s have'} an invalid email address.`});
  if (duplicateAddressCount) blockers.push({code:'recipient_email_duplicate',count:duplicateAddressCount,message:`${duplicateAddressCount} target respondent email address${duplicateAddressCount===1?' is':'es are'} duplicated.`});
  if (missingTokenCount) blockers.push({code:'recipient_token_missing',count:missingTokenCount,message:`${missingTokenCount} target respondent${missingTokenCount===1?' has':'s have'} no existing survey link.`});
  if (unsupportedLanguageCount) blockers.push({code:'recipient_language_unsupported',count:unsupportedLanguageCount,message:`${unsupportedLanguageCount} target respondent${unsupportedLanguageCount===1?' uses':'s use'} an unsupported language.`});
  for (const language of languages) if (SUPPORTED_LANGUAGES.has(language) && !templateMap.has(language)) blockers.push({code:'template_missing',language,message:`A complete ${language} reminder template is required.`});
  if (!config.SURVEY_URL) blockers.push({code:'survey_url_missing',message:'Survey URL is not configured.'});
  if (!(config.RESEND_API_KEY||config.RESEND_KEY)) blockers.push({code:'provider_key_missing',message:'Email provider is not configured.'});
  if (!(config.SURVEY_EMAIL_SENDER||DEFAULT_SENDER)) blockers.push({code:'sender_missing',message:'Survey sender is not configured.'});
  const providerScope=String(config.RESEND_PROVIDER_ACCOUNT_SCOPE||'').trim();
  if (!providerScope) blockers.push({code:'provider_account_scope_missing',message:'Provider account scope is not configured.'});
  else if(providerScope.length>128) blockers.push({code:'provider_account_scope_invalid',message:'Provider account scope is invalid.'});
  return { lifecycleStatus:survey.lifecycle_status, archived:Boolean(survey.archived_at), eligibleIncompleteCount:data.recipients.length, targetCount:data.recipients.length, languages:[...languages].filter(Boolean).sort(), templateCoverage:[...languages].filter(Boolean).sort().map(language=>({language,covered:templateMap.has(language)})), blockers, blockerCount:blockers.length, warnings:[], canLaunch:blockers.length===0, templateMap, templateSubjectMap, templateVersions };
}

async function requireFreshWorker(client, config, readiness) {
  const env=environmentName(config);const maxAge=Math.max(5,Number(config.EMAIL_WORKER_HEARTBEAT_MAX_AGE_SECONDS||45));
  const scope=String(config.RESEND_PROVIDER_ACCOUNT_SCOPE||'').trim();
  const worker=await client.query(`SELECT 1 FROM email_worker_control c JOIN email_sending_control s USING(environment) WHERE c.environment=$1 AND c.claiming_enabled=true AND s.sending_enabled=true AND (s.minimum_release='' OR c.minimum_release='' OR s.minimum_release=c.minimum_release) AND EXISTS(SELECT 1 FROM email_worker_heartbeats h WHERE h.environment=c.environment AND h.enabled=true AND h.claiming=true AND h.reminder_capable=true AND h.provider_account_scope=$3 AND h.heartbeat_at>now()-($2::text||' seconds')::interval AND (c.minimum_release='' OR h.release_revision=c.minimum_release) AND (s.minimum_release='' OR h.release_revision=s.minimum_release))`,[env,maxAge,scope]);
  if(!worker.rowCount) readiness.blockers.push({code:'worker_unavailable',message:'No fresh compatible email worker is available.'});
  readiness.blockerCount=readiness.blockers.length;readiness.canLaunch=readiness.blockers.length===0;
}

async function getReminderReadiness(pool,user,surveyId,config=process.env){const client=await pool.connect();try{const survey=await loadAuthorizedSurvey(client,user,surveyId,'admin');const data=await loadReminderData(client,survey,{providerScope:config.RESEND_PROVIDER_ACCOUNT_SCOPE});const suppressedExcludedCount=data.suppressedExcludedCount;const uncertainExcludedCount=data.uncertainExcludedCount;const legacyUnboundExcludedCount=data.legacyUnboundExcludedCount;const readiness=evaluateReminderReadiness(survey,data,config);readiness.suppressedExcludedCount=suppressedExcludedCount;readiness.uncertainExcludedCount=uncertainExcludedCount;readiness.legacyUnboundExcludedCount=legacyUnboundExcludedCount;if(suppressedExcludedCount)readiness.warnings.push({code:'suppressed_excluded',count:suppressedExcludedCount,message:`${suppressedExcludedCount} suppressed respondent${suppressedExcludedCount===1?' was':'s were'} excluded.`});if(uncertainExcludedCount)readiness.warnings.push({code:'uncertain_excluded',count:uncertainExcludedCount,message:`${uncertainExcludedCount} respondent${uncertainExcludedCount===1?' was':'s were'} excluded because an earlier reminder has an unresolved provider outcome.`});if(legacyUnboundExcludedCount)readiness.warnings.push({code:'legacy_unbound_excluded',count:legacyUnboundExcludedCount,message:`${legacyUnboundExcludedCount} respondent${legacyUnboundExcludedCount===1?' was':'s were'} excluded because pre-binding reminder work is safely quarantined.`});await requireFreshWorker(client,config,readiness);delete readiness.templateMap;delete readiness.templateSubjectMap;delete readiness.templateVersions;return readiness;}finally{client.release();}}

async function listReminderTemplates(pool,user,surveyId){const client=await pool.connect();try{const survey=await loadAuthorizedSurvey(client,user,surveyId,'admin');const result=await client.query(`SELECT language,subject,body_text AS body,configuration_version::int AS version,updated_at FROM survey_reminder_templates WHERE survey_id=$1 ORDER BY language`,[survey.id]);return {surveyId:survey.id,lifecycleStatus:survey.lifecycle_status,editable:!survey.archived_at&&survey.lifecycle_status==='active',templates:result.rows};}finally{client.release();}}

async function saveReminderTemplate(pool,user,surveyId,{language,subject,body,expectedVersion}){language=normalizeLanguage(language);subject=String(subject||'').trim();body=normalizeTemplateText(body);expectedVersion=Number(expectedVersion);if(!SUPPORTED_LANGUAGES.has(language)||!subject||subject.length>255||!body||body.length>2555||!Number.isSafeInteger(expectedVersion)||expectedVersion<0)throw new LifecycleError(400,'reminder_template_invalid','Language, subject, body, and expectedVersion are required and must be valid.');const client=await pool.connect();try{await client.query('BEGIN');await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[`survey-provider-boundary:${String(surveyId).toLowerCase()}`]);const survey=await loadAuthorizedSurvey(client,user,surveyId,'admin','UPDATE');if(survey.archived_at||survey.lifecycle_status!=='active')throw new LifecycleError(409,'survey_not_active','Reminder templates are editable only while the survey is launched.');const current=(await client.query(`SELECT configuration_version FROM survey_reminder_templates WHERE survey_id=$1 AND language=$2 FOR UPDATE`,[survey.id,language])).rows[0];const version=Number(current?.configuration_version||0);if(version!==expectedVersion)throw new LifecycleError(409,'template_version_conflict','The reminder template changed. Reload before saving.',{currentVersion:version});const saved=(await client.query(`INSERT INTO survey_reminder_templates(survey_id,language,subject,body_text,configuration_version,updated_by_user_id) VALUES($1,$2,$3,$4,1,$5) ON CONFLICT(survey_id,language) DO UPDATE SET subject=excluded.subject,body_text=excluded.body_text,configuration_version=survey_reminder_templates.configuration_version+1,updated_at=now(),updated_by_user_id=excluded.updated_by_user_id RETURNING language,subject,body_text AS body,configuration_version::int AS version,updated_at`,[survey.id,language,subject,body,user.id])).rows[0];await strictAudit(client,{organizationId:survey.organization_id,actorUserId:user.id,surveyId:survey.id,eventType:'survey.reminder_template_saved',metadata:{language,version:Number(saved.version)}});await client.query('COMMIT');return saved;}catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}}

async function launchReminder(pool,user,surveyId,{idempotencyKey}={},config=process.env){if(!UUID_RE.test(String(idempotencyKey||'')))throw new LifecycleError(400,'idempotency_key_invalid','Idempotency-Key must be a UUID.');const client=await pool.connect();try{await client.query('BEGIN');const env=environmentName(config);const control=(await client.query('SELECT * FROM email_worker_control WHERE environment=$1 FOR SHARE',[env])).rows[0];const sending=(await client.query('SELECT * FROM email_sending_control WHERE environment=$1 FOR SHARE',[env])).rows[0];await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[`survey-provider-boundary:${String(surveyId).toLowerCase()}`]);const survey=await loadAuthorizedSurvey(client,user,surveyId,'admin','UPDATE');const requestFingerprint=fingerprint({organizationId:survey.organization_id,surveyId:survey.id,kind:'reminder'});const replay=await client.query('SELECT id,request_fingerprint FROM survey_launches WHERE organization_id=$1 AND idempotency_key=$2',[survey.organization_id,idempotencyKey]);if(replay.rows[0]){if(replay.rows[0].request_fingerprint!==requestFingerprint)throw new LifecycleError(409,'idempotency_conflict','Idempotency-Key was already used for different launch inputs.');const result=await client.query(aggregateSelect('WHERE l.id=$1'),[replay.rows[0].id]);await client.query('COMMIT');return {...result.rows[0],lifecycleStatus:survey.lifecycle_status,replayed:true};}if(!control||!sending?.sending_enabled)throw new LifecycleError(503,'sending_disabled','Application email sending is disabled.');const activeCampaign=await client.query(`SELECT 1 FROM survey_launches l JOIN survey_email_deliveries d ON d.launch_id=l.id WHERE l.survey_id=$1 AND l.kind='reminder' AND l.provider_account_scope IS NOT NULL AND d.status IN ('pending','leased','retry_wait','reminder_pending','reminder_leased','reminder_retry_wait') LIMIT 1`,[survey.id]);if(activeCampaign.rowCount)throw new LifecycleError(409,'reminder_in_progress','Wait for the current reminder campaign to finish before starting another.');const data=await loadReminderData(client,survey,{lockRecipients:true,providerScope:config.RESEND_PROVIDER_ACCOUNT_SCOPE});const suppressedExcludedCount=data.suppressedExcludedCount;const uncertainExcludedCount=data.uncertainExcludedCount;const legacyUnboundExcludedCount=data.legacyUnboundExcludedCount;const readiness=evaluateReminderReadiness(survey,data,config);readiness.suppressedExcludedCount=suppressedExcludedCount;readiness.uncertainExcludedCount=uncertainExcludedCount;readiness.legacyUnboundExcludedCount=legacyUnboundExcludedCount;if(suppressedExcludedCount)readiness.warnings.push({code:'suppressed_excluded',count:suppressedExcludedCount,message:`${suppressedExcludedCount} suppressed respondent${suppressedExcludedCount===1?' was':'s were'} excluded.`});if(uncertainExcludedCount)readiness.warnings.push({code:'uncertain_excluded',count:uncertainExcludedCount,message:`${uncertainExcludedCount} respondent${uncertainExcludedCount===1?' was':'s were'} excluded because an earlier reminder has an unresolved provider outcome.`});if(legacyUnboundExcludedCount)readiness.warnings.push({code:'legacy_unbound_excluded',count:legacyUnboundExcludedCount,message:`${legacyUnboundExcludedCount} respondent${legacyUnboundExcludedCount===1?' was':'s were'} excluded because pre-binding reminder work is safely quarantined.`});await requireFreshWorker(client,config,readiness);if(!readiness.canLaunch)throw new LifecycleError(422,'survey_not_ready','Reminder campaign is not ready to launch.',{...readiness,templateMap:undefined,templateSubjectMap:undefined,templateVersions:undefined});const providerAccountScope=String(config.RESEND_PROVIDER_ACCOUNT_SCOPE||'').trim();const launch=(await client.query(`INSERT INTO survey_launches(survey_id,organization_id,kind,idempotency_key,request_fingerprint,requested_by_user_id,provider_account_scope) VALUES($1,$2,'reminder',$3,$4,$5,$6) RETURNING id,created_at`,[survey.id,survey.organization_id,idempotencyKey,requestFingerprint,user.id,providerAccountScope])).rows[0];const sender=config.SURVEY_EMAIL_SENDER||DEFAULT_SENDER;for(const [language,bodyText] of readiness.templateMap){await client.query(`INSERT INTO survey_launch_templates(launch_id,language,subject,body_text,template_hash) VALUES($1,$2,$3,$4,$5)`,[launch.id,language,readiness.templateSubjectMap.get(language),bodyText,fingerprint(bodyText)]);}for(const recipient of data.recipients){const language=normalizeLanguage(recipient.lang);const bodyText=readiness.templateMap.get(language);const subject=readiness.templateSubjectMap.get(language);const deliveryId=crypto.randomUUID();const payload=buildInvitationPayload({to:String(recipient.contact_info).trim().toLowerCase(),sender,subject,bodyText,surveyBaseUrl:config.SURVEY_URL,surveyName:survey.name,token:recipient.uuid,language,deliveryId,environment:env,rendererVersion:RENDERER_VERSION});await client.query(`INSERT INTO survey_email_deliveries(id,launch_id,survey_id,organization_id,respondent_id,to_address,recipient_display_name,language,sender,subject,template_hash,survey_base_url,renderer_version,render_inputs,expected_payload_hash,provider_idempotency_key,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,'reminder_pending')`,[deliveryId,launch.id,survey.id,survey.organization_id,recipient.respondent_id,String(recipient.contact_info).trim().toLowerCase(),recipient.name,language,sender,subject,fingerprint(bodyText),config.SURVEY_URL,RENDERER_VERSION,JSON.stringify({surveyName:survey.name}),payloadHash(payload),`survey-delivery-${deliveryId}`]);}await strictAudit(client,{organizationId:survey.organization_id,actorUserId:user.id,surveyId:survey.id,eventType:'survey.reminder_launch_requested',metadata:{launchId:launch.id,targetCount:data.recipients.length}});await client.query('COMMIT');return{id:launch.id,survey_id:survey.id,kind:'reminder',status:'queued',target_count:data.recipients.length,pending_count:data.recipients.length,leased_count:0,retry_wait_count:0,accepted_count:0,failed_count:0,uncertain_count:0,cancelled_count:0,created_at:launch.created_at,lifecycleStatus:'active',replayed:false};}catch(error){await client.query('ROLLBACK').catch(()=>{});if(error.code==='23505')throw new LifecycleError(409,'launch_conflict','Reminder launch conflicted with another request.');throw error;}finally{client.release();}}

async function launchSurvey(pool, user, surveyId, { kind = 'initial', idempotencyKey, legacy = false } = {}, config = process.env) {
  if (config.SURVEY_DELIVERY_V2_ENABLED !== 'true') throw new LifecycleError(503, 'launch_disabled', 'Durable survey launch is not enabled.');
  if (kind === 'reminder') return launchReminder(pool, user, surveyId, { idempotencyKey }, config);
  if (kind !== 'initial') throw new LifecycleError(400, 'launch_kind_invalid', 'Launch kind is invalid.');
  if (!legacy && !UUID_RE.test(String(idempotencyKey || ''))) throw new LifecycleError(400, 'idempotency_key_invalid', 'Idempotency-Key must be a UUID.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const env = environmentName(config);
    const controlResult = await client.query('SELECT * FROM email_worker_control WHERE environment=$1 FOR SHARE', [env]);
    if (!controlResult.rows[0]) throw new LifecycleError(503, 'worker_unavailable', 'Email worker control is not configured.');
    const sendingResult = await client.query('SELECT * FROM email_sending_control WHERE environment=$1 FOR SHARE', [env]);
    if (!sendingResult.rows[0]?.sending_enabled || (sendingResult.rows[0].minimum_release && controlResult.rows[0].minimum_release && sendingResult.rows[0].minimum_release !== controlResult.rows[0].minimum_release)) throw new LifecycleError(503, 'sending_disabled', 'Application email sending is disabled.');
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[`survey-provider-boundary:${String(surveyId).toLowerCase()}`]);
    const survey = await loadAuthorizedSurvey(client, user, surveyId, 'editor', 'UPDATE');
    const data = await loadReadinessData(client, survey);
    const targetIds = data.recipients.map((row) => Number(row.respondent_id)).sort((a,b) => a-b);
    const requestFingerprint = fingerprint({ organizationId: survey.organization_id, surveyId: survey.id, kind, parentLaunchId: null, targetIds });
    const effectiveKey = legacy ? `initial/${survey.id}` : idempotencyKey;
    const replay = await client.query('SELECT id,request_fingerprint FROM survey_launches WHERE organization_id=$1 AND idempotency_key=$2', [survey.organization_id, effectiveKey]);
    if (replay.rows[0]) {
      if (replay.rows[0].request_fingerprint !== requestFingerprint) throw new LifecycleError(409, 'idempotency_conflict', 'Idempotency-Key was already used for different launch inputs.');
      const result = await client.query(aggregateSelect('WHERE l.id=$1'), [replay.rows[0].id]);
      await client.query('COMMIT');
      return { ...result.rows[0], lifecycleStatus: survey.lifecycle_status, replayed: true };
    }
    const existingInitial = await client.query("SELECT id FROM survey_launches WHERE survey_id=$1 AND kind='initial'", [survey.id]);
    if (existingInitial.rows[0]) {
      const result = await client.query(aggregateSelect('WHERE l.id=$1'), [existingInitial.rows[0].id]);
      await client.query('COMMIT');
      return { ...result.rows[0], lifecycleStatus: survey.lifecycle_status, replayed: true };
    }
    const heartbeatSeconds = Math.max(5, Number(config.EMAIL_WORKER_HEARTBEAT_MAX_AGE_SECONDS || 45));
    const requiredRelease = sendingResult.rows[0].minimum_release || controlResult.rows[0].minimum_release || '';
    const heartbeat = await client.query(`SELECT 1 FROM email_worker_heartbeats WHERE environment=$1 AND enabled=true AND claiming=true AND heartbeat_at > now()-($2::text||' seconds')::interval AND ($3='' OR release_revision = $3) LIMIT 1`, [env, heartbeatSeconds, requiredRelease]);
    if (!controlResult.rows[0].claiming_enabled || heartbeat.rowCount === 0) throw new LifecycleError(503, 'worker_unavailable', 'No fresh compatible email worker is available.');
    const readiness = evaluateReadiness(survey, data, config);
    await applySuppressionReadiness(client, readiness, data, config);
    if (!readiness.canLaunch) throw new LifecycleError(422, 'survey_not_ready', 'Survey is not ready to launch.', readiness);

    const launchResult = await client.query(`INSERT INTO survey_launches(survey_id,organization_id,kind,idempotency_key,request_fingerprint,requested_by_user_id) VALUES($1,$2,'initial',$3,$4,$5) RETURNING id,created_at`, [survey.id,survey.organization_id,effectiveKey,requestFingerprint,user.id]);
    const launch = launchResult.rows[0];
    const sender = config.SURVEY_EMAIL_SENDER || DEFAULT_SENDER;
    for (const [language, bodyText] of readiness.templateMap) {
      const subject = readiness.templateSubjectMap.get(language);
      await client.query('INSERT INTO survey_launch_templates(launch_id,language,subject,body_text,template_hash) VALUES($1,$2,$3,$4,$5)', [launch.id,language,subject,bodyText,fingerprint(bodyText)]);
    }
    for (const recipient of data.recipients) {
      const language = normalizeLanguage(recipient.lang);
      const bodyText = readiness.templateMap.get(language);
      const subject = readiness.templateSubjectMap.get(language);
      const deliveryId = crypto.randomUUID();
      const payload = buildInvitationPayload({ to:String(recipient.contact_info).trim().toLowerCase(),sender,subject,bodyText,surveyBaseUrl:config.SURVEY_URL,surveyName:survey.name,token:recipient.uuid,language,deliveryId,environment:env,rendererVersion:RENDERER_VERSION });
      await client.query(`INSERT INTO survey_email_deliveries(id,launch_id,survey_id,organization_id,respondent_id,to_address,recipient_display_name,language,sender,subject,template_hash,survey_base_url,renderer_version,render_inputs,expected_payload_hash,provider_idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16)`, [deliveryId,launch.id,survey.id,survey.organization_id,recipient.respondent_id,String(recipient.contact_info).trim().toLowerCase(),recipient.name,language,sender,subject,fingerprint(bodyText),config.SURVEY_URL,RENDERER_VERSION,JSON.stringify({surveyName:survey.name}),payloadHash(payload),`survey-delivery-${deliveryId}`]);
    }
    await client.query(`UPDATE survey SET lifecycle_status='active',started_at=now(),started_by_user_id=$1,closed_at=NULL,closed_by_user_id=NULL,lifecycle_version=lifecycle_version+1 WHERE id=$2`, [user.id,survey.id]);
    await strictAudit(client,{organizationId:survey.organization_id,actorUserId:user.id,surveyId:survey.id,eventType:'survey.launch_requested',metadata:{launchId:launch.id,targetCount:data.recipients.length}});
    await strictAudit(client,{organizationId:survey.organization_id,actorUserId:user.id,surveyId:survey.id,eventType:'survey.lifecycle_changed',metadata:{from:'draft',to:'active',launchId:launch.id}});
    await client.query('COMMIT');
    return { id:launch.id,survey_id:survey.id,kind,status:'queued',target_count:data.recipients.length,pending_count:data.recipients.length,leased_count:0,retry_wait_count:0,accepted_count:0,failed_count:0,uncertain_count:0,cancelled_count:0,provider_sent_count:0,provider_delivered_count:0,provider_delayed_count:0,provider_bounced_count:0,provider_complained_count:0,provider_suppressed_count:0,provider_failed_count:0,provider_problem_count:0,provider_waiting_count:0,accepted_unverified_count:0,created_at:launch.created_at,lifecycleStatus:'active',replayed:false };
  } catch (error) { await client.query('ROLLBACK').catch(()=>{}); if (error.code === '23505') throw new LifecycleError(409,'launch_conflict','An initial launch already exists.'); throw error; }
  finally { client.release(); }
}

async function listLaunches(pool,user,surveyId,launchId) {
  const client=await pool.connect();
  try { await loadAuthorizedSurvey(client,user,surveyId,'viewer'); const params=[surveyId]; let where='WHERE l.survey_id=$1'; if(launchId){params.push(launchId);where+=' AND l.id=$2';} const result=await client.query(aggregateSelect(where),params); if(launchId&&!result.rows[0]) throw new LifecycleError(404,'launch_not_found','Launch not found.'); return launchId?result.rows[0]:result.rows; } finally { client.release(); }
}

async function listDeliveries(pool,user,surveyId,{status,cursor,limit=50}={}) {
  const client=await pool.connect();
  try { await loadAuthorizedSurvey(client,user,surveyId,'analyst'); const values=[surveyId]; const clauses=['d.survey_id=$1'];
    if(status){values.push(status);clauses.push(`d.status=$${values.length}`);} if(cursor){values.push(cursor);clauses.push(`d.id < $${values.length}`);} values.push(Math.min(100,Math.max(1,Number(limit)||50)));
    const result=await client.query(`SELECT d.id,d.launch_id,d.respondent_id,d.recipient_display_name,d.to_address,d.language,d.status,d.attempt_count,d.dispatch_accepted_at,d.dispatch_failed_at,d.provider_sent_at,d.provider_delivered_at,d.provider_delayed_at,d.provider_bounced_at,d.provider_complained_at,d.provider_suppressed_at,d.provider_failed_at,CASE WHEN d.provider_complained_at IS NOT NULL THEN 'complained' WHEN d.provider_bounced_at IS NOT NULL THEN 'bounced' WHEN d.provider_suppressed_at IS NOT NULL THEN 'suppressed' WHEN d.provider_failed_at IS NOT NULL THEN 'failed' WHEN d.provider_delivered_at IS NOT NULL THEN 'delivered' WHEN d.provider_delayed_at IS NOT NULL THEN 'delayed' WHEN d.provider_sent_at IS NOT NULL THEN 'sent' WHEN d.status='accepted' THEN 'accepted_unverified' ELSE NULL END AS provider_outcome,d.last_error_code,d.last_error_message,d.created_at,d.updated_at,(SELECT max(started_at) FROM survey_email_attempts WHERE delivery_id=d.id) AS last_attempt_at FROM survey_email_deliveries d WHERE ${clauses.join(' AND ')} ORDER BY d.id DESC LIMIT $${values.length}`,values);
    return {deliveries:result.rows,nextCursor:result.rows.length===values[values.length-1]?result.rows.at(-1).id:null};
  } finally {client.release();}
}

async function transitionSurvey(pool,user,surveyId,action) {
  const minimum=action==='reopen'?'admin':action==='archive'?'admin':'editor'; const client=await pool.connect();
  try { await client.query('BEGIN'); await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[`survey-provider-boundary:${String(surveyId).toLowerCase()}`]); const survey=await loadAuthorizedSurvey(client,user,surveyId,minimum,'UPDATE');
    if(action!=='archive'&&survey.archived_at) throw new LifecycleError(404,'survey_not_found','Survey not found.');
    if(action==='close'&&survey.lifecycle_status!=='active') throw new LifecycleError(409,'lifecycle_conflict','Only a launched survey can be closed.');
    if(action==='reopen'&&survey.lifecycle_status!=='closed') throw new LifecycleError(409,'lifecycle_conflict','Only a closed survey can be reopened.');
    if(action==='archive'&&survey.archived_at) throw new LifecycleError(404,'survey_not_found','Survey not found.');
    if(action==='close'||action==='archive') {
      await client.query(`UPDATE survey_email_deliveries d SET status=CASE WHEN d.status IN ('pending','retry_wait','reminder_pending','reminder_retry_wait') AND EXISTS(SELECT 1 FROM survey_email_attempts a WHERE a.delivery_id=d.id AND a.outcome='uncertain' AND a.provider_started_at IS NOT NULL) THEN 'uncertain' WHEN d.status IN ('pending','retry_wait','reminder_pending','reminder_retry_wait') THEN 'cancelled' ELSE d.status END,cancellation_requested_at=CASE WHEN d.status IN ('leased','reminder_leased') THEN now() ELSE d.cancellation_requested_at END,dispatch_failed_at=CASE WHEN d.status IN ('pending','retry_wait','reminder_pending','reminder_retry_wait') AND EXISTS(SELECT 1 FROM survey_email_attempts a WHERE a.delivery_id=d.id AND a.outcome='uncertain' AND a.provider_started_at IS NOT NULL) THEN COALESCE(d.dispatch_failed_at,now()) ELSE d.dispatch_failed_at END,updated_at=now(),last_error_code=CASE WHEN d.status IN ('pending','retry_wait','reminder_pending','reminder_retry_wait') AND EXISTS(SELECT 1 FROM survey_email_attempts a WHERE a.delivery_id=d.id AND a.outcome='uncertain' AND a.provider_started_at IS NOT NULL) THEN d.last_error_code WHEN d.status IN ('pending','retry_wait','reminder_pending','reminder_retry_wait') THEN $2 ELSE d.last_error_code END WHERE d.survey_id=$1 AND d.status IN ('pending','retry_wait','leased','reminder_pending','reminder_retry_wait','reminder_leased')`,[survey.id,action==='close'?'survey_closed':'survey_archived']);
      await client.query('UPDATE survey_launches SET cancelled_at=COALESCE(cancelled_at,now()) WHERE survey_id=$1 AND cancelled_at IS NULL',[survey.id]);
    }
    let next;
    if(action==='close'){next='closed';await client.query(`UPDATE survey SET lifecycle_status='closed',closed_at=now(),closed_by_user_id=$1,lifecycle_version=lifecycle_version+1 WHERE id=$2`,[user.id,survey.id]);}
    else if(action==='reopen'){next='active';await client.query(`UPDATE survey SET lifecycle_status='active',closed_at=NULL,closed_by_user_id=NULL,lifecycle_version=lifecycle_version+1 WHERE id=$1`,[survey.id]);}
    else {next=survey.lifecycle_status;await client.query(`UPDATE survey SET archived_at=now(),archived_by_user_id=$1,lifecycle_version=lifecycle_version+1 WHERE id=$2`,[user.id,survey.id]);}
    await strictAudit(client,{organizationId:survey.organization_id,actorUserId:user.id,surveyId:survey.id,eventType:action==='archive'?'survey.archived':'survey.lifecycle_changed',metadata:action==='archive'?{lifecycleStatus:survey.lifecycle_status}:{from:survey.lifecycle_status,to:next}});
    await client.query('COMMIT'); return {surveyId:survey.id,lifecycleStatus:next,archived:action==='archive'};
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}

async function withEditableSurvey(pool,user,surveyId,mutation) {
  const client=await pool.connect();
  try {await client.query('BEGIN');const survey=await loadAuthorizedSurvey(client,user,surveyId,'editor','UPDATE');if(survey.archived_at||survey.lifecycle_status!=='draft')throw new LifecycleError(409,'survey_not_editable','Survey configuration is locked after launch.');const value=await mutation(client,survey);await client.query('COMMIT');return value;}catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}

function instructionResponse(survey) {
  return {
    surveyId: survey.id,
    instructions: survey.instructions,
    derivedInstructions: derivedInstructions(survey.name, survey.title, survey.display_name),
    effectiveInstructions: effectiveInstructions(survey.instructions, survey.name, survey.title, survey.display_name),
    mode: instructionMetadata(survey.instructions).presence,
    lifecycleStatus: survey.lifecycle_status,
    limits: { characters: MAX_INSTRUCTION_CHARACTERS, bytes: MAX_INSTRUCTION_BYTES },
  };
}

async function getSurveyInstructions(pool, user, surveyId) {
  const client = await pool.connect();
  try {
    return instructionResponse(await loadAuthorizedSurvey(client, user, surveyId, 'viewer'));
  } finally {
    client.release();
  }
}

async function updateSurveyInstructions(pool, user, surveyId, value, expectedValue) {
  const instructions = validateInstructionOverride(value);
  if (expectedValue !== null && typeof expectedValue !== 'string') {
    const error = new TypeError('Expected instructions must be a string or null.');
    error.code = 'instructions_type';
    throw error;
  }
  const expectedInstructions = expectedValue;
  return withEditableSurvey(pool, user, surveyId, async (client, survey) => {
    if (survey.instructions !== expectedInstructions) {
      throw new LifecycleError(409, 'instructions_conflict', 'Survey instructions changed since you loaded them. Reload before saving your draft.');
    }
    const previous = instructionMetadata(survey.instructions);
    const next = instructionMetadata(instructions);
    await client.query('UPDATE survey SET instructions=$1 WHERE id=$2', [instructions, survey.id]);
    await strictAudit(client, {
      organizationId: survey.organization_id,
      actorUserId: user.id,
      surveyId: survey.id,
      eventType: 'survey.instructions_updated',
      metadata: {
        changed: survey.instructions !== instructions,
        previousPresence: previous.presence,
        nextPresence: next.presence,
        previousCharacterLength: previous.characterLength,
        nextCharacterLength: next.characterLength,
        previousByteLength: previous.byteLength,
        nextByteLength: next.byteLength,
      },
    });
    return instructionResponse({ ...survey, instructions });
  });
}

module.exports={LifecycleError,publicError,environmentName,normalizeLanguage,fingerprint,strictAudit,loadAuthorizedSurvey,evaluateReadiness,evaluateReminderReadiness,getReadiness,getReminderReadiness,listReminderTemplates,saveReminderTemplate,launchReminder,launchSurvey,listLaunches,listDeliveries,transitionSurvey,withEditableSurvey,getSurveyInstructions,updateSurveyInstructions,aggregateSelect,setSurveyDefinitionValidator};
