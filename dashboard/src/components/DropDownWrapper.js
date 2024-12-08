import React, { useState } from 'react';
import { Collapse, Button, Box } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

// DropdownWrapper component
const DropdownWrapper = ({ children, label = 'Toggle Dropdown' }) => {
  const [open, setOpen] = useState(true);

  // Toggle the open state
  const handleToggle = () => {
    setOpen((prevOpen) => !prevOpen);
  };

  return (
    <Box>
      {/* Button to toggle the dropdown visibility */}
      <Button
        variant="outlined"
        color="primary"
        onClick={handleToggle}
        endIcon={<ExpandMoreIcon />}
      >
        {label}
      </Button>

      {/* Collapse component to hide or show the children */}
      <Collapse in={open}>
        <Box sx={{ mt: 2 }}>{children}</Box>
      </Collapse>
    </Box>
  );
};

export default DropdownWrapper;
