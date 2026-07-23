import React from 'react';
import Box from '@mui/material/Box';

/** A full-height application page on the shared neutral background. */
export function AppPage({ children, sx, ...props }) {
  return (
    <Box
      {...props}
      sx={[
        {
          minHeight: '100vh',
          bgcolor: 'background.default',
        },
        sx,
      ]}
    >
      {children}
    </Box>
  );
}

export default AppPage;
