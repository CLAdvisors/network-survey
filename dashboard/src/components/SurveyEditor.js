import React from 'react';
import { SurveyCreator, SurveyCreatorComponent } from 'survey-creator-react';
import "survey-core/survey-core.css";
import "survey-creator-core/survey-creator-core.css";
import { Box } from '@mui/material';

const SurveyEditor = () => {
  const creatorOptions = {
    showLogicTab: false, // Disable the Logic tab
    showJSONEditorTab: false, // Disable the JSON Editor tab
    isAutoSave: true,
  };

  const creator = new SurveyCreator(creatorOptions);

  const handleSaveSurvey = (sender) => {
    console.log("Survey JSON saved:", sender.JSON);
  };

  creator.saveSurveyFunc = handleSaveSurvey;

  return (
    <Box
      sx={{
        marginTop: "20px",
        padding: "20px", // Reduced padding for more content space
        marginLeft: "2%", // Reduced left margin
        marginRight: "2%", // Reduced right margin
        height: "calc(100vh - 40px)", // Use full viewport height minus margins
        border: "1px solid #ccc",
        borderRadius: "8px",
        backgroundColor: "#fff",
        overflow: "auto", // Add scroll if content overflows
      }}
    >
      <SurveyCreatorComponent creator={creator} />
    </Box>
  );
};

export default SurveyEditor;
