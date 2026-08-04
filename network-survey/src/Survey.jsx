import React, { useState } from 'react';
import { Box, Container, Typography } from '@mui/material';
import { AppPage, Surface, appShadows } from '@network-survey/frontend-react';
import Header from './Header';
import SurveyComponent from './SurveyComponent';
import Logo from './logo.svg?react';
import { PRODUCTION_SURVEY_WRAPPER_SX } from '@network-survey/frontend-shared';

const LEGACY_INSTRUCTIONS = 'For each question below, indicate the people you interact with at work. The survey will take 10-15 minutes to complete; please plan to finish in one session.';

const Survey = () => {
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState(LEGACY_INSTRUCTIONS);
  const handleInstructions = React.useCallback((value) => {
    setInstructions(value === undefined ? LEGACY_INSTRUCTIONS : value);
  }, []);

  return (
    <AppPage sx={{ pb: 4 }}>
      <Header svgComponent={<Logo />} title={title} />

      <Container
        maxWidth="lg"
        disableGutters
        sx={{ mt: { xs: 0, sm: 3 }, px: { xs: 0, sm: 3 } }}
      >
        <Surface
          className="respondent-survey-surface"
          sx={{
            overflow: 'hidden',
            borderRadius: { xs: 0, sm: 1 },
            borderInline: { xs: 0, sm: '1px solid' },
            borderInlineColor: { sm: 'divider' },
            boxShadow: { xs: 'none', sm: appShadows.surface },
          }}
        >
          {instructions !== '' && (
            <Box
              className="survey-instructions"
              sx={{
                p: { xs: 2, sm: 3 },
                borderBottom: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 500, mb: 1, color: 'primary.main' }}>
                Survey Instructions
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ lineHeight: 1.5, whiteSpace: 'pre-line' }}
              >
                {instructions}
              </Typography>
            </Box>
          )}

          <Box
            className="survey-content"
            sx={{
              p: { xs: 2, sm: 3 },
              ...PRODUCTION_SURVEY_WRAPPER_SX,
            }}
          >
            <SurveyComponent setTitle={setTitle} setInstructions={handleInstructions} />
          </Box>
        </Surface>
      </Container>
    </AppPage>
  );
};

export default Survey;
