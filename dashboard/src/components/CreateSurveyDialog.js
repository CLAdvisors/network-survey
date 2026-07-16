import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  MenuItem,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';

const CreateSurveyDialog = ({ open, onClose, onSubmit, memberships = [] }) => {
  const [surveyName, setSurveyName] = React.useState('');
  const [organizationId, setOrganizationId] = React.useState('');
  const [error, setError] = React.useState('');
  const theme = useTheme();
  const creatableMemberships = memberships.filter(m => ['owner', 'admin', 'editor'].includes(m.role));

  const handleSubmit = () => {
    if (!surveyName.trim()) {
      setError('Survey name is required');
      return;
    }
    if (!/^[a-zA-Z0-9]+$/.test(surveyName)) {
      setError('Only letters and numbers are allowed');
      return;
    }
    if (creatableMemberships.length > 1 && !organizationId) {
      setError('Choose an organization for this survey');
      return;
    }
    onSubmit(surveyName, organizationId || undefined);
    setSurveyName('');
    setOrganizationId('');
    setError('');
  };

  const handleInputChange = (e) => {
    const value = e.target.value;
    if (value && !/^[a-zA-Z0-9]*$/.test(value)) {
      setError('Only letters and numbers are allowed');
    } else {
      setError('');
    }
    setSurveyName(value);
  };

  const handleClose = () => {
    setSurveyName('');
    setOrganizationId('');
    setError('');
    onClose();
  };

  return (
    <Dialog 
      open={open} 
      onClose={handleClose}
      PaperProps={{
        sx: {
          borderRadius: 2,
          width: '100%',
          maxWidth: '400px',
        }
      }}
    >
      <DialogTitle
        sx={{
          borderBottom: `2px solid ${theme.palette.primary.main}`,
          pb: 1,
          fontWeight: 'bold',
        }}
      >
        Create New Survey
      </DialogTitle>
      <DialogContent sx={{ mt: 2 }}>
        <TextField
          autoFocus
          margin="dense"
          label="Survey Name"
          fullWidth
          variant="outlined"
          value={surveyName}
          onChange={handleInputChange}
          error={!!error}
          helperText={error}
          sx={{ mt: 1 }}
        />
        {creatableMemberships.length > 1 && (
          <TextField
            select
            margin="dense"
            label="Organization"
            fullWidth
            value={organizationId}
            onChange={(e) => setOrganizationId(e.target.value)}
          >
            {creatableMemberships.map((membership) => (
              <MenuItem key={membership.organizationId} value={membership.organizationId}>
                {membership.organizationName || membership.organizationSlug || membership.organizationId}
              </MenuItem>
            ))}
          </TextField>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2, pt: 0 }}>
        <Button onClick={handleClose} variant="outlined">
          Cancel
        </Button>
        <Button onClick={handleSubmit} variant="contained">
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CreateSurveyDialog;
