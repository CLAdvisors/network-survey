import React, { useState } from 'react';
import { Box, Container, Typography } from '@mui/material';
import { AppPage, Surface } from '@network-survey/frontend-react';
import Header from './Header';
import SurveyComponent from './SurveyComponent';
import Logo from './logo.svg?react';
import { BRANDED_SURVEY_WRAPPER_SX } from '@network-survey/frontend-shared';

const Survey = () => {
  const [title, setTitle] = useState('');

  return (
    <AppPage sx={{ pb: 4 }}>
      <Header svgComponent={<Logo />} title={title} />

      <Container maxWidth="lg" sx={{ mt: 3 }}>
        <Surface sx={{ overflow: 'hidden' }}>
          <Box sx={{ p: 3, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 500, mb: 1, color: 'primary.main' }}>
              Survey Instructions
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }}>
              For each question below, indicate the people you interact with at work.
              {' '}The survey will take 10-15 minutes to complete; please plan to finish in one session.
            </Typography>
          </Box>

          <Box
            className="survey-content"
            sx={{
              p: 3,
              ...BRANDED_SURVEY_WRAPPER_SX
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
