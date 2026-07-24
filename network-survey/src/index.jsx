import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import reportWebVitals from './reportWebVitals';
import { AppThemeProvider } from '@network-survey/frontend-react';

import Survey from './Survey';

const isMobileHarness = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('mobileHarness') === '1';
const MobileSurveyHarness = isMobileHarness
  ? React.lazy(() => import('./MobileSurveyHarness'))
  : null;

// TODO for MVP
// - Add privacy policy
// - ???


const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <AppThemeProvider>
    {isMobileHarness ? (
      <React.Suspense fallback={<div>Loading mobile review harness…</div>}>
        <MobileSurveyHarness />
      </React.Suspense>
    ) : (
      <React.StrictMode>
        <Survey />
      </React.StrictMode>
    )}
  </AppThemeProvider>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
