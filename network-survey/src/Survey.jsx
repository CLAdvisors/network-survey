import React, { useState } from 'react';
import { Box, Container, Typography } from '@mui/material';
import { AppPage, Surface, appShadows } from '@network-survey/frontend-react';
import Header from './Header';
import SurveyComponent from './SurveyComponent';
import Logo from './logo.svg?react';
import { PRODUCTION_SURVEY_WRAPPER_SX } from '@network-survey/frontend-shared';

const Survey = () => {
  const [title, setTitle] = useState('');

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
              The confidential TeamEVAL Survey gathers insights on the team across four categories: Efficacy, Vitality, Adaptability, and Leadership. Your honest feedback will contribute to highlighting where the team is performing at a high level and where the team can focus their efforts for potential improvement. The survey consists of different question types and should take approximately 20-25 minutes to complete. Please ensure you have enough time to finish the survey in one sitting, as partial responses may not be saved. Thank you for participating.
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
