import React from 'react';
import ReactDOM from 'react-dom';
import App from './App';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { AuthProvider } from './context/AuthContext';

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
        fontWeight: 'bold', // Title weight adjusted to be bolder than bold
        color: '#42B3AF', // Green shade for titles
      },
    },
    components: {
        MuiCssBaseline: {
          styleOverrides: {
            'html, body': {
              margin: 0,
              padding: 0,
              overflow: 'hidden',
              height: '100%'
            },
            '#root': {
              height: '100%',
              overflow: 'hidden'
            }
          },
        },
      },
  });

ReactDOM.render(
    <ThemeProvider theme={theme}>
         <AuthProvider>
        <React.StrictMode>
            <App />
        </React.StrictMode>,
        </AuthProvider>
    </ThemeProvider>,
  document.getElementById('root')
);
