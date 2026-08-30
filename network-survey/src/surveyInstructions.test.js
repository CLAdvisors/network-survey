import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SURVEY_INSTRUCTIONS,
  TEAM_EVAL_INSTRUCTIONS,
  instructionsForSurvey,
} from './surveyInstructions';

describe('instructionsForSurvey', () => {
  it('uses approved TeamEVAL instructions for TeamEVAL survey titles', () => {
    expect(instructionsForSurvey('2026-TeamEVAL', 'Leadership Survey')).toBe(TEAM_EVAL_INSTRUCTIONS);
    expect(instructionsForSurvey('client-survey', 'Team Eval – Leadership')).toBe(TEAM_EVAL_INSTRUCTIONS);
    expect(TEAM_EVAL_INSTRUCTIONS).toContain('Efficacy, Vitality, Adaptability, and Leadership');
    expect(TEAM_EVAL_INSTRUCTIONS).toContain('20-25 minutes');
  });

  it('does not make TeamEVAL-specific claims for other survey types', () => {
    expect(instructionsForSurvey('Organizational Network Analysis')).toBe(DEFAULT_SURVEY_INSTRUCTIONS);
    expect(instructionsForSurvey('')).toBe(DEFAULT_SURVEY_INSTRUCTIONS);
  });
});
