import { CustomError, Question } from 'survey-core';

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

  onCheckForErrors(errors, isOnValueChanged, fireCallback) {
    super.onCheckForErrors(errors, isOnValueChanged, fireCallback);
    if (isOnValueChanged) return;
    const minimum = Number(this.minSelectedChoices);
    const count = Array.isArray(this.value) ? this.value.length : 0;
    if (Number.isInteger(minimum) && minimum > 0 && count < minimum) {
      errors.push(new CustomError(
        this.getLocalizationFormatString('minSelectError', minimum),
        this
      ));
    }
  }
}
