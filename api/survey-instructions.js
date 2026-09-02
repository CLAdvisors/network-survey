'use strict';

const DEFAULT_SURVEY_INSTRUCTIONS = 'For each question below, indicate the people you interact with at work. The survey will take 10–15 minutes to complete; please plan to finish in one session.';
const TEAM_EVAL_INSTRUCTIONS = 'The confidential TeamEVAL Survey gathers insights on the team across four categories: Efficacy, Vitality, Adaptability, and Leadership. Your honest feedback will contribute to highlighting where the team is performing at a high level and where the team can focus their efforts for potential improvement. The survey consists of different question types and should take approximately 20-25 minutes to complete. Please ensure you have enough time to finish the survey in one sitting, as partial responses may not be saved. Thank you for participating.';
const MAX_INSTRUCTION_CHARACTERS = 5000;
const MAX_INSTRUCTION_BYTES = 16000;
const DISALLOWED_CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;

function derivedInstructions(...identifiers) {
  return identifiers.some((value) => /\bteam\s*eval\b/i.test(String(value || '')))
    ? TEAM_EVAL_INSTRUCTIONS
    : DEFAULT_SURVEY_INSTRUCTIONS;
}

function effectiveInstructions(override, ...identifiers) {
  return override === null || override === undefined
    ? derivedInstructions(...identifiers)
    : override;
}

function instructionMetadata(value) {
  return {
    presence: value === null || value === undefined ? 'derived' : value === '' ? 'hidden' : 'override',
    characterLength: value === null || value === undefined ? 0 : [...value].length,
    byteLength: value === null || value === undefined ? 0 : Buffer.byteLength(value, 'utf8'),
  };
}

function validateInstructionOverride(value) {
  if (value === null) return null;
  if (typeof value !== 'string') {
    const error = new TypeError('Instructions must be a string or null.');
    error.code = 'instructions_type_invalid';
    throw error;
  }
  if (DISALLOWED_CONTROL_CHARACTERS.test(value)) {
    const error = new TypeError('Instructions may contain line breaks and tabs, but not other control characters.');
    error.code = 'instructions_control_characters_invalid';
    throw error;
  }
  const metadata = instructionMetadata(value);
  if (metadata.characterLength > MAX_INSTRUCTION_CHARACTERS || metadata.byteLength > MAX_INSTRUCTION_BYTES) {
    const error = new TypeError(`Instructions must contain at most ${MAX_INSTRUCTION_CHARACTERS} characters and ${MAX_INSTRUCTION_BYTES} UTF-8 bytes.`);
    error.code = 'instructions_too_large';
    throw error;
  }
  return value;
}

module.exports = {
  DEFAULT_SURVEY_INSTRUCTIONS,
  TEAM_EVAL_INSTRUCTIONS,
  MAX_INSTRUCTION_CHARACTERS,
  MAX_INSTRUCTION_BYTES,
  derivedInstructions,
  effectiveInstructions,
  instructionMetadata,
  validateInstructionOverride,
};
