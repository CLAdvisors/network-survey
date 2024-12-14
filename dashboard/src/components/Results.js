import React, { useState, useEffect } from 'react';
import { Box, Button, Typography, Select, MenuItem, FormControl, InputLabel } from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import NetworkGraph from './NetworkGraph';
import api from '../api/axios';
import * as d3 from 'd3';
import CollapsibleSection from './CollapsibleSection';
import DownloadIcon from '@mui/icons-material/Download';

const Results = () => {
  const [surveys, setSurveys] = useState([]);
  const [selectedSurvey, setSelectedSurvey] = useState('');
  const [surveyData, setSurveyData] = useState(null);
  const [selectedRespondent, setSelectedRespondent] = useState(null);
  const [questions, setQuestions] = useState([]);

  // Fetch available surveys
  useEffect(() => {
    const fetchSurveys = async () => {
      try {
        const response = await api.get('/surveys');
        setSurveys(response.data.surveys);
      } catch (error) {
        console.error('Error fetching surveys:', error);
      }
    };
    fetchSurveys();
  }, []);

  // Fetch survey data and questions when survey is selected
  useEffect(() => {
    if (!selectedSurvey) return;

    const fetchSurveyData = async () => {
      try {
        const [resultsResponse, questionsResponse] = await Promise.all([
          api.get(`/results?surveyName=${selectedSurvey}`),
          api.get(`/listQuestions?surveyName=${selectedSurvey}`)
        ]);
        setSurveyData(resultsResponse.data);
        setQuestions(questionsResponse.data.questions);
      } catch (error) {
        console.error('Error fetching survey data:', error);
      }
    };

    fetchSurveyData();
  }, [selectedSurvey]);

  // Respondent table columns
  const respondentColumns = [
    { field: 'name', headerName: 'Respondent', flex: 1 }
  ];

  // Answer table columns
  const answerColumns = [
    { field: 'question', headerName: 'Question', flex: 1 },
    { 
      field: 'answers', 
      headerName: 'Answers', 
      flex: 1,
      renderCell: (params) => {
        const answers = params.value || [];
        const displayAnswers = answers.slice(0, 5);
        const remainingCount = answers.length - 5;
        
        return (
          <div>
            {displayAnswers.map(answer => answer.split(' (')[0]).join(', ')}
            {remainingCount > 0 ? ` and ${remainingCount} more` : ''}
          </div>
        );
      }
    }
  ];

  // Process data for respondent table
  const respondentRows = surveyData?.responses ? 
    Object.keys(surveyData.responses).map((name, index) => ({
      id: index,
      name: name
    })) : [];

  // Process data for answer table
  const getAnswerRows = () => {
    if (!selectedRespondent || !surveyData?.responses[selectedRespondent]) return [];
    
    const responses = surveyData.responses[selectedRespondent];
    return questions.map((question, index) => ({
      id: index,
      question: question.text,
      answers: responses[`question_${index + 1}`] || []
    })).filter(row => row.answers.length > 0);
  };

  // Create legend data
  const getLegendData = () => {
    if (!questions) return [];
    return questions.map((question, index) => ({
      questionNumber: `question_${index + 1}`,
      questionText: question.text
    }));
  };

  const handleDownload = () => {
    if (!surveyData || !surveyData.responses) return;

    // Create the file content
    const fileContent = JSON.stringify(surveyData.responses, null, 2);
    
    // Create a blob from the content
    const blob = new Blob([fileContent], { type: 'application/json' });
    
    // Create download link
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedSurvey}_responses.json`;
    
    // Trigger download
    document.body.appendChild(a);
    a.click();
    
    // Cleanup
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  return (
    <Box sx={{ p: 4 }}>
      {/* Survey selector and download button */}
      <Box sx={{ display: 'flex', gap: 2, mb: 4 }}>
        <FormControl sx={{ flex: 1 }}>
          <InputLabel>Select Survey</InputLabel>
          <Select
            value={selectedSurvey}
            label="Select Survey"
            onChange={(e) => setSelectedSurvey(e.target.value)}
          >
            {surveys.map((survey) => (
              <MenuItem key={survey.name} value={survey.name}>
                {survey.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        
        {selectedSurvey && surveyData && (
          <Button
            variant="contained"
            startIcon={<DownloadIcon />}
            onClick={handleDownload}
            sx={{ minWidth: '200px' }}
          >
            Download Results
          </Button>
        )}
      </Box>

      {selectedSurvey && (
        <Box sx={{ display: 'flex', gap: 4 }}>
          {/* Left side - Tables */}
          <Box sx={{ width: '25%', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <CollapsibleSection title="Respondents">
              <Box sx={{ height: '300px', width: '100%' }}>
                <DataGrid
                  rows={respondentRows}
                  columns={respondentColumns}
                  pageSize={5}
                  onRowClick={(params) => setSelectedRespondent(params.row.name)}
                  sx={{
                    '& .MuiDataGrid-row': {
                      cursor: 'pointer',
                      '&:hover': {
                        backgroundColor: 'rgba(0, 178, 140, 0.1)',
                      },
                      '&.Mui-selected': {
                        backgroundColor: 'rgba(0, 178, 140, 0.2)',
                      }
                    }
                  }}
                />
              </Box>
            </CollapsibleSection>

            <CollapsibleSection title="Responses">
              <Box sx={{ height: '300px', width: '100%' }}>
                <DataGrid
                  rows={getAnswerRows()}
                  columns={answerColumns}
                  pageSize={5}
                  disableSelectionOnClick
                />
              </Box>
            </CollapsibleSection>
          </Box>

          {/* Center - Network Graph */}
          <Box sx={{ flex: 1 }}>
            <CollapsibleSection title="Network Visualization">
              <Box sx={{ height: '700px', width: '100%' }}>
                <NetworkGraph
                  data={surveyData}
                  selectedRespondent={selectedRespondent}
                  onNodeClick={setSelectedRespondent}
                />
              </Box>
            </CollapsibleSection>
          </Box>

          {/* Right side - Legend */}
          <Box sx={{ width: '20%' }}>
            <CollapsibleSection title="Legend">
              <Box sx={{ p: 2 }}>
                {getLegendData().map((item, index) => (
                  <Box 
                    key={item.questionNumber}
                    sx={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      mb: 1,
                      gap: 1
                    }}
                  >
                    <Box 
                      sx={{ 
                        width: 20, 
                        height: 3, 
                        backgroundColor: d3.schemeTableau10[index],
                        borderRadius: 1
                      }} 
                    />
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {item.questionText}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </CollapsibleSection>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default Results;