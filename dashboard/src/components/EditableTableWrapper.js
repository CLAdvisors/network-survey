import React, { useEffect, useState } from 'react';
import { Box, Button, Fade, useTheme } from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';

const EditableTableWrapper = ({ children, onSave, hasChanges, setHasChanges }) => {
    const theme = useTheme();
    const [showSave, setShowSave] = useState(false);
  
    useEffect(() => {
      setShowSave(hasChanges);
    }, [hasChanges]);
  
    const handleSave = async () => {
      await onSave();
      setHasChanges(false);
    };
  
    return (
      <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
        {children}
        <Fade in={showSave}>
          <Box
            sx={{
              position: 'absolute',
              bottom: '20px',
              right: '20px',
              zIndex: 1000,
            }}
          >
            <Button
              variant="contained"
              startIcon={<SaveIcon />}
              onClick={handleSave}
              sx={{
                backgroundColor: theme.palette.primary.main,
                '&:hover': {
                  backgroundColor: theme.palette.primary.dark,
                },
                boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
                borderRadius: '24px',
                px: 3,
              }}
            >
              Save Changes
            </Button>
          </Box>
        </Fade>
      </Box>
    );
  };
  
  export default EditableTableWrapper;