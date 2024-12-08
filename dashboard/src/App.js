import React from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { AppProvider, DashboardLayout } from '@toolpad/core';
import Dashboard from './components/Dashboard';
import Survey from './components/Survey';
import Settings from './components/Settings';
import Results from './components/Results';
import Login from './components/Login';
import SignUp from './components/SignUp'; // Add SignUp import
import DashboardIcon from '@mui/icons-material/Dashboard';
import QuizIcon from '@mui/icons-material/Quiz';
import SettingsIcon from '@mui/icons-material/Settings';
import TimelineIcon from '@mui/icons-material/Timeline';

import { useTheme } from '@mui/material/styles';
import { useAuth } from './context/AuthContext';
import { Box, CircularProgress } from '@mui/material';

const NAVIGATION = [
  { segment: '', title: 'Dashboard', icon: <DashboardIcon style={{ color: 'primary.main' }} /> },
  { segment: 'survey', title: 'Survey Creation', icon: <QuizIcon style={{ color: 'primary.main' }} /> },
  { segment: 'results', title: 'Results', icon: <TimelineIcon style={{ color: 'primary.main' }} /> },
  { segment: 'settings', title: 'Settings', icon: <SettingsIcon style={{ color: 'primary.main' }} /> },
];

const AppContent = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const { isAuthenticated, isLoading } = useAuth();

  const router = {
    pathname: location.pathname,
    searchParams: new URLSearchParams(location.search),
    navigate: (path) => navigate(path),
  };

  if (isLoading) {
    return (
      <Box 
        sx={{ 
          height: '100vh', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          bgcolor: theme.palette.background.default
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  // Common AppProvider configuration
  const appProviderProps = {
    navigation: NAVIGATION,
    router: router,
    theme: theme,
    branding: {
      title: (
        <span
          style={{
            color: theme.palette.primary.main,
            fontWeight: 900,
            fontSize: '1.5rem',
          }}
        >
          CLA Survey Dashboard
        </span>
      ),
      logo: (
        <img
          src="https://contemporaryleadership.com/wp-content/uploads/2021/09/favicon.svg"
          alt="logo"
          style={{ height: '32px', marginRight: '10px' }}
        />
      ),
    },
  };

  if (!isAuthenticated) {
    return (
      <AppProvider {...appProviderProps}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="*" element={<Navigate to="/login" />} />
        </Routes>
      </AppProvider>
    );
  }

  return (
    <AppProvider {...appProviderProps}>
      <DashboardLayout
        sx={{
          padding: '16px',
          gap: '16px',
        }}
      >
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/survey" element={<Survey />} />
          <Route path="/results" element={<Results />} />
          <Route path="/settings" element={<Settings />} />
          {/* Redirect authenticated users trying to access auth pages */}
          <Route path="/login" element={<Navigate to="/" />} />
          <Route path="/signup" element={<Navigate to="/" />} />
          {/* Catch all other routes and redirect to dashboard */}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </DashboardLayout>
    </AppProvider>
  );
};

const App = () => (
  <Router>
    <AppContent />
  </Router>
);

export default App;