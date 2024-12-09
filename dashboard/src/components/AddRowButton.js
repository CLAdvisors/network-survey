import React from 'react';
import { Button, Zoom } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';

const AddRowButton = ({ onClick }) => {
  return (
    <Zoom in={true} style={{ transitionDelay: '100ms' }}>
      <Button
        variant="outlined"
        startIcon={<AddIcon />}
        onClick={onClick}
        size="small"
        sx={{
          borderRadius: '20px',
          textTransform: 'none',
          mr: 1,
          '&:hover': {
            backgroundColor: 'rgba(66, 179, 175, 0.1)',
          }
        }}
      >
        Add Row
      </Button>
    </Zoom>
  );
};

export default AddRowButton;