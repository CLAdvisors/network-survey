import React from 'react';
import ReactDOM from 'react-dom/client';
import { Alert, Box, Button, Chip, Container, Paper, Stack, Typography } from '@mui/material';
import { Model, Question, Serializer } from 'survey-core';
import { Survey as SurveyJs } from 'survey-react-ui';
import { DraggableRankingQuestion } from '@network-survey/frontend-react';
import { applyProductionSurveyTheme, PRODUCTION_SURVEY_CLASS_NAME, PRODUCTION_SURVEY_WRAPPER_SX } from '@network-survey/frontend-shared';
import 'survey-core/survey-core.min.css';
import '@network-survey/frontend-shared/src/surveyRuntime.css';
import './longValueLab.css';
import { DEFINITION_VARIANTS, DefinitionExperience } from './DefinitionExperience';
import LongValueRadiogroup from './LongValueRadiogroup';
import { extractLongValueChoices, registerLongValueDefinitionProperty } from './longValueSchema';
import { LONG_VALUE_SURVEY_JSON } from './labSurvey';

class LabDraggableRankingModel extends Question {
  getType() {
    return 'draggableranking';
  }
}

function registerLabSchema() {
  registerLongValueDefinitionProperty();
  if (!Serializer.findClass('draggableranking')) {
    Serializer.addClass(
      'draggableranking',
      [
        { name: 'choices:itemvalues', default: [] },
        { name: 'maxSelectedChoices:number', default: 0, minValue: 0 },
      ],
      () => new LabDraggableRankingModel(''),
      'question'
    );
  }
}

function variantFromLocation() {
  const requested = new URLSearchParams(window.location.search).get('variant');
  return DEFINITION_VARIANTS.some((variant) => variant.id === requested) ? requested : 'popover';
}

function LabSurvey({ variant, onAnswersChange }) {
  const variantRef = React.useRef(variant);
  const rootsRef = React.useRef(new Map());
  variantRef.current = variant;

  const renderQuestion = React.useCallback((question, root) => {
    const choices = extractLongValueChoices(question);
    if (question.getType() === 'draggableranking') {
      root.render(
        <DefinitionExperience variant={variantRef.current} choices={choices}>
          {({ renderControl }) => (
            <DraggableRankingQuestion
              question={question}
              value={question.value || []}
              onChange={(value) => { question.value = value; }}
              availableDirection="vertical"
              valueSource="question"
              renderChoiceSupplement={(item) => renderControl(item)}
            />
          )}
        </DefinitionExperience>
      );
      return;
    }
    root.render(<LongValueRadiogroup question={question} definitionVariant={variantRef.current} />);
  }, []);

  const [model] = React.useState(() => {
    registerLabSchema();
    const instance = new Model(LONG_VALUE_SURVEY_JSON);
    applyProductionSurveyTheme(instance);
    instance.showQuestionNumbers = false;
    instance.showNavigationButtons = false;
    instance.data = { expedition_priorities: ['charter-calm-iteration-v1'] };
    instance.onAfterRenderQuestion.add((_, options) => {
      if (!['draggableranking', 'radiogroup'].includes(options.question?.getType())) return;
      const questionElement = options.htmlElement?.matches?.('.sd-question')
        ? options.htmlElement
        : options.htmlElement?.querySelector?.('.sd-question') || options.htmlElement;
      const content = questionElement?.querySelector?.('.sd-question__content') || questionElement;
      if (!content) return;
      const previous = rootsRef.current.get(options.question);
      previous?.unmount();
      const host = document.createElement('div');
      host.className = 'draggable-ranking-host lv-question-host';
      content.replaceChildren(host);
      const root = ReactDOM.createRoot(host);
      rootsRef.current.set(options.question, root);
      renderQuestion(options.question, root);
    });
    instance.onValueChanged.add((sender) => onAnswersChange({ ...sender.data }));
    return instance;
  });

  React.useEffect(() => {
    onAnswersChange({ ...model.data });
  }, [model, onAnswersChange]);

  React.useEffect(() => {
    rootsRef.current.forEach((root, question) => renderQuestion(question, root));
  }, [renderQuestion, variant]);

  React.useEffect(() => () => {
    rootsRef.current.forEach((root) => root.unmount());
    rootsRef.current.clear();
    model.dispose();
  }, [model]);

  return <SurveyJs model={model} />;
}

const MATRIX = [
  ['Focus popover', 'Medium', 'Highest', 'Low', 'Inline fallback', 'Strong with focus/click', 'Medium'],
  ['Expandable cards', 'High', 'Low when open', 'High', 'Long but direct', 'Strong, simple semantics', 'Low–medium'],
  ['Detail panel', 'Medium', 'High', 'Medium–high', 'Panel moves above task', 'Good; needs clear updates', 'Medium'],
  ['Glossary preview', 'High launch, low per item', 'Highest', 'High inside glossary', 'Purpose-built dialog', 'Good; focus management risk', 'High'],
];

export default function LongValueLab() {
  const [variant, setVariant] = React.useState(variantFromLocation);
  const [frame, setFrame] = React.useState('full');
  const [answers, setAnswers] = React.useState({});
  const selectedVariant = DEFINITION_VARIANTS.find((candidate) => candidate.id === variant);

  const chooseVariant = (next) => {
    setVariant(next);
    const url = new URL(window.location.href);
    url.searchParams.set('variant', next);
    window.history.replaceState({}, '', url);
  };

  return (
    <Box className="long-value-lab">
      <Box component="header" className="lv-lab-header">
        <Container maxWidth="lg">
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1}>
            <div>
              <span className="lv-eyebrow">Isolated respondent prototype</span>
              <Typography component="h1" variant="h4">Long value definition lab</Typography>
            </div>
            <Chip label="Synthetic data · no API calls" color="success" variant="outlined" />
          </Stack>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
          Compare interaction models; this lab does not recommend a winner. Rank or select values, switch variants, and confirm that answers persist.
        </Alert>

        <Paper component="nav" aria-label="Definition treatment variants" className="lv-variant-nav">
          <div className="lv-variant-tabs">
            {DEFINITION_VARIANTS.map((candidate, index) => (
              <Button
                key={candidate.id}
                variant={candidate.id === variant ? 'contained' : 'outlined'}
                aria-current={candidate.id === variant ? 'page' : undefined}
                onClick={() => chooseVariant(candidate.id)}
              >
                {index + 1}. {candidate.label}
              </Button>
            ))}
          </div>
          <Typography variant="body2"><strong>{selectedVariant.label}:</strong> {selectedVariant.summary}</Typography>
          <div className="lv-frame-controls" aria-label="Preview width">
            <span>Preview:</span>
            {[['full', 'Responsive'], ['375', '375 px'], ['320', '320 px']].map(([value, label]) => (
              <Button key={value} size="small" variant={frame === value ? 'contained' : 'text'} onClick={() => setFrame(value)}>{label}</Button>
            ))}
          </div>
        </Paper>

        <Box className="lv-preview-scroll">
          <Paper
            className={`lv-preview lv-preview--${frame}`}
            sx={{ ...PRODUCTION_SURVEY_WRAPPER_SX }}
            data-reflow-mode={frame}
          >
            <div className="lv-preview-banner">
              <span>Expedition charter exercise</span>
              <small>16 invented values · definitions from one sentence to multiple paragraphs</small>
            </div>
            <div className={PRODUCTION_SURVEY_CLASS_NAME}>
              <LabSurvey variant={variant} onAnswersChange={setAnswers} />
            </div>
            <section className="lv-answer-state" aria-live="polite" aria-label="Current SurveyJS answer state">
              <strong>Current machine-value answers</strong>
              <code>{JSON.stringify(answers)}</code>
            </section>
          </Paper>
        </Box>

        <Paper component="section" className="lv-matrix" aria-labelledby="lv-matrix-title">
          <Typography id="lv-matrix-title" component="h2" variant="h5">Evaluation matrix</Typography>
          <Typography variant="body2" color="text.secondary">Directional prompts for discussion, not test results.</Typography>
          <div className="lv-table-scroll" tabIndex="0" aria-label="Scrollable comparison table">
            <table>
              <thead><tr><th>Variant</th><th>Discoverability</th><th>Density</th><th>Comparison</th><th>Mobile</th><th>Accessibility</th><th>Implementation risk</th></tr></thead>
              <tbody>{MATRIX.map((row) => <tr key={row[0]}>{row.map((cell, index) => index ? <td key={cell}>{cell}</td> : <th scope="row" key={cell}>{cell}</th>)}</tr>)}</tbody>
            </table>
          </div>
        </Paper>
      </Container>
    </Box>
  );
}
