import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Box, Button, Chip, Paper, Stack, Typography } from '@mui/material';
import { Model, Question, Serializer } from 'survey-core';
import { Survey as SurveyJs } from 'survey-react-ui';
import RespondentDraggableRankingQuestion from './RespondentDraggableRankingQuestion';
import { BRAND_COLORS } from '@network-survey/frontend-shared';
import Header from './Header';
import Logo from './logo.svg?react';
import './Survey.css';

const VIEWPORTS = [
  { label: '320 × 900', width: 320, height: 900 },
  { label: '375 × 812', width: 375, height: 812 },
  { label: '768 × 1024', width: 768, height: 1024 },
];

const PEOPLE = [
  'Alexandra Extremelylongsurname-Example',
  'Benedict Another Very Long Person Name',
  'Chris Rodriguez',
  'Daria Thompson',
  'Elizabeth O’Connor',
  'Franklin Williams',
  'Gabriela Martínez',
];

const draggableRoots = new WeakMap();

class QuestionDraggableRankingModel extends Question {
  getType() {
    return 'draggableranking';
  }
}

if (!Serializer.findClass('draggableranking')) {
  Serializer.addClass(
    'draggableranking',
    [
      { name: 'choices:itemvalues', default: [] },
      { name: 'maxSelectedChoices:number', default: 0, minValue: 0 },
    ],
    () => new QuestionDraggableRankingModel(''),
    'question'
  );
}

const questionJson = {
  elements: [
    {
      type: 'tagbox',
      name: 'collaboration',
      title: 'Who do you collaborate with most frequently on projects or tasks?',
      description: 'Start typing to search for people. Select every person that applies.',
      isRequired: true,
      choicesLazyLoadEnabled: true,
      choicesLazyLoadPageSize: 25,
      // Keep selected values resolvable before the lazy menu is opened.
      choices: PEOPLE.map((name) => ({ value: name, text: name })),
      placeholder: 'Start typing to search for people',
    },
    {
      type: 'tagbox',
      name: 'advice',
      title: 'When you need help solving a complex problem, who do you go to for advice or perspective?',
      isRequired: true,
      choicesLazyLoadEnabled: true,
      choicesLazyLoadPageSize: 25,
      // Keep selected values resolvable before the lazy menu is opened.
      choices: PEOPLE.map((name) => ({ value: name, text: name })),
      placeholder: 'Start typing to search for people',
    },
    {
      type: 'draggableranking',
      name: 'ranking',
      title: 'Rank the people who have the greatest influence on your work.',
      description: 'Drag up to two people into the ranked area.',
      isRequired: true,
      maxSelectedChoices: 2,
      choices: PEOPLE.slice(0, 4),
    },
    {
      type: 'comment',
      name: 'comments',
      title: 'Is there anything else you would like to share?',
      description: 'Optional. This long example description helps check wrapping and vertical spacing on narrow screens.',
      isRequired: false,
    },
  ],
};

function makeModel() {
  Model.cssType = 'defaultV2';
  const model = new Model(questionJson);
  model.showQuestionNumbers = false;
  model.showProgressBar = 'bottom';
  model.progressBarType = 'questions';
  model.completedHtml = '<h3>Thank you for completing the survey.</h3><p>This is a local mobile-review harness. No answers were sent.</p>';
  model.data = {
    collaboration: PEOPLE.slice(0, 2),
  };
  model.onChoicesLazyLoad.add((_, options) => {
    const filter = String(options.filter || '').toLowerCase();
    const names = PEOPLE.filter((name) => name.toLowerCase().includes(filter));
    options.setItems(names.map((name) => ({ value: name, text: name })), names.length);
  });
  return model;
}

function HarnessSurvey() {
  const rootsRef = useRef(new Set());
  const [model] = useState(() => {
    const instance = makeModel();
    // Register before SurveyJs mounts: SurveyJS fires this event from its
    // question mount lifecycle, before a parent useEffect would run.
    instance.onAfterRenderQuestion.add((_, options) => {
      // Match production's hook-owned class rather than relying on SurveyJS row markup.
      options.htmlElement?.classList.add('respondent-survey-question');
      if (options.question?.getType() !== 'draggableranking') return;
      const content = options.htmlElement?.querySelector('.sd-question__content') || options.htmlElement;
      if (!content) return;
      const previous = draggableRoots.get(options.question);
      if (previous) {
        previous.unmount();
        rootsRef.current.delete(previous);
      }
      const host = document.createElement('div');
      host.className = 'draggable-ranking-host';
      content.replaceChildren(host);
      const root = ReactDOM.createRoot(host);
      draggableRoots.set(options.question, root);
      rootsRef.current.add(root);
      root.render(
        <RespondentDraggableRankingQuestion
          question={options.question}
          value={options.question.value || []}
          onChange={(value) => { options.question.value = value; }}
        />
      );
    });
    return instance;
  });

  useEffect(() => () => {
    rootsRef.current.forEach((root) => root.unmount());
    rootsRef.current.clear();
    model.dispose();
  }, [model]);

  return <SurveyJs model={model} />;
}

export default function MobileSurveyHarness() {
  const searchParams = new URLSearchParams(window.location.search);
  const initialWidth = Number(searchParams.get('viewport'));
  const fullWidthPreview = searchParams.get('fullWidth') === '1';
  const initialViewport = VIEWPORTS.find((viewport) => viewport.width === initialWidth) || VIEWPORTS[1];
  const [viewport, setViewport] = useState(initialViewport);
  // A framed 320/375 preview needs an explicit phone fallback because the
  // browser viewport stays wide. Full-width previews use the real viewport.
  const isFramedPhone = !fullWidthPreview && viewport.width < 600;
  const title = useMemo(
    () => 'A deliberately long survey title for checking a narrow mobile header and wrapping behavior',
    []
  );

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#eef2f3', p: fullWidthPreview ? 0 : { xs: 1, sm: 3 } }}>
      <Paper sx={{ display: fullWidthPreview ? 'none' : undefined, maxWidth: 900, mx: 'auto', p: 2, mb: 2 }}>
        <Typography variant="h5" gutterBottom>Mobile survey review harness</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          This local-only fixture uses the respondent survey layout, representative long text, selected tagbox values, lazy choices, ranking, validation, and completion. It never calls the API or saves answers.
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
          <Typography variant="body2">Frame:</Typography>
          {VIEWPORTS.map((candidate) => (
            <Button
              key={candidate.width}
              size="small"
              variant={candidate.width === viewport.width ? 'contained' : 'outlined'}
              onClick={() => setViewport(candidate)}
            >
              {candidate.label}
            </Button>
          ))}
          <Chip size="small" label="No API calls" color="success" variant="outlined" />
        </Stack>
      </Paper>

      <Box sx={{ overflow: 'auto', pb: 3 }}>
        <Box
          sx={{
            width: fullWidthPreview ? '100%' : viewport.width,
            height: fullWidthPreview ? 'auto' : viewport.height,
            mx: 'auto',
            overflowY: fullWidthPreview ? 'visible' : 'auto',
            bgcolor: BRAND_COLORS.surveyBackground,
            border: fullWidthPreview ? 0 : '8px solid #263238',
            borderRadius: fullWidthPreview ? 0 : 3,
            boxShadow: fullWidthPreview ? 'none' : 6,
          }}
        >
          <Box className={`respondent-survey-frame${isFramedPhone ? ' respondent-survey-frame--phone' : ''}`}>
            <Header svgComponent={<Logo />} title={title} forceMobile={isFramedPhone} />
            <Box className="harness-survey-layout" sx={{ p: 1.5 }}>
              <Paper className="harness-survey-surface" elevation={1} sx={{ overflow: 'hidden' }}>
                <Box className="survey-instructions" sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 500, mb: 1, color: BRAND_COLORS.primary }}>
                  Survey Instructions
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }}>
                  For each question below, indicate the people you interact with at work. The survey will take 10–15 minutes to complete; please plan to finish in one session.
                </Typography>
              </Box>
                <Box
                  className="survey-content"
                  sx={{
                    '--sjs-primary-backcolor': BRAND_COLORS.primary,
                    '--sjs-primary-backcolor-dark': BRAND_COLORS.primaryHover,
                    '--sjs-secondary-backcolor': BRAND_COLORS.primary,
                  }}
                >
                <div className="modern-survey-container"><HarnessSurvey /></div>
              </Box>
              </Paper>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
