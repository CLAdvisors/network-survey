import React, { useState, useEffect, useMemo } from 'react';
import { Box, Button, Typography, Select, MenuItem, FormControl, InputLabel, Switch, FormControlLabel, Checkbox } from '@mui/material';
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
  const [showAllUsers, setShowAllUsers] = useState(false);
  const [enabledQuestions, setEnabledQuestions] = useState({});

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
        
        // Initialize all questions as enabled
        const initialQuestionStates = {};
        questionsResponse.data.questions.forEach((_, index) => {
          initialQuestionStates[`question_${index + 1}`] = true;
        });
        setEnabledQuestions(initialQuestionStates);
      } catch (error) {
        console.error('Error fetching survey data:', error);
      }
    };

    fetchSurveyData();
    setSelectedRespondent(null); // Reset selection when changing surveys
  }, [selectedSurvey]);

  // Memoize filtered survey data
  const filteredSurveyData = useMemo(() => {
    if (!surveyData) return null;

    // Create a deep copy of the survey data to avoid modifying the original
    const filteredData = {
      ...surveyData,
      responses: {},
      users: surveyData.users ? [...surveyData.users] : []
    };

    // Filter responses based on enabled questions
    Object.entries(surveyData.responses).forEach(([respondent, answers]) => {
      filteredData.responses[respondent] = {};
      Object.entries(answers).forEach(([questionId, recipients]) => {
        if (questionId === 'timeStamp' || enabledQuestions[questionId]) {
          filteredData.responses[respondent][questionId] = recipients;
        }
      });
    });

    return filteredData;
  }, [surveyData, enabledQuestions]);

  // Handle respondent selection
  const handleRespondentSelect = (newRespondent) => {
    if (selectedRespondent === newRespondent) {
      setSelectedRespondent(null);
    } else {
      setSelectedRespondent(newRespondent);
    }
  };

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
      questionText: question.text,
      enabled: enabledQuestions[`question_${index + 1}`]
    }));
  };

  // Handle question toggle
  const handleQuestionToggle = (questionNumber) => {
    setEnabledQuestions(prev => ({
      ...prev,
      [questionNumber]: !prev[questionNumber]
    }));
    setSelectedRespondent(null);
  };

  // Handle download
  const handleDownload = () => {
    if (!surveyData || !surveyData.responses) return;

    const edges = [];
    Object.entries(surveyData.responses).forEach(([respondent, answers]) => {
      Object.entries(answers).forEach(([questionId, nominees]) => {
        if (!enabledQuestions[questionId] || questionId === 'timeStamp') return;
        
        const nomineeArray = Array.isArray(nominees) ? nominees : [nominees];
        if (!nomineeArray || nomineeArray.length === 0) return;
        
        nomineeArray.forEach(nominee => {
          if (!nominee) return;
          
          const [nomineeName, nomineeEmail] = nominee.split(' (');
          const cleanEmail = (nomineeEmail || '').replace(')', '');
          
          edges.push({
            source: respondent,
            target: `${nomineeName}${cleanEmail ? ` (${cleanEmail})` : ''}`,
            weight: questionId.replace('question_', '')
          });
        });
      });
    });

    const csvContent = [
      ['Source', 'Target', 'Weight'].join(','),
      ...edges.map(edge => `${edge.source},${edge.target},${edge.weight}`)
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedSurvey}_edge_list.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  return (
    <Box sx={{ p: 4 }}>
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
          <Box sx={{ width: '25%', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <CollapsibleSection title="Respondents">
              <Box sx={{ height: '300px', width: '100%' }}>
                <DataGrid
                  rows={respondentRows}
                  columns={respondentColumns}
                  pageSize={5}
                  onRowClick={(params) => handleRespondentSelect(params.row.name)}
                  selectionModel={selectedRespondent ? [respondentRows.find(r => r.name === selectedRespondent)?.id] : []}
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

          <Box sx={{ flex: 1 }}>
            <CollapsibleSection title="Network Visualization">
              <Box sx={{ height: '700px', width: '100%' }}>
                <NetworkGraph
                  data={filteredSurveyData}
                  selectedRespondent={selectedRespondent}
                  onNodeClick={handleRespondentSelect}
                  showAllUsers={showAllUsers}
                />
              </Box>
            </CollapsibleSection>
          </Box>

          <Box sx={{ width: '20%', display: 'flex', flexDirection: 'column', gap: 2 }}>
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
                    <Checkbox
                      checked={item.enabled}
                      onChange={() => handleQuestionToggle(item.questionNumber)}
                      sx={{ 
                        color: d3.schemeTableau10[index],
                        '&.Mui-checked': {
                          color: d3.schemeTableau10[index],
                        }
                      }}
                    />
                    <Box 
                      sx={{ 
                        width: 20, 
                        height: 3, 
                        backgroundColor: item.enabled ? d3.schemeTableau10[index] : '#ccc',
                        borderRadius: 1
                      }} 
                    />
                    <Typography 
                      variant="caption" 
                      sx={{ 
                        color: item.enabled ? 'text.secondary' : 'text.disabled'
                      }}
                    >
                      {item.questionText}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </CollapsibleSection>

            <CollapsibleSection title="Settings">
              <Box sx={{ p: 2 }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={showAllUsers}
                      onChange={(e) => {
                        setSelectedRespondent(null);
                        return setShowAllUsers(e.target.checked)
                      }}
                    />
                  }
                  label="Show all users"
                />
              </Box>
            </CollapsibleSection>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default Results;