'use strict';

const fs = require('fs');
const path = require('path');

const releaseDir = path.resolve(process.argv[2] || '.');
const checkDatabase = process.argv.includes('--database');
const requireProdSecondaryResendIsolation = process.argv.includes('--require-prod-secondary-resend-isolation');
const runtimeApiDirIndex = process.argv.indexOf('--runtime-api-dir');
if (runtimeApiDirIndex >= 0 && !process.argv[runtimeApiDirIndex + 1]) throw new Error('--runtime-api-dir requires a path');
const runtimeApiDir = runtimeApiDirIndex >= 0
  ? path.resolve(process.argv[runtimeApiDirIndex + 1])
  : path.join(releaseDir, 'api');
const markerPath = path.join(releaseDir, 'deploy', 'CAPABILITIES.json');
const required = ['webhook_ingest', 'webhook_projection', 'suppression_enforcement'];

let marker;
try {
  marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
} catch (_) {
  throw new Error('release is missing a valid deploy/CAPABILITIES.json marker');
}
if (marker.format_version !== 1) throw new Error('unsupported capability marker format');
if (requireProdSecondaryResendIsolation && marker.prod_secondary_resend_isolation !== 1) {
  throw new Error('release lacks required prod-secondary Resend isolation capability');
}
for (const capability of required) {
  if (!Number.isSafeInteger(marker[capability]) || marker[capability] < 1) {
    throw new Error(`release lacks required ${capability} capability`);
  }
}
if (marker.reminder_provider_boundary !== undefined && (!Number.isSafeInteger(marker.reminder_provider_boundary) || marker.reminder_provider_boundary < 1)) {
  throw new Error('release has an invalid reminder provider-boundary capability');
}
if (marker.reminder_provider_boundary === 1) {
  throw new Error('release uses the unsafe shared reminder queue; use capability 2 or an artifact without reminder launch support');
}
if (!Number.isSafeInteger(marker.schema?.webhook_delivery_truth) || marker.schema.webhook_delivery_truth < 1) {
  throw new Error('release lacks webhook delivery-truth schema capability');
}
async function validateDatabaseFloor() {
  if (!checkDatabase) return;
  require(path.join(runtimeApiDir, 'node_modules', 'dotenv')).config({ path: path.join(runtimeApiDir, '.env.prod') });
  const { Pool } = require(path.join(runtimeApiDir, 'node_modules', 'pg'));
  const env = process.env.EMAIL_WORKER_ENV;
  const pool = new Pool({
    user:process.env.DB_USER,password:process.env.DB_PASSWORD,host:process.env.DB_HOST,
    port:process.env.DB_PORT,database:process.env.DB_NAME||'ONA',
    ssl:process.env.DB_SSL==='true'?{ca:process.env.DB_SSL_CA?fs.readFileSync(process.env.DB_SSL_CA,'utf8'):undefined,rejectUnauthorized:Boolean(process.env.DB_SSL_CA)}:undefined,
  });
  try {
    const result = await pool.query(
      `SELECT
         COALESCE((SELECT ingestion_required FROM email_webhook_registration_control WHERE environment=$1),false) AS ingestion_required,
         COALESCE((SELECT processing_enabled FROM email_webhook_worker_control WHERE environment=$1),false) AS projection_required,
         COALESCE((SELECT enforcement_enabled FROM email_suppression_control WHERE environment=$1),false) AS suppression_required,
         CASE WHEN to_regclass('survey_reminder_templates') IS NULL THEN false ELSE
           EXISTS(SELECT 1 FROM survey_launches l WHERE l.kind='reminder')
         END AS reminder_boundary_required,
         EXISTS(
           SELECT 1 FROM information_schema.columns
           WHERE table_schema=current_schema() AND table_name='survey_launches' AND column_name='provider_account_scope'
         ) AS reminder_provider_binding_schema,
         CASE WHEN to_regclass('survey_reminder_templates') IS NULL THEN false ELSE
           EXISTS(
             SELECT 1 FROM survey_launches l
             WHERE l.kind='reminder'
               AND to_jsonb(l) ? 'provider_account_scope'
               AND (
                 to_jsonb(l)->>'provider_account_scope' IS NOT NULL
                 OR EXISTS(
                   SELECT 1 FROM survey_email_deliveries d
                   WHERE d.launch_id=l.id AND d.status IN ('reminder_pending','reminder_leased','reminder_retry_wait')
                 )
               )
           )
         END AS reminder_provider_binding_required`,
      [env]
    );
    const floor = result.rows[0];
    if (floor.ingestion_required && marker.webhook_ingest < 1) throw new Error('registration requires webhook ingestion capability');
    if (floor.projection_required && marker.webhook_projection < 1) throw new Error('processing control requires webhook projection capability');
    if (floor.suppression_required && marker.suppression_enforcement < 1) throw new Error('suppression latch requires suppression enforcement capability');
    if (floor.reminder_boundary_required && Number(marker.reminder_provider_boundary || 0) < 2) throw new Error('reminder history requires isolated-queue and kind-aware webhook capability 2');
    if (floor.reminder_provider_binding_schema && marker.reminder_provider_boundary !== undefined && Number(marker.reminder_provider_boundary) < 3) throw new Error('provider-binding schema rejects reminder-launch artifacts below account-bound capability 3');
    if (floor.reminder_provider_binding_required && Number(marker.reminder_provider_boundary || 0) < 3) throw new Error('provider-bound reminder history requires account-bound claim and webhook capability 3');
  } finally {
    await pool.end();
  }
}

validateDatabaseFloor()
  .then(() => process.stdout.write(`release capability marker valid${checkDatabase ? ' for database floor' : ''}\n`))
  .catch((error) => { console.error(error.message); process.exit(1); });
