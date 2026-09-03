'use strict';

const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
const required=(text,value,file)=>{if(!text.includes(value))throw new Error(`${file} is missing required prod-secondary Resend contract: ${value}`);};

const moduleMain=read('terraform/modules/prod_secondary_platform/main.tf');
const tfvars=read('terraform/envs/prod-secondary/prod-secondary.tfvars');
const targetVariables=read('terraform/envs/prod-secondary/variables.tf');
const remoteDeploy=read('scripts/deploy/remote-deploy.sh');
const emailRuntime=read('api/email.js');
const webhookManagement=read('scripts/deploy/manage-resend-webhook.js');
const capabilities=JSON.parse(read('scripts/deploy/CAPABILITIES.json'));
const applyWorkflow=read('.github/workflows/terraform-apply.yml');

for(const value of [
  'RESEND_CREDENTIAL_LOAD_ENABLED=${var.enable_resend_credentials}',
  'RESEND_API_KEY_PARAMETER=${var.enable_resend_credentials ? "/network-survey/prod-secondary/resend/api-key" : ""}',
  'RESEND_PROVIDER_ACCOUNT_SCOPE=network-survey-resend-prod-secondary',
  'SURVEY_EMAIL_SENDER=CLA Survey <survey@cladvisorsurveys.com>',
  'SURVEY_EMAIL_REPLY_TO=survey@cladvisors.com',
  'RESEND_WEBHOOK_SECRET_PARAMETER=${var.enable_resend_webhook_ingest ? "/network-survey/prod-secondary/resend/webhook-secret" : ""}',
  'RESEND_WEBHOOK_PREVIOUS_SECRET_PARAMETER=${var.enable_resend_webhook_ingest ? "/network-survey/prod-secondary/resend/webhook-previous-secret" : ""}',
  'RESEND_WEBHOOK_INGEST_ENABLED=${var.enable_resend_webhook_ingest}',
]) required(moduleMain,value,'target module');
for(const value of ['enable_resend_credentials    = true','enable_resend_webhook_ingest = true']) required(tfvars,value,'activated prod-secondary.tfvars');
for(const value of [
  'variable "enable_resend_credentials" {\n  description = "Load the isolated prod-secondary Resend sending key into runtime. Activation gate; default off."\n  type        = bool\n  default     = false',
  'variable "enable_resend_webhook_ingest" {\n  description = "Load the isolated prod-secondary webhook secret and accept webhooks. Activation gate; default off."\n  type        = bool\n  default     = false',
]) required(targetVariables,value,'default-off target variables');
for(const value of ['var.enable_resend_credentials ? [','var.enable_resend_webhook_ingest ? [','ssm:resourceTag/Environment','ssm:resourceTag/App','ssm:resourceTag/Stack','tag:GetResources']) required(moduleMain,value,'conditional target IAM');
if(moduleMain.includes('resourcegroupstaggingapi:GetResources'))throw new Error('target deploy IAM uses an invalid Resource Groups Tagging API action name');
required(remoteDeploy,'RUNTIME_EMAIL_ENV" = "prod-secondary','remote deploy');
for(const value of ['prod-secondary must not use the legacy RESEND_KEY','credential is present while loading is disabled','webhook secret is present while ingestion is disabled']) required(emailRuntime,value,'email runtime');
for(const value of ['https://api.cladvisorsurveys.com/api/webhooks/resend','710054969994','/network-survey/prod-secondary/resend/webhook-secret']) required(webhookManagement,value,'webhook management');
if(capabilities.prod_secondary_resend_isolation!==1)throw new Error('release capability marker lacks prod-secondary Resend isolation');
required(applyWorkflow,"EXPECTED_ACCOUNT_ID: '710054969994'",'Terraform apply workflow');
required(applyWorkflow,'WORKING_DIR=terraform/envs/prod-secondary','Terraform apply workflow');
if(/terraform\/envs\/(?:prod|staging)\//.test(moduleMain))throw new Error('prod-secondary module references a source-environment Terraform root');
console.log('prod-secondary Resend isolation contract validated');
