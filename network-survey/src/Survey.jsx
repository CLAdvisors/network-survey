import React, { useState } from 'react';
import { Box, Container, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { AppPage, Surface } from '@network-survey/frontend-react';
import Header from './Header';
import SurveyComponent from './SurveyComponent';
import Logo from './logo.svg?react';

const Survey = () => {
  const theme = useTheme();
  const [title, setTitle] = useState('');

  return (
    <AppPage sx={{ pb: 4 }}>
      <Header svgComponent={<Logo />} title={title} />

      <Container
        maxWidth="lg"
        disableGutters
        sx={{ mt: { xs: 0, sm: 3 }, px: { xs: 0, sm: 2, md: 3 } }}
      >
        <Surface
          className="respondent-survey-surface"
          sx={{
            overflow: 'hidden',
            borderRadius: { xs: 0, sm: 1 },
            borderInline: { xs: 0, sm: '1px solid' },
            boxShadow: { xs: 'none', sm: undefined },
          }}
        >
          <Box className="survey-instructions" sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
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
              '--survey-primary': theme.palette.primary.main,
              '--survey-primary-hover': theme.palette.primary.dark,
              '--survey-primary-light': alpha(theme.palette.primary.main, 0.1),
              '--survey-primary-border': alpha(theme.palette.primary.main, 0.4),
              '--survey-surface': theme.palette.background.paper,
              '--survey-text': theme.palette.text.primary,
              '--survey-muted-text': theme.palette.text.secondary,
              '--survey-disabled-text': theme.palette.text.disabled,
              '--survey-border': theme.palette.divider,
              '--survey-error': theme.palette.error.main,
              '--survey-error-surface': alpha(theme.palette.error.main, 0.04),
              '--sjs-font-family': theme.typography.fontFamily,
              '--sjs-general-backcolor': theme.palette.background.paper,
              '--sjs-general-backcolor-dim': 'transparent',
              '--sjs-general-backcolor-dim-light': theme.palette.background.paper,
              '--sjs-general-forecolor': theme.palette.text.primary,
              '--sjs-general-forecolor-light': theme.palette.text.secondary,
              '--sjs-primary-backcolor': theme.palette.primary.main,
              '--sjs-primary-backcolor-dark': theme.palette.primary.dark,
              '--sjs-primary-backcolor-light': alpha(theme.palette.primary.main, 0.1),
              '--sjs-primary-forecolor': theme.palette.primary.contrastText,
              '--sjs-primary-forecolor-light': theme.palette.primary.main,
              '--sjs-secondary-backcolor': theme.palette.primary.main,
              '--sjs-secondary-backcolor-light': alpha(theme.palette.primary.main, 0.1),
              '--sjs-border-default': theme.palette.divider,
              '--sjs-border-light': theme.palette.divider,
              '--sjs-corner-radius': `${theme.shape.borderRadius}px`,
              '--sjs-question-background': 'transparent',
              '--sjs-questionpanel-backcolor': 'transparent',
              '--sjs-header-backcolor': 'transparent',
              '--sjs-font-questiontitle-color': theme.palette.text.primary,
              '--sjs-font-questiontitle-weight': 500,
              '--sjs-font-questiondescription-color': theme.palette.text.secondary,
              '--sjs-special-red': theme.palette.error.main,
              '--sjs-special-red-light': alpha(theme.palette.error.main, 0.1),
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
