import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Alert, Box, Snackbar } from "@mui/material";
import RespondentTable from "./RespondentTable";
import api from "../api/axios";
import QuestionTable from "./QuestionTable";
import CreateSurveyDialog from "./CreateSurveyDialog";
import EmailNotificationEditor from "./EmailNotificationEditor";
import InvitationSubjectEditor from "./InvitationSubjectEditor";
import SurveyInstructionsEditor from "./SurveyInstructionsEditor";
import ReminderTemplateEditor from "./ReminderTemplateEditor";
import { useAuth } from "../context/AuthContext";
import SurveyLifecyclePanel from "./SurveyLifecyclePanel";
import EmailHistory from "./EmailHistory";
import SurveysList from "./SurveysList";
import SurveyWorkspace from "./SurveyWorkspace";
import SurveyOverviewPanel from "./SurveyOverviewPanel";
import SurveyPrimaryAction from "./SurveyPrimaryAction";
import SurveyTableMenuCell from "./SurveyTableMenuCell";
import { lifecycleLabel, lifecycleStatus, surveyId } from "./surveyLifecycle";
import { responseRateSummary } from "./surveyResponseRate";
import { surveyOperationGeneration } from "./useSurveyOperationState";

const Dashboard = () => {
  const navigate = useNavigate();
  const location = useLocation();
  // The dashboard area is served by a single route; the workspace URL is parsed
  // here so navigating between the list and a survey never remounts this page
  // (drafts and pending operations survive list/tab/back navigation).
  const pathSegments = location.pathname.split('/').filter(Boolean);
  const isWorkspaceRoute = pathSegments[0] === 'surveys' && Boolean(pathSegments[1]);
  const routeSurveyId = isWorkspaceRoute ? decodeURIComponent(pathSegments[1]) : null;
  const routeTab = isWorkspaceRoute ? (pathSegments[2] || 'overview') : null;
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
  const [launchSignal, setLaunchSignal] = React.useState(0);
  const [lifecycleRefreshToken, setLifecycleRefreshToken] = React.useState(0);
  const surveyRequest = React.useRef(0);
  const pendingSelectionId = React.useRef(null);
  const relatedRequest = React.useRef(0);
  const selectionRef = React.useRef(null);
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
            selectionRef.current = preferredId;
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

  // Selecting a survey resets the related questions/respondents so stale data
  // from a previous survey is never shown while the next one loads.
  const applySelection = React.useCallback((next) => {
    const nextId = next ? surveyId(next) : null;
    if (nextId !== selectionRef.current) {
      relatedRequest.current += 1;
      setQuestionData(null);
      setQuestionLoading(Boolean(next));
      setQuestionError(null);
      setRespondentData(null);
      setRespondentRevision(null);
      setRespondentLoading(Boolean(next) && canViewSensitiveSurveyData(next));
      setRespondentError(null);
    }
    selectionRef.current = nextId;
    setSelectSurvey(next);
  }, [canViewSensitiveSurveyData]);

  // Keep the selected survey in sync with the workspace URL (direct links,
  // browser back/forward, and the plain survey list route).
  React.useEffect(() => {
    const urlId = routeSurveyId || null;
    if (urlId) {
      if (!surveyData) return;
      const found = surveyData.find((survey) => surveyId(survey) === urlId);
      if (!found) return;
      setSelectSurvey((current) => {
        if (current && surveyId(current) === urlId) return current;
        selectionRef.current = urlId;
        return found;
      });
      return;
    }
    if (!isWorkspaceRoute) {
      setSelectSurvey((current) => {
        if (!current) return current;
        selectionRef.current = null;
        return null;
      });
    }
  }, [routeSurveyId, surveyData, isWorkspaceRoute]);

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
    applySelection(childData);
    navigate(`/surveys/${surveyId(childData)}/overview`);
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
    navigate(`/surveys/${copiedId}/overview`);
    const surveys = await fetchSurveyData();
    if (!surveys.some((survey) => surveyId(survey) === copiedId)) {
      setSnackbar({ severity: 'info', message: 'The copied survey was created and will be selected when refresh completes.' });
    }
  };

  const handleSurveyDeleted = async (deletedSurveyName) => {
    await fetchSurveyData();
    if (selectSurvey && selectSurvey.name === deletedSurveyName) {
      applySelection(null);
      navigate('/');
    }
  };

  const handleSurveyUpdated = React.useCallback((updated) => {
    if (!updated) return;
    setSelectSurvey((current) => (
      current && surveyId(current) === surveyId(updated) ? { ...current, ...updated } : current
    ));
  }, []);

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

  const handleTabChange = React.useCallback((nextTab) => {
    if (!selectSurvey) return;
    navigate(`/surveys/${surveyId(selectSurvey)}/${nextTab}`);
  }, [navigate, selectSurvey]);

  const handleBack = React.useCallback(() => navigate('/'), [navigate]);

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
  const canCreateSurvey = Boolean(memberships?.some((membership) => ['owner', 'admin', 'editor'].includes(membership.role)));
  const selectedId = selectSurvey ? surveyId(selectSurvey) : null;
  const selectedDirty = selectedId ? dirtyBySurvey[selectedId] || {} : {};
  const selectedOperations = selectedId ? operationsBySurvey[selectedId] || {} : {};
  const activeTab = routeTab || 'overview';

  const workspaceSubtitle = selectSurvey && lifecycleStatus(selectSurvey) !== 'draft'
    ? `${responseRateSummary(selectSurvey).eligibleCount || selectSurvey.respondents || 0} respondents`
    : null;

  const lifecycleDetails = selectSurvey && lifecycleStatus(selectSurvey) !== 'draft'
    ? <SurveyLifecyclePanel survey={selectSurvey} onSurveyRefresh={handlePanelSurveyRefresh} refreshToken={lifecycleRefreshToken} />
    : null;

  const workspacePanels = selectSurvey ? [
    {
      key: 'overview',
      node: (
        <SurveyOverviewPanel
          survey={selectSurvey}
          onGoToTab={handleTabChange}
          onViewResults={() => navigate('/results')}
          onRefresh={() => setLifecycleRefreshToken((value) => value + 1)}
          onReviewLaunch={() => setLaunchSignal((value) => value + 1)}
          canLaunch={selectedCanEdit && lifecycleStatus(selectSurvey) === 'draft'}
          lifecycleDetails={lifecycleDetails}
          refreshToken={lifecycleRefreshToken}
        />
      ),
    },
    {
      key: 'content',
      node: (
        <Box>
          <SurveyInstructionsEditor
            surveyId={surveyId(selectSurvey)}
            readOnly={selectedReadOnly}
            readOnlyMessage={selectedIsLifecycleLocked
              ? `Instructions are read-only while this survey is ${lifecycleLabel(lifecycleStatus(selectSurvey)).toLowerCase()}.`
              : 'You do not have permission to update these instructions.'}
            onDirtyChange={handleDirtyChange}
            onOperationChange={handleOperationChange}
          />
          <Box sx={{ mt: 3 }}>
            {selectedIsLifecycleLocked && <Alert severity="info" sx={{ mb: 2 }}>Questions are read-only while this survey is {lifecycleLabel(lifecycleStatus(selectSurvey)).toLowerCase()}.</Alert>}
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
          </Box>
        </Box>
      ),
    },
    ...(selectedCanViewRespondents || hasRespondentDrafts || hasRespondentOperations ? [{
      key: 'respondents',
      node: (
        <Box sx={{ display: selectedCanViewRespondents ? 'block' : 'none' }} aria-hidden={!selectedCanViewRespondents}>
          {selectedIsLifecycleLocked && <Alert severity="info" sx={{ mb: 2 }}>Respondent identities are read-only while this survey is {lifecycleLabel(lifecycleStatus(selectSurvey)).toLowerCase()}.</Alert>}
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
        </Box>
      ),
    }] : []),
    ...(selectedCanEdit || selectedCanViewRespondents || hasInvitationDrafts || hasInvitationOperations ? [{
      key: 'email',
      node: (
        <Box>
          <Box sx={{ display: selectedCanEdit ? 'block' : 'none' }} aria-hidden={!selectedCanEdit}>
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
              <Box sx={{ display: selectedCanAdminister && lifecycleStatus(selectSurvey) !== 'draft' ? 'block' : 'none' }} aria-hidden={!(selectedCanAdminister && lifecycleStatus(selectSurvey) !== 'draft')}>
                <ReminderTemplateEditor
                  surveyId={selectedCanAdminister ? surveyId(selectSurvey) : null}
                  editable={selectedCanAdminister && lifecycleStatus(selectSurvey) === 'active'}
                  onDirtyChange={handleDirtyChange}
                  onOperationChange={handleOperationChange}
                />
              </Box>
            )}
          </Box>
          {selectedCanViewRespondents && <Box sx={{ mt: 3 }}><EmailHistory survey={selectSurvey} /></Box>}
        </Box>
      ),
    }] : []),
  ] : [];

  return (
    <Box
      data-testid="dashboard-shell"
      sx={{
        mt: '8px',
        px: { xs: 1.5, sm: 3, md: 4 },
        py: { xs: 2, sm: 3, md: 4 },
        width: '100%',
        maxWidth: 1470,
        mx: 'auto',
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

      {!selectSurvey ? (
        <SurveysList
          rows={surveyData}
          selectRow={handleSelectRow}
          onSurveyDeleted={handleSurveyDeleted}
          onSurveyCopied={handleSurveyCopied}
          onLifecycleChange={fetchSurveyData}
          dirtyBySurvey={dirtyBySurvey}
          operationsBySurvey={operationsBySurvey}
          canCreate={canCreateSurvey}
          onCreate={() => setCreateDialogOpen(true)}
        />
      ) : (
        <SurveyWorkspace
          survey={selectSurvey}
          tab={activeTab}
          onTabChange={handleTabChange}
          onBack={handleBack}
          subtitle={workspaceSubtitle}
          primaryAction={(
            <SurveyPrimaryAction
              survey={selectSurvey}
              unsavedChanges={selectedDirty}
              pendingOperations={selectedOperations}
              onLifecycleChange={fetchSurveyData}
              onSurveyUpdated={handleSurveyUpdated}
              onNotify={setSnackbar}
              onViewResults={() => navigate('/results')}
              launchSignal={launchSignal}
            />
          )}
          menu={(
            <SurveyTableMenuCell
              row={selectSurvey}
              onSurveyDeleted={handleSurveyDeleted}
              onSurveyCopied={handleSurveyCopied}
              onLifecycleChange={fetchSurveyData}
              onViewLifecycle={handleSurveyUpdated}
              unsavedChanges={selectedDirty}
              pendingOperations={selectedOperations}
            />
          )}
          panels={workspacePanels}
        />
      )}

      <CreateSurveyDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onSubmit={handleCreateSurvey}
        memberships={memberships}
      />
    </Box>
  );
};

export default Dashboard;
