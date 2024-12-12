import React, { useState } from 'react';
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
} from '@mui/material';
import { useTheme } from '@mui/material/styles';

const SendDemoDialog = ({ open, onClose, onSubmit, surveyName }) => {
  const [email, setEmail] = useState('');
  const [language, setLanguage] = useState('en');
  const [error, setError] = useState('');
  const theme = useTheme();

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
    onSubmit(email, language);
    setEmail('');
    setError('');
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
            <MenuItem value="English">English</MenuItem>
            <MenuItem value="Spanish">Spanish</MenuItem>
            <MenuItem value="French">French</MenuItem>
            <MenuItem value="German">German</MenuItem>
            <MenuItem value="Italian">Italian</MenuItem>
            <MenuItem value="Portuguese">Portuguese</MenuItem>
            <MenuItem value="Dutch">Dutch</MenuItem>
            <MenuItem value="Polish">Polish</MenuItem>
            <MenuItem value="Russian">Russian</MenuItem>
            <MenuItem value="Japanese">Japanese</MenuItem>
            <MenuItem value="Chinese">Chinese</MenuItem>
            <MenuItem value="Korean" >Korean</MenuItem>
          </Select>
        </FormControl>
      </DialogContent>
      <DialogActions sx={{ p: 2, pt: 0 }}>
        <Button onClick={handleClose} variant="outlined">
          Cancel
        </Button>
        <Button onClick={handleSubmit} variant="contained">
          Send Demo
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default SendDemoDialog;