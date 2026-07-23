import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { AppThemeProvider } from '@network-survey/frontend-react';
import { AuthProvider } from './context/AuthContext';

const root = createRoot(document.getElementById('root'));

root.render(
    <AppThemeProvider>
        <AuthProvider>
            <React.StrictMode>
                <App />
            </React.StrictMode>
        </AuthProvider>
    </AppThemeProvider>
);
