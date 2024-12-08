import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Typography,
  Container,
  Stack,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import NetworkBackground from './NetworkBackground';

const Landing = () => {
  const navigate = useNavigate();
  const theme = useTheme();

  return (
    <>
      <NetworkBackground />
      <Container maxWidth="lg">
        <Box
          sx={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            textAlign: 'center',
            position: 'relative',
            zIndex: 1,
          }}
        >
          <Box 
            sx={{ 
              mb: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 2
            }}
          >
            <img
              src="https://contemporaryleadership.com/wp-content/uploads/2021/09/favicon.svg"
              alt="logo"
              style={{ height: '64px' }}
            />
            <Typography
              variant="h2"
              sx={{
                fontWeight: 900,
                color: theme.palette.primary.main,
                textShadow: '0 0 20px rgba(0,0,0,0.1)',
              }}
            >
                CLA organizational Network Analysis
            </Typography>
          </Box>

          <Typography
            variant="h5"
            sx={{
              mb: 6,
              maxWidth: '800px',
              color: theme.palette.text.secondary,
            }}
          >
            Analyze and visualize organizational relationships with our powerful modelings and data collection tools
          </Typography>

          <Stack
            direction="row"
            spacing={2}
            sx={{
              '& .MuiButton-root': {
                px: 4,
                py: 1.5,
              },
            }}
          >
            <Button
              variant="contained"
              size="large"
              onClick={() => navigate('/login')}
            >
              Sign In
            </Button>
            <Button
              variant="outlined"
              size="large"
              onClick={() => navigate('/signup')}
            >
              Create Account
            </Button>
          </Stack>
        </Box>
      </Container>
    </>
  );
};

export default Landing;