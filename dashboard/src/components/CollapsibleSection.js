import React, { useState } from 'react';
import { Box, Typography, IconButton } from '@mui/material';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { Collapse } from '@mui/material';

const CollapsibleSection = ({ title, children, actions }) => {
  const [open, setOpen] = useState(true);

  return (
    <Box sx={{ mb: 5 }}>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 3,
          borderBottom: '2px solid',
          borderColor: 'primary.main',
          pb: 1,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="h6" color="primary" sx={{ fontWeight: 'bold' }}>
            {title}
          </Typography>
          <IconButton
            onClick={() => setOpen(!open)}
            size="small"
            sx={{
              p: 0.5,
              '&:hover': {
                backgroundColor: 'rgba(66, 179, 175, 0.1)',
              },
            }}
          >
            {open ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
          </IconButton>
        </Box>
        {actions}
      </Box>
      <Collapse in={open}>
        {children}
      </Collapse>
    </Box>
  );
};

export default CollapsibleSection;