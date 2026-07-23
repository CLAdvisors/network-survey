import { createTheme } from '@mui/material/styles';
import { appColors, appRadii } from './tokens.js';

export const appTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: appColors.brand,
      dark: appColors.brandHover,
    },
    background: {
      default: appColors.background,
      paper: appColors.surface,
    },
    text: {
      primary: appColors.text,
    },
    divider: appColors.border,
  },
  shape: {
    borderRadius: appRadii.medium,
  },
  typography: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    h6: {
      fontWeight: 700,
      color: appColors.brand,
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: {
          minHeight: '100%',
        },
        body: {
          minHeight: '100%',
          margin: 0,
          backgroundColor: appColors.background,
        },
        '#root': {
          minHeight: '100%',
        },
      },
    },
  },
});

export default appTheme;
