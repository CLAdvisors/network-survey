import React from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { AppProvider, DashboardLayout } from '@toolpad/core';
import Dashboard from './components/Dashboard';
import Survey from './components/Survey';
import Settings from './components/Settings';
import Results from './components/Results';
import DashboardIcon from '@mui/icons-material/Dashboard';
import QuizIcon from '@mui/icons-material/Quiz';
import SettingsIcon from '@mui/icons-material/Settings';
import TimelineIcon from '@mui/icons-material/Timeline';

import { useTheme } from '@mui/material/styles';



const NAVIGATION = [
  { segment: '', title: 'Dashboard', icon: <DashboardIcon style={{ color: 'primary.main' }} /> },
  { segment: 'survey', title: 'Survey Creation', icon: <QuizIcon style={{ color: 'primary.main' }} /> },
  { segment: 'results', title: 'Results', icon: <TimelineIcon style={{ color: 'primary.main' }} /> },
  { segment: 'settings', title: 'Settings', icon: <SettingsIcon style={{ color: 'primary.main' }} /> },
];

const AppContent = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const router = {
    pathname: location.pathname,
    searchParams: new URLSearchParams(location.search),
    navigate: (path) => navigate(path),
  };

  return (
    <AppProvider
      navigation={NAVIGATION}
      router={router}
      theme={useTheme()}
      branding={{
        title: (
          <span
            style={{
              color: 'primary.main',
              fontWeight: 900, // Stronger than bold
              marginLeft: '10px',
              fontSize: '1.5rem', // Larger font size for emphasis
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
      }}
    >
      <DashboardLayout
        sx={{
          padding: '16px', // Adjust padding for spacing
          gap: '16px', // Spacing between elements
        }}
      >
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/survey" element={<Survey />} />
          <Route path="/results" element={<Results />} />
          <Route path="/settings" element={<Settings />} />
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
