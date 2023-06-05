import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import SurveyComponent from './SurveyComponent';
import reportWebVitals from './reportWebVitals';

// TODO for MVP
// - Add privacy policy
// - ???


const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <SurveyComponent />
  </React.StrictMode>
  
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
