'use strict';

function displayedRespondentPredicate(alias = 'r') {
  return `(${alias}.name IS DISTINCT FROM 'None' OR ${alias}.contact_info IS DISTINCT FROM 'N/A' OR ${alias}.can_respond IS DISTINCT FROM FALSE)`;
}

function displayedRespondentCountExpression(alias = 'r') {
  return `COUNT(${alias}.respondent_id) FILTER (WHERE ${displayedRespondentPredicate(alias)})`;
}

function isLegacyPlaceholderRespondent(row = {}) {
  const contactInfo = row.contact_info ?? row.email;
  const canRespond = row.can_respond ?? row.canRespond;
  return row.name === 'None' && contactInfo === 'N/A' && canRespond === false;
}

module.exports = {
  displayedRespondentPredicate,
  displayedRespondentCountExpression,
  isLegacyPlaceholderRespondent,
};
