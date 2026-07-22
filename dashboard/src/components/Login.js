import React, { useState } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  Box,
  Paper,
  TextField,
  Button,
  Typography,
  CircularProgress,
  Alert,
  Link,
  InputAdornment,
  IconButton,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import NetworkBackground from './NetworkBackground';
import { BRAND } from '@network-survey/frontend-shared';

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuth();
  const theme = useTheme();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    const success = await login(username, password);
    
    if (success) {
      navigate('/');
    } else {
      setError('Invalid credentials');
    }
    
    setIsLoading(false);
  };

  return (
    <Box
      sx={{
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        position: 'fixed',
      }}
    >
      {/* Zoom container that scales all content */}
      <Box
        sx={{
          height: '100%',
          width: '100%',
          position: 'relative',
          transform: 'scale(1.2)',
          transformOrigin: 'center center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
        }}
      >
        <NetworkBackground scale={1.5} />
        <Paper
          elevation={3}
          sx={{
            padding: '40px',
            width: '100%',
            maxWidth: '400px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            position: 'relative',
            zIndex: 1,
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '20px',
            }}
          >
            <img
              src={BRAND.faviconUrl}
              alt="logo"
              style={{ height: '48px', marginRight: '16px' }}
            />
            <Typography
              variant="h5"
              sx={{
                color: theme.palette.primary.main,
                fontWeight: 900,
              }}
            >
              ONA Dashboard Login
            </Typography>
          </Box>

          {error && (
            <Alert severity="error" sx={{ width: '100%' }}>
              {error}
            </Alert>
          )}

          <form onSubmit={handleSubmit} style={{ width: '100%' }}>
            <TextField
              fullWidth
              label="Username"
              variant="outlined"
              margin="normal"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={isLoading}
            />
            <TextField
              fullWidth
              label="Password"
              type={showPassword ? 'text' : 'password'}
              variant="outlined"
              margin="normal"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPassword((current) => !current)}
                      onMouseDown={(e) => e.preventDefault()}
                      edge="end"
                      disabled={isLoading}
                    >
                      {showPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
            <Button
              type="submit"
              fullWidth
              variant="contained"
              color="primary"
              size="large"
              disabled={isLoading}
              sx={{ mt: 3 }}
            >
              {isLoading ? (
                <CircularProgress size={24} color="inherit" />
              ) : (
                'Sign In'
              )}
            </Button>
          </form>

          <Box sx={{ mt: 2, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              Don't have an account?{' '}
              <Link
                component={RouterLink}
                to="/signup"
                color="primary"
                sx={{ cursor: 'pointer' }}
              >
                Sign up
              </Link>
            </Typography>
          </Box>
        </Paper>
      </Box>
    </Box>
  );
};

export default Login;