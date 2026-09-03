import { Question } from 'survey-core';

/** SurveyJS model contract for the custom composite draggable ranking control. */
export class QuestionDraggableRankingModel extends Question {
  getType() {
    return 'draggableranking';
  }

  // Match SurveyJS's built-in ranking model instead of inheriting the base
  // Question textbox semantics around a composite list/button interface.
  get isNewA11yStructure() {
    return false;
  }

  get ariaRole() {
    return 'group';
  }
}
