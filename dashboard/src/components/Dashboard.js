import React from "react";
import SurveyTable from "./SurveyTable";
import { Box, Button } from "@mui/material";
import { useTheme } from "@emotion/react";
import RespondentTable from "./RespondentTable";
import AddIcon from "@mui/icons-material/Add";
import api from "../api/axios";
import QuestionTable from "./QuestionTable";
import CreateSurveyDialog from "./CreateSurveyDialog";
import EmailNotificationEditor from "./EmailNotificationEditor";
import CollapsibleSection from "./CollapsibleSection";
import { useAuth } from "../context/AuthContext";

const Dashboard = () => {
  const theme = useTheme();
  const [surveyData, setSurveyData] = React.useState(null);
  const [selectSurvey, setSelectSurvey] = React.useState(null);
  const [questionData, setQuestionData] = React.useState(null);
  const [respondentData, setRespondentData] = React.useState(null);
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const { memberships, canViewSensitiveSurveyData, canEditSurvey } = useAuth();

  const fetchSurveyData = async () => {
    try {
      const response = await api.get("/surveys");
      setSurveyData(response.data.surveys);
      
      // Update selected survey if it still exists
      if (selectSurvey) {
        const surveyStillExists = response.data.surveys.find(
          survey => survey.name === selectSurvey.name
        );
        if (!surveyStillExists) {
          setSelectSurvey(null);
          setQuestionData(null);
          setRespondentData(null);
        }
      }
    } catch (err) {
      console.log(err);
    }
  };

  React.useEffect(() => {
    fetchSurveyData();
  }, []);

  React.useEffect(() => {
    const fetchRelatedData = async () => {
      if (!selectSurvey) return;

      try {
        // Fetch question data; viewers are allowed to see question text.
        const questionResponse = await api.get(
          `/listQuestions?surveyName=${selectSurvey.name}`
        );
        setQuestionData(questionResponse.data.questions);
      } catch (err) {
        console.log(err);
        setQuestionData(null);
      }

      if (!canViewSensitiveSurveyData(selectSurvey)) {
        setRespondentData(null);
        return;
      }

      try {
        // Fetch respondent data for analyst+ roles only because it includes PII.
        const respondentResponse = await api.get(
          `/targets?surveyName=${selectSurvey.name}`
        );

        // Remove dummy user with name 'None'
        const filteredRespondents = respondentResponse.data.filter(
          (respondent) => respondent.name !== "None"
        );
        setRespondentData(filteredRespondents);
      } catch (err) {
        console.log(err);
        setRespondentData(null);
      }
    };

    fetchRelatedData();
  }, [selectSurvey, canViewSensitiveSurveyData]);

  const handleSelectRow = (childData) => {
    setSelectSurvey(childData);
  };

  const handleCreateSurvey = async (surveyName, organizationId) => {
    try {
      const response = await api.post("/survey", { surveyName, organizationId });
      if (response.status === 200) {
        await fetchSurveyData();
      }
      setCreateDialogOpen(false);
    } catch (err) {
      console.error("Failed to create survey:", err);
    }
  };

  const handleSurveyDeleted = async (deletedSurveyName) => {
    await fetchSurveyData();
    if (selectSurvey && selectSurvey.name === deletedSurveyName) {
      setSelectSurvey(null);
      setQuestionData(null);
      setRespondentData(null);
    }
  };

  const handleRespondentsUpdate = (updatedSurveys) => {
    setSurveyData(updatedSurveys);
  };

  const handleQuestionsUpdate = (updatedSurveys) => {
    setSurveyData(updatedSurveys);
  };

  return (
    <Box
      sx={{
        marginTop: "20px",
        padding: "40px",
        marginLeft: "13%",
        marginRight: "13%",
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: "8px",
        boxShadow: theme.palette.mode === "light"
          ? "0 4px 8px rgba(0, 0, 0, 0.1)"
          : "0 4px 8px rgba(0, 0, 0, 0.3)",
        backgroundColor: theme.palette.background.paper,
      }}
    >
      <CollapsibleSection 
        title="Surveys"
        actions={
          memberships?.some(m => ['owner', 'admin', 'editor'].includes(m.role)) ? (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setCreateDialogOpen(true)}
              size="small"
            >
              Create Survey
            </Button>
          ) : null
        }
      >
        <SurveyTable 
          rows={surveyData} 
          selectRow={handleSelectRow}
          onSurveyDeleted={handleSurveyDeleted}
          selectedSurvey={selectSurvey}
        />
      </CollapsibleSection>

      <CreateSurveyDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onSubmit={handleCreateSurvey}
        memberships={memberships}
      />

      <CollapsibleSection title="Survey Questions">
        <QuestionTable 
          rows={questionData} 
          surveyName={selectSurvey?.name}
          onQuestionsUpdate={handleQuestionsUpdate}
          readOnly={!canEditSurvey(selectSurvey)}
        />
      </CollapsibleSection>

      {canEditSurvey(selectSurvey) && (
        <CollapsibleSection title="Email Notifications">
          <EmailNotificationEditor surveyId={selectSurvey?.name} />
        </CollapsibleSection>
      )}

      {canViewSensitiveSurveyData(selectSurvey) && (
        <CollapsibleSection title="Survey Respondents">
          <RespondentTable
            rows={respondentData}
            surveyName={selectSurvey?.name}
            onRespondentsUpdate={handleRespondentsUpdate}
            readOnly={!canEditSurvey(selectSurvey)}
          />
        </CollapsibleSection>
      )}
    </Box>
  );
};

export default Dashboard;