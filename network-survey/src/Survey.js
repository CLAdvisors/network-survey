import React, { useState } from 'react';
import {
  Box,
  Container,
  Typography,
  Paper,
  useTheme
} from '@mui/material';
import Header from './Header';
import SurveyComponent from './SurveyComponent';
import { ReactComponent as Logo } from './logo.svg';

const Survey = () => {
  const theme = useTheme();
  const [title, setTitle] = useState("");

  return (
    <Box sx={{ 
      minHeight: '100vh',
      bgcolor: 'background.default',
      pb: 4
    }}>
      <Header svgComponent={<Logo />} title={title} />
      
      <Container maxWidth="lg" sx={{ mt: 3 }}>
        <Paper
          elevation={1}
          sx={{
            borderRadius: 1,
            overflow: 'hidden',
            bgcolor: 'background.paper',
            border: `1px solid ${theme.palette.divider}`
          }}
        >
          {/* Instructions Section */}
          <Box sx={{ 
            p: 3,
            borderBottom: `1px solid ${theme.palette.divider}`,
          }}>
            <Typography 
              variant="subtitle1" 
              component="h2"
              sx={{ 
                fontWeight: 500,
                mb: 1,
                color: '#42B4AF'
              }}
            >
              Survey Instructions
            </Typography>
            <Typography 
              variant="body2" 
              color="text.secondary"
              sx={{ lineHeight: 1.5 }}
            >
              For each question below, indicate the people you interact with at work. 
              The survey will take 10-15 minutes to complete; please plan to finish in one session.
            </Typography>
          </Box>

          {/* Survey Content */}
          <Box sx={{ 
            p: 3,
            '& .sv-root-modern': {
              '--sv-header-background-color': 'transparent',
              '--sv-header-text-color': theme.palette.text.primary,
              '--sv-primary-color': '#42B4AF',
              '--sv-secondary-color': '#42B4AF',
              '--sv-primary-hover-color': '#3B9F9B',
              '--sv-secondary-hover-color': '#3B9F9B',
              '--sv-border-color': theme.palette.divider,
              '--sv-font-family': theme.typography.fontFamily,
              '--sv-page-edge-padding': '0px',
              '--sv-question-spacing': '32px',
            },
            // Question Container
            '& .sv-question': {
              background: 'transparent',
              padding: '16px 0',
              marginBottom: 2,
            },
            // Question Title
            '& .sv-question__title': {
              fontWeight: 500,
              color: theme.palette.text.primary,
              marginBottom: 2,
              '& .sv-question__required-text': {
                color: theme.palette.error.main,
              }
            },
            // Tagbox Styling
            '& .sv-tagbox': {
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: 1,
              transition: 'all 0.2s ease',
              backgroundColor: theme.palette.background.paper,
              '&:focus-within': {
                borderColor: '#42B4AF',
                boxShadow: `0 0 0 2px rgba(66, 180, 175, 0.15)`,
              }
            },
            // Tagbox Items
            '& .sv-tagbox__item': {
              borderRadius: 1,
              backgroundColor: '#42B4AF !important',
              color: '#FFFFFF',
              margin: '2px',
              padding: '4px 8px',
              '&:hover': {
                backgroundColor: '#3B9F9B !important',
              }
            },
            // Complete Button
            '& .sv-btn': {
              backgroundColor: '#42B4AF',
              color: '#FFFFFF',
              borderRadius: 1,
              padding: '8px 24px',
              textTransform: 'none',
              fontWeight: 500,
              transition: 'all 0.2s ease',
              '&:hover': {
                backgroundColor: '#3B9F9B',
              }
            },
            // Footer
            '& .sv-footer': {
              padding: '16px 0 0 0',
              marginTop: 4,
              borderTop: `1px solid ${theme.palette.divider}`,
            }
          }}>
            <SurveyComponent setTitle={setTitle} />
          </Box>
        </Paper>
      </Container>
    </Box>
  );
};

export default Survey;