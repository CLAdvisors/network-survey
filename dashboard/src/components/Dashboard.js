import React from 'react';
import SurveyTable from './SurveyTable';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import RespondentTable from './RespondentTable';

const Dashboard = () => {
  return (
    <Box sx={{ padding: '20px' }}>
        <Box  sx={{ padding: '10px' }}>   
            <Typography
            variant="h5"
            color="#42B3AF"
            sx={{
            fontWeight: 'bold',
            marginBottom: '20px',
            borderBottom: '2px solid',
            borderColor: 'black', // Updated line color
            paddingBottom: '10px',
            width: 'fit-content',
            }}
            >
                Surveys
            </Typography>
            <SurveyTable />
        </Box>
        <Box  sx={{ padding: '10px' }}>
            <Typography
                variant="h5"
                color="#42B3AF"
                sx={{
                fontWeight: 'bold',
                marginBottom: '20px',
                borderBottom: '2px solid',
                borderColor: 'black', // Updated line color
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
