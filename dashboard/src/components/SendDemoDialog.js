import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { LANGUAGES } from '@network-survey/frontend-shared';

const SendDemoDialog = ({ open, onClose, onSubmit, surveyName, loading = false }) => {
  const [email, setEmail] = useState('');
  const [language, setLanguage] = useState('English');
  const [error, setError] = useState('');
  const theme = useTheme();

  useEffect(() => {
    if (!open) {
      setEmail('');
      setLanguage('English');
      setError('');
    }
  }, [open]);

  const handleSubmit = () => {
    if (!email.trim()) {
      setError('Email is required');
      return;
    }
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Please enter a valid email address');
      return;
    }
    onSubmit(email.trim(), language);
  };

  const handleClose = () => {
    setEmail('');
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
        Send Demo Survey
      </DialogTitle>
      <DialogContent sx={{ mt: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Send a no-results demo of “{surveyName}” using its configured email text and survey.
        </Typography>
        <TextField
          autoFocus
          margin="dense"
          label="Email Address"
          type="email"
          fullWidth
          variant="outlined"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError('');
          }}
          error={!!error}
          helperText={error}
          sx={{ mb: 2 }}
        />
        <FormControl fullWidth variant="outlined">
          <InputLabel>Language</InputLabel>
          <Select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            label="Language"
          >
            {LANGUAGES.map(({ code, label }) => (
              <MenuItem key={code} value={label}>{label}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </DialogContent>
      <DialogActions sx={{ p: 2, pt: 0 }}>
        <Button onClick={handleClose} variant="outlined" disabled={loading}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={loading}>
          {loading ? 'Sending…' : 'Send Demo'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default SendDemoDialog;