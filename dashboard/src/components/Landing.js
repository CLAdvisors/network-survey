import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Typography,
  Container,
  Stack,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import NetworkBackground from './NetworkBackground';

const Landing = () => {
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    // Trigger the animation after component mounts
    setIsLoaded(true);
  }, []);

  return (
    // Outer container that maintains fixed size
    <Box
      sx={{
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        position: 'fixed',
      }}
    >
      {/* Zoom container that scales all content */}
      <Box
        sx={{
          height: '100%',
          width: '100%',
          position: 'relative',
          transform: isLoaded ? 'scale(1.25)' : 'scale(1)',
          transition: 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
          transformOrigin: 'center center',
        }}
      >
        <NetworkBackground scale={1.5} /> {/* Increase base scale of network */}
        <Container 
          maxWidth={false}
          sx={{
            height: '100vh',
            maxWidth: isMobile ? '150vw' : '100vw',
            position: 'relative',
            left: isMobile ? '50%' : '0',
            transform: isMobile ? 'translateX(-50%)' : 'none',
          }}
        >
          <Box
            sx={{
              height: '100vh',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              textAlign: 'center',
              position: 'relative',
              zIndex: 1,
              transform: `scale(${isMobile ? 0.65 : 0.85})`,
              transformOrigin: 'center center',
              '& > *': {
                opacity: '1 !important',
              }
            }}
          >
            <Box 
              sx={{ 
                mb: isMobile ? 2 : 4,
                display: 'flex',
                flexDirection: isMobile ? 'column' : 'row',
                alignItems: 'center',
                gap: isMobile ? 1 : 2,
                maxWidth: '100%',
                px: 2
              }}
            >
              <img
                src="https://contemporaryleadership.com/wp-content/uploads/2021/09/favicon.svg"
                alt="logo"
                style={{ 
                  height: isMobile ? '36px' : '64px',
                  marginBottom: isMobile ? '0.5rem' : 0
                }}
              />
              <Typography
                variant={isMobile ? "h4" : "h2"}
                sx={{
                  fontWeight: 900,
                  color: theme.palette.primary.main,
                  textShadow: '0 0 20px rgba(0,0,0,0.1)',
                  fontSize: {
                    xs: '1.5rem',
                    sm: '2rem',
                    md: '3rem'
                  },
                  whiteSpace: 'nowrap'
                }}
              >
                CLA Organizational Network Analysis
              </Typography>
            </Box>

            <Typography
              variant={isMobile ? "body1" : "h5"}
              sx={{
                mb: isMobile ? 3 : 6,
                maxWidth: isMobile ? '100%' : '800px',
                color: theme.palette.text.secondary,
                fontSize: {
                  xs: '0.875rem',
                  sm: '1rem',
                  md: '1.5rem'
                },
                px: 2
              }}
            >
              Analyze and visualize organizational relationships with our powerful modeling and data collection tools
            </Typography>

            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={isMobile ? 1 : 2}
              sx={{
                '& .MuiButton-root': {
                  px: isMobile ? 3 : 4,
                  py: isMobile ? 1 : 1.5,
                  fontSize: isMobile ? '0.875rem' : 'inherit'
                },
              }}
            >
              <Button
                variant="contained"
                size={isMobile ? "medium" : "large"}
                onClick={() => navigate('/login')}
              >
                Sign In
              </Button>
              <Button
                variant="outlined"
                size={isMobile ? "medium" : "large"}
                onClick={() => navigate('/signup')}
              >
                Create Account
              </Button>
            </Stack>
          </Box>
        </Container>
      </Box>
    </Box>
  );
};

export default Landing;