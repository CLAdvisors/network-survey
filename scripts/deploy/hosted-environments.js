'use strict';

const HOSTED_ENVIRONMENTS = Object.freeze(['staging', 'prod', 'prod-secondary']);

function isHostedEnvironment(environment) {
  return HOSTED_ENVIRONMENTS.includes(environment);
}

const HOSTED_ENVIRONMENTS_DESCRIPTION = HOSTED_ENVIRONMENTS.join(', ');

module.exports = { HOSTED_ENVIRONMENTS, HOSTED_ENVIRONMENTS_DESCRIPTION, isHostedEnvironment };
