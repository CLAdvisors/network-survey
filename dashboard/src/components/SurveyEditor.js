import React, { useEffect, useState, useRef } from 'react';
import { SurveyCreator, SurveyCreatorComponent } from 'survey-creator-react';
import "survey-core/survey-core.css";
import "survey-creator-core/survey-creator-core.css";
import { Box, Autocomplete, TextField, Button, CircularProgress } from '@mui/material';
import api from '../api/axios';

const SurveyEditor = () => {
  const [surveys, setSurveys] = useState([]);
  const [selectedSurvey, setSelectedSurvey] = useState(null);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const creatorRef = useRef(null);

  // Fetch surveys on mount
  useEffect(() => {
    const fetchSurveys = async () => {
      setLoading(true);
      try {
        const response = await api.get('/surveys');
        setSurveys(response.data.surveys || []);
      } catch (err) {
        setSurveys([]);
      } finally {
        setLoading(false);
      }
    };
    fetchSurveys();
  }, []);

  // SurveyJS Creator setup
  const creatorOptions = {
    showLogicTab: false,
    showJSONEditorTab: false,
    isAutoSave: false,
    showPagesPanel: false, // Hide the pages panel
    pageEditMode: 'single', // Only allow a single page (prevents adding pages)
    questionTypes: [
      // Optionally, restrict question types if needed
    ],
  };
  if (!creatorRef.current) {
    creatorRef.current = new SurveyCreator(creatorOptions);
  }
  const creator = creatorRef.current;

  // Remove pages from loaded survey JSON (flatten to single elements array)
  useEffect(() => {
    if (!selectedSurvey) {
      creator.JSON = {};
      return;
    }
    const loadSurvey = async () => {
      setLoading(true);
      try {
        // Use the full survey JSON endpoint
        const response = await api.get(`/questions?surveyName=${selectedSurvey}`);
        let json = response.data.questions || {};
        // Flatten any pages into a single elements array
        let elements = [];
        if (Array.isArray(json.pages)) {
          json.pages.forEach(page => {
            if (Array.isArray(page.elements)) {
              elements.push(...page.elements);
            }
          });
        } else if (Array.isArray(json.elements)) {
          elements = json.elements;
        }
        creator.JSON = { elements };
      } catch (err) {
        creator.JSON = {};
      } finally {
        setLoading(false);
      }
    };
    loadSurvey();
  }, [selectedSurvey, creator]);

  // Save handler (always use current JSON from creator, flatten pages if present)
  const handleSaveSurvey = async () => {
    if (!selectedSurvey) return;
    setSaving(true);
    try {
      let rawJson = creator.JSON;
      let elements = [];
      if (Array.isArray(rawJson.pages)) {
        // Flatten all elements from all pages
        rawJson.pages.forEach(page => {
          if (Array.isArray(page.elements)) {
            elements.push(...page.elements);
          }
        });
      } else if (Array.isArray(rawJson.elements)) {
        elements = rawJson.elements;
      }
      // Save in the desired format
      const questions = { elements };
      await api.post('/updateQuestions', {
        surveyName: selectedSurvey,
        questions
      });
    } catch (err) {
      // Optionally show error
    } finally {
      setSaving(false);
    }
  };

  // Handle survey selection or creation
  const handleSurveyChange = (event, newValue) => {
    if (typeof newValue === 'string') {
      setSelectedSurvey(newValue);
    } else if (newValue && newValue.name) {
      setSelectedSurvey(newValue.name);
    } else {
      setSelectedSurvey(null);
    }
  };

  return (
    <Box sx={{ marginTop: '20px', marginLeft: '2%', marginRight: '2%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <Autocomplete
          freeSolo
          options={surveys.map(s => s.name)}
          value={selectedSurvey || ''}
          onChange={handleSurveyChange}
          inputValue={inputValue}
          onInputChange={(e, v) => setInputValue(v)}
          renderInput={(params) => (
            <TextField {...params} label="Select or Create Survey" variant="outlined" size="small" />
          )}
          sx={{ minWidth: 300 }}
        />
        {saving && <CircularProgress size={24} />}
        <Button
          variant="contained"
          onClick={handleSaveSurvey}
          disabled={!selectedSurvey || saving}
        >
          Save Survey
        </Button>
      </Box>
      <Box
        sx={{
          padding: '20px',
          height: 'calc(100vh - 120px)',
          border: '1px solid #ccc',
          borderRadius: '8px',
          backgroundColor: '#fff',
          overflow: 'auto',
        }}
      >
        {loading ? <CircularProgress /> : <SurveyCreatorComponent creator={creator} />}
      </Box>
    </Box>
  );
};

export default SurveyEditor;
