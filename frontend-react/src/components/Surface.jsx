import React from 'react';
import Paper from '@mui/material/Paper';
import { appShadows } from '../theme/tokens.js';

/** A bordered white content surface shared across application shells. */
export function Surface({ children, sx, ...props }) {
  return (
    <Paper
      {...props}
      elevation={0}
      sx={[
        {
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          boxShadow: appShadows.surface,
        },
        sx,
      ]}
    >
      {children}
    </Paper>
  );
}

export default Surface;
