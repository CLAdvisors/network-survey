import React from 'react';
import ReactDOM from 'react-dom';
import App from './App';
import { createTheme, ThemeProvider } from '@mui/material/styles';

const theme = createTheme({
    palette: {
      primary: {
        main: '#42B3AF', // Updated green color for primary palette
      },
      text: {
        primary: '#333', // Darker text for better contrast
      },
      background: {
        default: '#f9f9f9', // Optional: Light background color
      },
    },
    typography: {
      h6: {
        fontWeight: 900, // Title weight adjusted to be bolder than bold
        color: '#42B3AF', // Green shade for titles
      },
    },
  });

ReactDOM.render(
    <ThemeProvider theme={theme}>
        <React.StrictMode>
            <App />
        </React.StrictMode>,
    </ThemeProvider>,
  document.getElementById('root')
);
