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
import ReminderTemplateEditor from "./ReminderTemplateEditor";
import CollapsibleSection from "./CollapsibleSection";
import { useAuth } from "../context/AuthContext";
import SurveyLifecyclePanel from "./SurveyLifecyclePanel";
import { lifecycleStatus, surveyId } from "./surveyLifecycle";
import { surveyOperationGeneration } from "./useSurveyOperationState";

const Dashboard = () => {
  const theme = useTheme();
  const [surveyData, setSurveyData] = React.useState(null);
  const [selectSurvey, setSelectSurvey] = React.useState(null);
  const [questionData, setQuestionData] = React.useState(null);
  const [questionLoading, setQuestionLoading] = React.useState(false);
  const [questionError, setQuestionError] = React.useState(null);
  const [relatedRefresh, setRelatedRefresh] = React.useState(0);
  const [respondentData, setRespondentData] = React.useState(null);
  const [respondentLoading, setRespondentLoading] = React.useState(false);
  const [respondentError, setRespondentError] = React.useState(null);
  const [respondentRevision, setRespondentRevision] = React.useState(null);
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const [snackbar, setSnackbar] = React.useState(null);
  const [dirtyBySurvey, setDirtyBySurvey] = React.useState({});
  const [operationsBySurvey, setOperationsBySurvey] = React.useState({});
  const surveyRequest = React.useRef(0);
  const pendingSelectionId = React.useRef(null);
  const relatedRequest = React.useRef(0);
  const { memberships, canViewSensitiveSurveyData, canEditSurvey, hasSurveyRole } = useAuth();

  const fetchSurveyData = React.useCallback(async () => {
    const request = ++surveyRequest.current;
    try {
      const response = await api.get("/surveys");
      if (request !== surveyRequest.current) return response.data.surveys || [];
      const surveys = response.data.surveys || [];
      setSurveyData(surveys);
      setSelectSurvey((current) => {
        const preferredId = pendingSelectionId.current;
        if (preferredId) {
          const preferred = surveys.find((survey) => surveyId(survey) === preferredId);
          if (preferred) {
            pendingSelectionId.current = null;
            return preferred;
          }
        }
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
        setQuestionLoading(false);
        setQuestionError(null);
        setRespondentData(null);
        setRespondentLoading(false);
        setRespondentError(null);
        setRespondentRevision(null);
        return;
      }
      const selectedId = surveyId(selectSurvey);
      const canViewRespondents = canViewSensitiveSurveyData(selectSurvey);
      if (canViewRespondents) {
        setRespondentLoading(true);
        setRespondentError(null);
      } else {
        setRespondentData(null);
        setRespondentLoading(false);
        setRespondentError(null);
        setRespondentRevision(null);
      }
      const questionGeneration = surveyOperationGeneration('questions', selectedId);
      setQuestionLoading(true);
      setQuestionError(null);
      try {
        const questionResponse = await api.get(`/listQuestions?surveyName=${selectedId}`, { signal: controller.signal });
        if (request === relatedRequest.current) {
          if (surveyOperationGeneration('questions', selectedId) !== questionGeneration) {
            setRelatedRefresh((value) => value + 1);
            return;
          }
          setQuestionData(questionResponse.data.questions);
          setQuestionLoading(false);
        }
      } catch (err) {
        if (!controller.signal.aborted && request === relatedRequest.current) {
          if (surveyOperationGeneration('questions', selectedId) !== questionGeneration) {
            setRelatedRefresh((value) => value + 1);
            return;
          }
          setQuestionData(null);
          setQuestionError('Unable to load survey questions. Retry before editing this survey.');
          setQuestionLoading(false);
        }
      }

      if (!canViewRespondents) return;
      const respondentGeneration = surveyOperationGeneration('respondents', selectedId);
      try {
        const respondentResponse = await api.get(`/targets?surveyName=${selectedId}`, { signal: controller.signal });
        if (request === relatedRequest.current) {
          if (surveyOperationGeneration('respondents', selectedId) !== respondentGeneration) {
            setRelatedRefresh((value) => value + 1);
            return;
          }
          const rosterRevision = Number(respondentResponse.headers?.['x-roster-revision']);
          setRespondentData(respondentResponse.data);
          setRespondentRevision(Number.isSafeInteger(rosterRevision) && rosterRevision >= 0 ? rosterRevision : null);
          setRespondentLoading(false);
        }
      } catch (err) {
        if (!controller.signal.aborted && request === relatedRequest.current) {
          if (surveyOperationGeneration('respondents', selectedId) !== respondentGeneration) {
            setRelatedRefresh((value) => value + 1);
            return;
          }
          setRespondentData(null);
          setRespondentRevision(null);
          setRespondentError('Unable to load survey respondents. Retry before editing this survey.');
          setRespondentLoading(false);
        }
      }
    };
    fetchRelatedData();
    return () => controller.abort();
  }, [selectSurvey, canViewSensitiveSurveyData, relatedRefresh]);

  const handleSelectRow = (childData) => {
    pendingSelectionId.current = null;
    if (surveyId(childData) !== surveyId(selectSurvey)) {
      relatedRequest.current += 1;
      setQuestionData(null);
      setQuestionLoading(true);
      setQuestionError(null);
      setRespondentData(null);
      setRespondentRevision(null);
      setRespondentLoading(canViewSensitiveSurveyData(childData));
      setRespondentError(null);
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

  const handleSurveyCopied = async (copiedSurvey) => {
    const copiedId = copiedSurvey?.id || copiedSurvey?.survey_id || null;
    if (!copiedId) {
      setSnackbar({ severity: 'error', message: 'The copied survey was created, but its stable ID was not returned.' });
      return;
    }
    pendingSelectionId.current = copiedId;
    relatedRequest.current += 1;
    setQuestionData(null);
    setQuestionLoading(true);
    setQuestionError(null);
    setRespondentData(null);
    setRespondentLoading(true);
    setRespondentError(null);
    const surveys = await fetchSurveyData();
    if (!surveys.some((survey) => surveyId(survey) === copiedId)) {
      setSnackbar({ severity: 'info', message: 'The copied survey was created and will be selected when refresh completes.' });
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

  const handlePanelSurveyRefresh = React.useCallback(async (selectedId) => {
    const surveys = await fetchSurveyData();
    return surveys.find((survey) => surveyId(survey) === selectedId);
  }, [fetchSurveyData]);

  const handleDirtyChange = React.useCallback((owningSurveyId, section, dirty) => {
    if (!owningSurveyId || !section) return;
    setDirtyBySurvey((current) => {
      const surveyDirty = { ...(current[owningSurveyId] || {}) };
      if (dirty) surveyDirty[section] = true;
      else delete surveyDirty[section];
      if (Object.keys(surveyDirty).length === 0) {
        if (!current[owningSurveyId]) return current;
        const next = { ...current };
        delete next[owningSurveyId];
        return next;
      }
      return { ...current, [owningSurveyId]: surveyDirty };
    });
  }, []);

  const handleOperationChange = React.useCallback((owningSurveyId, section, pending) => {
    if (!owningSurveyId || !section) return;
    setOperationsBySurvey((current) => {
      const surveyOperations = { ...(current[owningSurveyId] || {}) };
      if (pending) surveyOperations[section] = true;
      else delete surveyOperations[section];
      if (Object.keys(surveyOperations).length === 0) {
        if (!current[owningSurveyId]) return current;
        const next = { ...current };
        delete next[owningSurveyId];
        return next;
      }
      return { ...current, [owningSurveyId]: surveyOperations };
    });
  }, []);

  const selectedIsLifecycleLocked = Boolean(selectSurvey) && lifecycleStatus(selectSurvey) !== 'draft';
  const selectedCanEdit = canEditSurvey(selectSurvey);
  const selectedCanViewRespondents = canViewSensitiveSurveyData(selectSurvey);
  const selectedCanAdminister = typeof hasSurveyRole === 'function'
    ? hasSurveyRole(selectSurvey, 'admin')
    : selectedCanEdit;
  const selectedReadOnly = !selectedCanEdit || selectedIsLifecycleLocked;
  const hasReminderDrafts = Object.values(dirtyBySurvey).some((dirty) => dirty.reminderTemplate);
  const hasInvitationDrafts = Object.values(dirtyBySurvey).some((dirty) => dirty.invitationSubject || dirty.invitationBody || dirty.reminderTemplate);
  const hasRespondentDrafts = Object.values(dirtyBySurvey).some((dirty) => dirty.respondents);
  const hasReminderOperations = Object.values(operationsBySurvey).some((pending) => pending.reminderTemplate);
  const hasInvitationOperations = Object.values(operationsBySurvey).some((pending) => pending.invitationSubject || pending.invitationBody || pending.reminderTemplate);
  const hasRespondentOperations = Object.values(operationsBySurvey).some((pending) => pending.respondents);

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
          dirtyBySurvey={dirtyBySurvey}
          operationsBySurvey={operationsBySurvey}
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
          rows={questionData}
          loading={questionLoading}
          loadError={questionError}
          onRetry={() => setRelatedRefresh((value) => value + 1)}
          surveyName={surveyId(selectSurvey)}
          onSurveyDataChanged={fetchSurveyData}
          readOnly={selectedReadOnly}
          onDirtyChange={handleDirtyChange}
          onOperationChange={handleOperationChange}
        />
      </CollapsibleSection>

      {(selectedCanEdit || hasInvitationDrafts || hasInvitationOperations) && (
        <Box sx={{ display: selectedCanEdit ? 'block' : 'none' }} aria-hidden={!selectedCanEdit}>
          <CollapsibleSection title="Email Notifications">
            <InvitationSubjectEditor
              key="invitation-subject-editor"
              surveyId={selectedCanEdit ? surveyId(selectSurvey) : null}
              readOnly={selectedIsLifecycleLocked}
              onDirtyChange={handleDirtyChange}
              onOperationChange={handleOperationChange}
            />
            <EmailNotificationEditor
              key="invitation-body-editor"
              surveyId={selectedCanEdit ? surveyId(selectSurvey) : null}
              readOnly={selectedIsLifecycleLocked}
              onDirtyChange={handleDirtyChange}
              onOperationChange={handleOperationChange}
            />
            {(selectedCanAdminister || hasReminderDrafts || hasReminderOperations) && (
              <Box sx={{display:selectedCanAdminister && lifecycleStatus(selectSurvey) !== 'draft' ? 'block' : 'none'}} aria-hidden={!(selectedCanAdminister && lifecycleStatus(selectSurvey) !== 'draft')}>
                <ReminderTemplateEditor
                  surveyId={selectedCanAdminister ? surveyId(selectSurvey) : null}
                  editable={selectedCanAdminister && lifecycleStatus(selectSurvey) === 'active'}
                  onDirtyChange={handleDirtyChange}
                  onOperationChange={handleOperationChange}
                />
              </Box>
            )}
          </CollapsibleSection>
        </Box>
      )}

      {(selectedCanViewRespondents || hasRespondentDrafts || hasRespondentOperations) && (
        <Box sx={{ display: selectedCanViewRespondents ? 'block' : 'none' }} aria-hidden={!selectedCanViewRespondents}>
          <CollapsibleSection title="Survey Respondents">
            {selectedIsLifecycleLocked && <Alert severity="info" sx={{ mb: 2 }}>Respondent identities are read-only while this survey is {lifecycleStatus(selectSurvey)}.</Alert>}
            <RespondentTable
              rows={selectedCanViewRespondents ? respondentData : null}
              revision={selectedCanViewRespondents ? respondentRevision : null}
              loading={selectedCanViewRespondents && respondentLoading}
              loadError={selectedCanViewRespondents ? respondentError : null}
              onRetry={() => setRelatedRefresh((value) => value + 1)}
              surveyName={selectedCanViewRespondents ? surveyId(selectSurvey) : null}
              onSurveyDataChanged={fetchSurveyData}
              readOnly={selectedReadOnly}
              onDirtyChange={handleDirtyChange}
              onOperationChange={handleOperationChange}
            />
          </CollapsibleSection>
        </Box>
      )}
    </Box>
  );
};

export default Dashboard;