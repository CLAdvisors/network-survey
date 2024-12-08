import React from 'react';
import NetworkBackground from './NetworkBackground';
import { Box } from '@mui/material';

const AuthLayout = ({ children }) => {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        width: '100%',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      <NetworkBackground />
      <Box
        sx={{
          position: 'relative',
          zIndex: 2,
          width: '100%',
          height: '100%'
        }}
      >
        {children}
      </Box>
    </Box>
  );
};

export default AuthLayout;