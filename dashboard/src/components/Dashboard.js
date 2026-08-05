import React from "react";
import SurveyTable from "./SurveyTable";
import { Alert, Box, Button, Snackbar } from "@mui/material";
import { useTheme } from "@emotion/react";
import RespondentTable from "./RespondentTable";
import AddIcon from "@mui/icons-material/Add";
import api from "../api/axios";
import QuestionTable from "./QuestionTable";
import CreateSurveyDialog from "./CreateSurveyDialog";
import EmailNotificationEditor from "./EmailNotificationEditor";
import InvitationSubjectEditor from "./InvitationSubjectEditor";
import CollapsibleSection from "./CollapsibleSection";
import { useAuth } from "../context/AuthContext";
import SurveyLifecyclePanel from "./SurveyLifecyclePanel";
import { lifecycleStatus, surveyId } from "./surveyLifecycle";

const Dashboard = () => {
  const theme = useTheme();
  const [surveyData, setSurveyData] = React.useState(null);
  const [selectSurvey, setSelectSurvey] = React.useState(null);
  const [questionData, setQuestionData] = React.useState(null);
  const [respondentData, setRespondentData] = React.useState(null);
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const [snackbar, setSnackbar] = React.useState(null);
  const surveyRequest = React.useRef(0);
  const relatedRequest = React.useRef(0);
  const { memberships, canViewSensitiveSurveyData, canEditSurvey } = useAuth();

  const fetchSurveyData = React.useCallback(async () => {
    const request = ++surveyRequest.current;
    try {
      const response = await api.get("/surveys");
      if (request !== surveyRequest.current) return response.data.surveys || [];
      const surveys = response.data.surveys || [];
      setSurveyData(surveys);
      setSelectSurvey((current) => {
        if (!current) return null;
        return surveys.find((survey) => surveyId(survey) === surveyId(current)) || null;
      });
      return surveys;
    } catch (err) {
      if (request === surveyRequest.current) {
        setSnackbar({ severity: 'error', message: 'Unable to refresh surveys.' });
      }
      return [];
    }
  }, []);

  React.useEffect(() => {
    fetchSurveyData();
    const timer = setInterval(fetchSurveyData, 30000);
    return () => clearInterval(timer);
  }, [fetchSurveyData]);

  React.useEffect(() => {
    const request = ++relatedRequest.current;
    const controller = new AbortController();
    const fetchRelatedData = async () => {
      if (!selectSurvey) {
        setQuestionData(null);
        setRespondentData(null);
        return;
      }
      const selectedId = surveyId(selectSurvey);
      try {
        const questionResponse = await api.get(`/listQuestions?surveyName=${selectedId}`, { signal: controller.signal });
        if (request === relatedRequest.current) setQuestionData(questionResponse.data.questions);
      } catch (err) {
        if (!controller.signal.aborted && request === relatedRequest.current) setQuestionData(null);
      }

      if (!canViewSensitiveSurveyData(selectSurvey)) {
        if (request === relatedRequest.current) setRespondentData(null);
        return;
      }
      try {
        const respondentResponse = await api.get(`/targets?surveyName=${selectedId}`, { signal: controller.signal });
        const filteredRespondents = respondentResponse.data.filter((respondent) => respondent.name !== "None");
        if (request === relatedRequest.current) setRespondentData(filteredRespondents);
      } catch (err) {
        if (!controller.signal.aborted && request === relatedRequest.current) setRespondentData(null);
      }
    };
    fetchRelatedData();
    return () => controller.abort();
  }, [selectSurvey, canViewSensitiveSurveyData]);

  const handleSelectRow = (childData) => {
    if (surveyId(childData) !== surveyId(selectSurvey)) {
      relatedRequest.current += 1;
      setQuestionData(null);
      setRespondentData(null);
    }
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
      setSnackbar({
        severity: 'error',
        message: err.response?.data?.message || err.response?.data?.error || 'Failed to create survey. Please try again.',
      });
    }
  };

  const handleSurveyCopied = async () => {
    await fetchSurveyData();
  };

  const handleSurveyDeleted = async (deletedSurveyName) => {
    await fetchSurveyData();
    if (selectSurvey && selectSurvey.name === deletedSurveyName) {
      setSelectSurvey(null);
      setQuestionData(null);
      setRespondentData(null);
    }
  };

  const replaceSurveys = (updatedSurveys) => {
    setSurveyData(updatedSurveys);
    setSelectSurvey((current) => current && updatedSurveys.find((survey) => surveyId(survey) === surveyId(current)) || null);
  };

  const handlePanelSurveyRefresh = React.useCallback(async (selectedId) => {
    const surveys = await fetchSurveyData();
    return surveys.find((survey) => surveyId(survey) === selectedId);
  }, [fetchSurveyData]);

  const selectedIsLifecycleLocked = Boolean(selectSurvey) && lifecycleStatus(selectSurvey) !== 'draft';
  const selectedReadOnly = !canEditSurvey(selectSurvey) || selectedIsLifecycleLocked;

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
      <Snackbar
        open={Boolean(snackbar)}
        autoHideDuration={6000}
        onClose={() => setSnackbar(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          severity={snackbar?.severity || 'info'}
          variant="filled"
          onClose={() => setSnackbar(null)}
          sx={{ width: '100%' }}
        >
          {snackbar?.message}
        </Alert>
      </Snackbar>

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
          onSurveyCopied={handleSurveyCopied}
          selectedSurvey={selectSurvey}
          onLifecycleChange={fetchSurveyData}
        />
      </CollapsibleSection>

      <CreateSurveyDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onSubmit={handleCreateSurvey}
        memberships={memberships}
      />

      {selectSurvey && <SurveyLifecyclePanel survey={selectSurvey} onSurveyRefresh={handlePanelSurveyRefresh} />}

      <CollapsibleSection title="Survey Questions">
        {selectedIsLifecycleLocked && <Alert severity="info" sx={{ mb: 2 }}>Questions are read-only while this survey is {lifecycleStatus(selectSurvey)}.</Alert>}
        <QuestionTable
          key={surveyId(selectSurvey) || 'no-survey'}
          rows={questionData} 
          surveyName={surveyId(selectSurvey)}
          onQuestionsUpdate={replaceSurveys}
          readOnly={selectedReadOnly}
        />
      </CollapsibleSection>

      {canEditSurvey(selectSurvey) && (
        <CollapsibleSection title="Email Notifications">
          {selectedIsLifecycleLocked ? (
            <Alert severity="info" sx={{ mb: 2 }}>Invitation subjects are read-only while this survey is {lifecycleStatus(selectSurvey)}.</Alert>
          ) : (
            <InvitationSubjectEditor key={surveyId(selectSurvey)} surveyId={surveyId(selectSurvey)} />
          )}
          <EmailNotificationEditor key={surveyId(selectSurvey)} surveyId={surveyId(selectSurvey)} readOnly={selectedIsLifecycleLocked} />
        </CollapsibleSection>
      )}

      {canViewSensitiveSurveyData(selectSurvey) && (
        <CollapsibleSection title="Survey Respondents">
          {selectedIsLifecycleLocked && <Alert severity="info" sx={{ mb: 2 }}>Respondent identities are read-only while this survey is {lifecycleStatus(selectSurvey)}.</Alert>}
          <RespondentTable
            key={surveyId(selectSurvey)}
            rows={respondentData}
            surveyName={surveyId(selectSurvey)}
            onRespondentsUpdate={replaceSurveys}
            readOnly={selectedReadOnly}
          />
        </CollapsibleSection>
      )}
    </Box>
  );
};

export default Dashboard;