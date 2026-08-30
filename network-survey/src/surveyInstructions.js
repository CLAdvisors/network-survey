export const DEFAULT_SURVEY_INSTRUCTIONS = 'For each question below, indicate the people you interact with at work. The survey will take 10–15 minutes to complete; please plan to finish in one session.';

export const TEAM_EVAL_INSTRUCTIONS = 'The confidential TeamEVAL Survey gathers insights on the team across four categories: Efficacy, Vitality, Adaptability, and Leadership. Your honest feedback will contribute to highlighting where the team is performing at a high level and where the team can focus their efforts for potential improvement. The survey consists of different question types and should take approximately 20-25 minutes to complete. Please ensure you have enough time to finish the survey in one sitting, as partial responses may not be saved. Thank you for participating.';

export function instructionsForSurvey(...identifiers) {
  return identifiers.some((value) => /\bteam\s*eval\b/i.test(String(value || '')))
    ? TEAM_EVAL_INSTRUCTIONS
    : DEFAULT_SURVEY_INSTRUCTIONS;
}
