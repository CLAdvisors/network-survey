import React from 'react';
import SurveyTable from './SurveyTable';
import Typography from '@mui/material/Typography';
import Container from '@mui/material/Container';
import Box from '@mui/material/Box';
import { useTheme } from '@emotion/react';
import RespondentTable from './RespondentTable';



const Dashboard = () => {

    const theme = useTheme();

  return (
    <Box sx={{
        padding: '20px',
        marginLeft: '10%',
        marginRight: '10%',
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: '8px',
        boxShadow: theme.palette.mode === 'light' ? '0 4px 8px rgba(0, 0, 0, 0.1)' : '0 4px 8px rgba(0, 0, 0, 0.3)',
        backgroundColor: theme.palette.background.paper, // Dynamically adjusts based on theme
      }}>
        <Box
    sx={{
      padding: '10px',
      borderRadius: '8px',    
    }}
  >
    <Typography
      variant="h4"
      color="primary"
      sx={{
        fontWeight: 'bold',
        marginBottom: '20px',
        borderBottom: '2px solid',
        borderColor: 'primary.main',
        paddingBottom: '10px',
        width: 'fit-content',
      }}
    >
      Surveys
    </Typography>
        <SurveyTable />
    </Box>
    <Box
    sx={{
      padding: '10px',
      borderRadius: '8px',    
    }}
  >
    <Typography
      variant="h4"
      color="primary"
      sx={{
        fontWeight: 'bold',
        marginBottom: '20px',
        borderBottom: '2px solid',
        borderColor: 'primary.main',
        paddingBottom: '10px',
        width: 'fit-content',
      }}
    >
      Respondents
    </Typography>
        <RespondentTable />
    </Box>
    </Box>
    
      
  );
};

export default Dashboard;
