import React, { useState } from 'react';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import DeleteIcon from '@mui/icons-material/Delete';
import { useTheme } from '@mui/material/styles';
import axios from 'axios';

const api = axios.create({
    baseURL: `${process.env.REACT_APP_API_PROTOCOL}://${process.env.REACT_APP_API_HOST}:${process.env.REACT_APP_API_PORT}`,
    // headers: {
    //   'Authorization': 'Bearer your-token', // Example header
    // },
});

const SurveyForm = () => {
  const theme = useTheme(); // Get the current theme (light/dark mode)

  

  const [formData, setFormData] = useState({
    surveyName: '',
    csvData: null,
    emailNotification: '',
    questions: [],
  });

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((prevData) => ({
      ...prevData,
      [name]: value,
    }));
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      const fileContent = e.target.result;
      console.log(fileContent);
      setFormData((prevData) => ({
        ...prevData,
        csvData: fileContent,
      }));
    };
    reader.readAsText(file);
  };

  const handleQuestionChange = (index, value) => {
    const updatedQuestions = [...formData.questions];
    updatedQuestions[index] = value;
    setFormData((prevData) => ({
      ...prevData,
      questions: updatedQuestions,
    }));
  };

  const handleAddQuestion = () => {
    setFormData((prevData) => ({
      ...prevData,
      questions: [...prevData.questions, ''],
    }));
  };

  const handleRemoveQuestion = (index) => {
    const updatedQuestions = formData.questions.filter((_, i) => i !== index);
    setFormData((prevData) => ({
      ...prevData,
      questions: updatedQuestions,
    }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    
    const csvHeader = 'Title,Question name,Question title,Question type\n';
    const csvRows = formData.questions.map((question, index) => {
      const questionName = `question_${index + 1}`;
      const questionTitle = question;
      const questionType = 'tagbox';
      return `${index === 0 ? formData.surveyName : ''},${questionName},${questionTitle},${questionType}`;
    });
    const csvString = csvHeader + csvRows.join('\n');
    formData.questions = csvString;

    console.log(formData);

    api.post('/api/survey', formData).then((response) => 
    {
        console.log(response);
        if(response.status === 200) {
            api.post('/api/updateTargets', formData)
            api.post('/api/updateQuestions', formData)
        }
    });

    setFormData({
      surveyName: '',
      csvData: null,
      emailNotification: '',
      questions: [],
    });
  };

  return (
    <Box
      sx={{
        padding: '20px',
        marginLeft: '10%',
        marginRight: '10%',
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: '8px',
        boxShadow: theme.palette.mode === 'light' ? '0 4px 8px rgba(0, 0, 0, 0.1)' : '0 4px 8px rgba(0, 0, 0, 0.3)',
        backgroundColor: theme.palette.background.paper, // Dynamically adjusts based on theme
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
        Create Survey
      </Typography>
      <form onSubmit={handleSubmit}>
        {/* Survey Name */}
        <TextField
          fullWidth
          label="Survey Name"
          name="surveyName"
          value={formData.surveyName}
          onChange={handleChange}
          sx={{ marginBottom: '16px' }}
          variant="outlined"
        />

        {/* File Upload for Respondents */}
        <Box sx={{ marginBottom: '16px' }}>
          <Typography
            variant="body1"
            color="text.primary"
            sx={{ fontWeight: 'bold', marginBottom: '8px' }}
          >
            Upload Respondents Dataset
          </Typography>
          <Button
            variant="outlined"
            component="label"
            sx={{
              color: 'primary.main',
              borderColor: 'primary.main',
              '&:hover': {
                backgroundColor: theme.palette.action.hover,
              },
            }}
          >
            Choose File
            <input
              type="file"
              accept=".csv, .xlsx"
              hidden
              onChange={handleFileUpload}
            />
          </Button>
          {formData.csvData && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ marginTop: '8px' }}
            >
              Selected File: {formData.csvData.name}
            </Typography>
          )}
        </Box>

        {/* Email Notification */}
        <TextField
          fullWidth
          multiline
          rows={4}
          label="Email Notification Text"
          name="emailNotification"
          value={formData.emailNotification}
          onChange={handleChange}
          sx={{ marginBottom: '24px' }}
          variant="outlined"
        />

        {/* Dynamic Questions Section */}
        <Box sx={{ marginBottom: '16px' }}>
          <Typography
            variant="h6"
            color="text.primary"
            sx={{ fontWeight: 'bold', marginBottom: '10px' }}
          >
            Questions
          </Typography>
          {formData.questions.map((question, index) => (
            <Box
              key={index}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                marginBottom: '10px',
              }}
            >
              <TextField
                fullWidth
                label={`Question ${index + 1}`}
                value={question}
                onChange={(e) => handleQuestionChange(index, e.target.value)}
                variant="outlined"
              />
              <IconButton
                aria-label="delete question"
                onClick={() => handleRemoveQuestion(index)}
                sx={{ color: 'error.main' }}
              >
                <DeleteIcon />
              </IconButton>
            </Box>
          ))}
          <Button
            variant="outlined"
            onClick={handleAddQuestion}
            sx={{
              color: 'primary.main',
              borderColor: 'primary.main',
              '&:hover': {
                backgroundColor: theme.palette.action.hover,
              },
            }}
          >
            Add Question
          </Button>
        </Box>

        {/* Submit Button */}
        <Button
          type="submit"
          variant="contained"
          sx={{
            backgroundColor: 'primary.main',
            color: theme.palette.getContrastText(theme.palette.primary.main),
            fontWeight: 'bold',
            padding: '10px 20px',
            '&:hover': {
              backgroundColor: theme.palette.primary.dark,
            },
          }}
        >
          Submit
        </Button>
      </form>
    </Box>
  );
};

export default SurveyForm;
