/**
 * Shared contract for linked ("exclusive") draggable-ranking questions.
 *
 * Questions that carry the same `exclusiveGroup` label share their choice
 * values: a value ranked in one visible question is not offered in the others.
 * Matching always happens on the choice value (the key used in the answer
 * array), never on the choice text or on question names (the API renames
 * questions to `question_N`).
 */

export const EXCLUSIVE_GROUP_PROPERTY_NAME = 'exclusiveGroup';
export const EXCLUSIVE_GROUP_PATTERN = /^[A-Za-z0-9 _-]{1,64}$/;
export const EXCLUSIVE_GROUP_MAX_LENGTH = 64;

/**
 * SurveyJS property descriptor. Registered on `draggableranking` by the
 * respondent app, the dashboard Creator and (with its own literal copy) the
 * API so `toJSON()` keeps the value.
 */
export const EXCLUSIVE_GROUP_PROPERTY = {
  name: `${EXCLUSIVE_GROUP_PROPERTY_NAME}:string`,
  default: '',
  category: 'choices',
  displayName: 'Exclusive ranking group',
  description:
    'Ranking questions that share a group label cannot rank the same option. ' +
    'Use at least two questions with identical choice values.',
};

/** Returns the trimmed group label, or an empty string when unset/invalid. */
export function normalizeExclusiveGroup(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed;
}

/** SurveyJS-safe answer key for a choice value (mirrors the renderer's keys). */
export function exclusiveChoiceKey(value) {
  let plain = value;
  if (plain && typeof plain === 'object') {
    if (Object.prototype.hasOwnProperty.call(plain, 'value')) {
      plain = plain.value;
    } else if (Object.prototype.hasOwnProperty.call(plain, 'id')) {
      plain = plain.id;
    }
  }
  if (plain === null || plain === undefined) return String(plain);
  if (typeof plain === 'object') {
    try {
      return JSON.stringify(plain);
    } catch (err) {
      return String(plain);
    }
  }
  return String(plain);
}

function isRankingQuestion(question) {
  return Boolean(question) && typeof question.getType === 'function' &&
    question.getType() === 'draggableranking';
}

/** Reads the exclusive group from a SurveyJS question or raw schema element. */
export function exclusiveGroupOf(question) {
  if (!question) return '';
  const raw = typeof question.getPropertyValue === 'function'
    ? question.getPropertyValue(EXCLUSIVE_GROUP_PROPERTY_NAME)
    : question[EXCLUSIVE_GROUP_PROPERTY_NAME];
  return normalizeExclusiveGroup(raw);
}

/** Ranked choice keys of a question, using SurveyJS's live value. */
export function rankedChoiceKeys(question) {
  const value = Array.isArray(question?.value) ? question.value : [];
  return value.map(exclusiveChoiceKey);
}

/**
 * A question participates in enforcement while it can accept answers. Hidden
 * (visibleIf) and read-only questions neither consume nor reserve values.
 */
export function isExclusivePeerActive(question) {
  if (!isRankingQuestion(question) || !exclusiveGroupOf(question)) return false;
  if (question.isVisible === false) return false;
  if (question.isReadOnly === true) return false;
  return true;
}

/**
 * Other active ranking questions of the same group, in document order.
 * Returns an empty array for ungrouped questions, prop-mode rendering (no
 * survey) or a question with no peers.
 */
export function exclusiveGroupPeers(question) {
  const survey = question?.survey;
  const group = exclusiveGroupOf(question);
  if (!survey || !group || typeof survey.getAllQuestions !== 'function') return [];
  return survey.getAllQuestions().filter((peer) => (
    peer !== question &&
    isExclusivePeerActive(peer) &&
    exclusiveGroupOf(peer) === group
  ));
}

/** Choice keys ranked by any active peer; the caller hides them. */
export function collectExclusiveTakenKeys(question) {
  const taken = new Set();
  exclusiveGroupPeers(question).forEach((peer) => {
    rankedChoiceKeys(peer).forEach((key) => taken.add(key));
  });
  return taken;
}

/**
 * Choice keys ranked by an earlier (document order) active peer. Those values
 * cannot belong to this question too; the later question yields, so prefilled
 * or resumed data resolves deterministically (first question in the survey
 * keeps the option).
 */
export function collectExclusiveConflictKeys(question) {
  const survey = question?.survey;
  const group = exclusiveGroupOf(question);
  if (!survey || !group || typeof survey.getAllQuestions !== 'function') return new Set();
  const ownerKeys = new Set();
  const questions = survey.getAllQuestions();
  for (const peer of questions) {
    if (peer === question) break;
    if (!isExclusivePeerActive(peer) || exclusiveGroupOf(peer) !== group) continue;
    rankedChoiceKeys(peer).forEach((key) => ownerKeys.add(key));
  }
  return ownerKeys;
}
