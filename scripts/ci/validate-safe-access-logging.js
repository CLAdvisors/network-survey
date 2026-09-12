'use strict';

const fs = require('fs');
const assert = require('node:assert/strict');

const loggingPath = 'terraform/modules/prod_secondary_platform/access-logging.tf';
const modulePath = 'terraform/modules/prod_secondary_platform/main.tf';
const logging = fs.readFileSync(loggingPath, 'utf8');
const platform = fs.readFileSync(modulePath, 'utf8');

const fieldsMatch = logging.match(/cloudfront_access_log_fields\s*=\s*\[([\s\S]*?)\n\s*\]/);
assert.ok(fieldsMatch, 'CloudFront access-log field allowlist must be explicit');
const fields = [...fieldsMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
assert.deepEqual(fields, [
  'date', 'time', 'cs-method', 'sc-status', 'time-taken',
  'time-to-first-byte', 'origin-fbl', 'origin-lbl', 'x-edge-result-type',
  'x-edge-response-result-type', 'x-edge-detailed-result-type', 'x-edge-request-id',
]);
for (const forbidden of ['c-ip', 'x-forwarded-for', 'cs-uri-stem', 'cs-uri-query', 'cs(Cookie)', 'cs(Referer)', 'cs(User-Agent)', 'c-country', 'asn', 'c-port', 'viewer-request-log-data', 'viewer-response-log-data']) {
  assert.equal(fields.includes(forbidden), false, `forbidden access-log field: ${forbidden}`);
}

for (const required of [
  'resource "aws_cloudwatch_log_delivery_source" "cloudfront_api_access"',
  'resource "aws_cloudwatch_log_delivery_destination" "cloudfront_api_access"',
  'resource "aws_cloudwatch_log_delivery" "cloudfront_api_access"',
  'output_format = "json"',
  'enable_hive_compatible_path = true',
  'block_public_acls       = true',
  'block_public_policy     = true',
  'ignore_public_acls      = true',
  'restrict_public_buckets = true',
  'object_ownership = "BucketOwnerEnforced"',
  'sse_algorithm = "AES256"',
  'days = 30',
  'variable = "aws:SecureTransport"',
  'delivery.logs.amazonaws.com',
  'variable = "aws:SourceAccount"',
  'delivery-source:${local.cloudfront_access_log_source_name}',
]) assert.ok(logging.includes(required), `missing safe logging control: ${required}`);

assert.ok(platform.includes('"ACCESS_ERROR_TELEMETRY_ENABLED=true"'));
const albBlock = platform.match(/resource "aws_lb" "api" \{([\s\S]*?)\n\}/)?.[1] || '';
assert.equal(/access_logs\s*\{/.test(albBlock), false, 'raw ALB access logs must remain disabled');

console.log('safe access logging validation passed');
