import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Container, Typography } from '@mui/material';
import { AppPage, Surface, appShadows } from '@network-survey/frontend-react';
import Header from './Header';
import SurveyComponent from './SurveyComponent';
import Logo from './logo.svg?react';
import { PRODUCTION_SURVEY_WRAPPER_SX } from '@network-survey/frontend-shared';
import { instructionsForSurvey } from './surveyInstructions';

const Survey = () => {
  const [title, setTitle] = useState('');
  const [searchParams] = useSearchParams();
  const surveyName = searchParams.get('surveyName');

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
            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }}>
              {instructionsForSurvey(surveyName, title)}
            </Typography>
          </Box>

          <Box
            className="survey-content"
            sx={{
              p: { xs: 2, sm: 3 },
              ...PRODUCTION_SURVEY_WRAPPER_SX,
            }}
          >
            <SurveyComponent setTitle={setTitle} />
          </Box>
        </Surface>
      </Container>
    </AppPage>
  );
};

export default Survey;
