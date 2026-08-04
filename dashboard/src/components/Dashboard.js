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
import SurveyContentEditor from "./SurveyContentEditor";
import CollapsibleSection from "./CollapsibleSection";
import { useAuth } from "../context/AuthContext";
import { useBlocker } from "react-router-dom";

const Dashboard = () => {
  const theme = useTheme();
  const [surveyData, setSurveyData] = React.useState(null);
  const [selectSurvey, setSelectSurvey] = React.useState(null);
  const [questionData, setQuestionData] = React.useState(null);
  const [respondentData, setRespondentData] = React.useState(null);
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const [snackbar, setSnackbar] = React.useState(null);
  const [contentDirty, setContentDirty] = React.useState(false);
  const [notificationDirty, setNotificationDirty] = React.useState(false);
  const [questionDirty, setQuestionDirty] = React.useState(false);
  const [respondentDirty, setRespondentDirty] = React.useState(false);
  const [contentBusy, setContentBusy] = React.useState(false);
  const [notificationBusy, setNotificationBusy] = React.useState(false);
  const [questionBusy, setQuestionBusy] = React.useState(false);
  const [respondentBusy, setRespondentBusy] = React.useState(false);
  const relatedRequestRef = React.useRef(0);
  const { memberships, canViewSensitiveSurveyData, canEditSurvey } = useAuth();
  const canViewSelectedSurveyData = canViewSensitiveSurveyData(selectSurvey);
  const hasBusyEdits = contentBusy || notificationBusy || questionBusy || respondentBusy;
  const hasDirtyEdits = contentDirty || notificationDirty || questionDirty || respondentDirty;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => (
    (hasBusyEdits || hasDirtyEdits)
    && `${currentLocation.pathname}${currentLocation.search}${currentLocation.hash}`
      !== `${nextLocation.pathname}${nextLocation.search}${nextLocation.hash}`
  ));

  React.useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (hasBusyEdits) {
      setSnackbar({
        severity: 'warning',
        message: 'Please wait for the current save or CSV import to finish before leaving the dashboard.',
      });
      blocker.reset();
      return;
    }
    if (window.confirm('Discard unsaved changes and leave the dashboard?')) blocker.proceed();
    else blocker.reset();
  }, [blocker.state, blocker.proceed, blocker.reset, hasBusyEdits]);

  React.useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!hasBusyEdits && !hasDirtyEdits) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasBusyEdits, hasDirtyEdits]);

  const fetchSurveyData = async () => {
    try {
      const response = await api.get("/surveys");
      setSurveyData(response.data.surveys);
      
      // Update selected survey if it still exists
      if (selectSurvey) {
        const surveyStillExists = response.data.surveys.find(
          survey => (survey.id || survey.name) === (selectSurvey.id || selectSurvey.name)
        );
        if (!surveyStillExists) {
          relatedRequestRef.current += 1;
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
    const requestId = ++relatedRequestRef.current;
    const controller = new AbortController();
    const isCurrent = () => (
      relatedRequestRef.current === requestId && !controller.signal.aborted
    );

    // Never render the previous survey's data under a newly selected heading.
    setQuestionData(null);
    setRespondentData(null);
    if (!selectSurvey) return () => controller.abort();

    const selectedSurveyId = selectSurvey.id || selectSurvey.name;
    const mayViewRespondents = canViewSelectedSurveyData;
    const fetchRelatedData = async () => {
      try {
        const questionResponse = await api.get(
          `/listQuestions?surveyName=${selectedSurveyId}`,
          { signal: controller.signal }
        );
        if (isCurrent()) setQuestionData(questionResponse.data.questions);
      } catch (err) {
        if (isCurrent()) {
          console.log(err);
          setQuestionData(null);
        }
      }

      if (!mayViewRespondents || !isCurrent()) return;

      try {
        const respondentResponse = await api.get(
          `/targets?surveyName=${selectedSurveyId}`,
          { signal: controller.signal }
        );
        if (!isCurrent()) return;
        setRespondentData(respondentResponse.data.filter(
          (respondent) => respondent.name !== "None"
        ));
      } catch (err) {
        if (isCurrent()) {
          console.log(err);
          setRespondentData(null);
        }
      }
    };

    void fetchRelatedData();
    return () => controller.abort();
  }, [selectSurvey, canViewSelectedSurveyData]);

  const handleSelectRow = (childData) => {
    const currentId = selectSurvey?.id || selectSurvey?.name;
    const nextId = childData?.id || childData?.name;
    if (currentId && currentId === nextId) return;
    if (currentId && currentId !== nextId && hasBusyEdits) {
      setSnackbar({
        severity: 'warning',
        message: 'Please wait for the current save or CSV import to finish before switching surveys.',
      });
      return;
    }
    if (currentId && currentId !== nextId && hasDirtyEdits) {
      const shouldDiscard = window.confirm('Discard unsaved changes and switch surveys?');
      if (!shouldDiscard) return;
    }
    // Invalidate in-flight results immediately after all discard guards pass;
    // waiting for the next effect cleanup leaves a microtask-sized stale window.
    relatedRequestRef.current += 1;
    setQuestionData(null);
    setRespondentData(null);
    setContentDirty(false);
    setNotificationDirty(false);
    setQuestionDirty(false);
    setRespondentDirty(false);
    setSelectSurvey(childData);
  };

  const guardSelectedSurveyAction = (survey) => {
    const selectedId = selectSurvey?.id || selectSurvey?.name;
    const actionSurveyId = survey?.id || survey?.name;
    if (!selectedId || selectedId !== actionSurveyId || (!hasBusyEdits && !hasDirtyEdits)) return true;

    setSnackbar({
      severity: 'warning',
      message: hasBusyEdits
        ? 'Please wait for the current save or CSV import to finish before starting or archiving this survey.'
        : 'Save or reset unsaved changes before starting or archiving this survey.',
    });
    return false;
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

  const handleSurveyDeleted = async (deletedSurveyName) => {
    await fetchSurveyData();
    if (selectSurvey && selectSurvey.name === deletedSurveyName) {
      relatedRequestRef.current += 1;
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
          selectedSurvey={selectSurvey}
          guardSurveyAction={guardSelectedSurveyAction}
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
          surveyName={selectSurvey?.id || selectSurvey?.name}
          onQuestionsUpdate={handleQuestionsUpdate}
          readOnly={!canEditSurvey(selectSurvey)}
          onDirtyChange={setQuestionDirty}
          onBusyChange={setQuestionBusy}
        />
      </CollapsibleSection>

      {canEditSurvey(selectSurvey) && (
        <CollapsibleSection title="Survey Content">
          <SurveyContentEditor
            surveyId={selectSurvey?.id || selectSurvey?.name}
            onDirtyChange={setContentDirty}
            onBusyChange={setContentBusy}
          />
        </CollapsibleSection>
      )}

      {canEditSurvey(selectSurvey) && (
        <CollapsibleSection title="Email Notifications">
          <EmailNotificationEditor
            surveyId={selectSurvey?.id || selectSurvey?.name}
            onDirtyChange={setNotificationDirty}
            onBusyChange={setNotificationBusy}
          />
        </CollapsibleSection>
      )}

      {canViewSensitiveSurveyData(selectSurvey) && (
        <CollapsibleSection title="Survey Respondents">
          <RespondentTable
            rows={respondentData}
            surveyName={selectSurvey?.id || selectSurvey?.name}
            onRespondentsUpdate={handleRespondentsUpdate}
            readOnly={!canEditSurvey(selectSurvey)}
            onDirtyChange={setRespondentDirty}
            onBusyChange={setRespondentBusy}
          />
        </CollapsibleSection>
      )}
    </Box>
  );
};

export default Dashboard;