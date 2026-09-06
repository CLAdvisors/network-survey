import React from 'react';
import { parseSurveyInstructionFormatting } from '@network-survey/frontend-shared';

export function FormattedSurveyInstructions({ children }) {
  return parseSurveyInstructionFormatting(children).map((part, index) => part.bold
    ? <strong key={index}>{part.text}</strong>
    : <React.Fragment key={index}>{part.text}</React.Fragment>);
}
