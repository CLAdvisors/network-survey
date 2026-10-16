import React from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import { Alert, Box, Button, CircularProgress, Snackbar, Stack, Typography } from "@mui/material";
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

const WORKSPACE_TABS = ['overview', 'content', 'respondents', 'email'];

// The visible overview campaign: the authoritative launch record once the
// lifecycle fetch has loaded (even when it confirms there is no campaign),
// otherwise the survey-list snapshot while that fetch is pending.
export const selectOverviewCampaign = (launchInfo, survey) => (
  launchInfo?.loaded
    ? launchInfo.latest ?? null
    : (survey?.latestLaunch || survey?.latest_launch || null)
);

// Bounded route parsing: only the survey list "/" and a well-formed
// "/surveys/:id" or "/surveys/:id/:tab" workspace are recognized. Extra
// segments, malformed encoding and unknown paths resolve to a not-found state
// instead of a general URL parser.
export const parseDashboardRoute = (pathname) => {
  try {
    // Reject malformed percent-encoding before interpreting the path.
    decodeURIComponent(pathname);
    const workspaceMatch = matchPath({ path: '/surveys/:surveyId/:tab?', end: true }, pathname);
    if (workspaceMatch) {
      const requestedTab = workspaceMatch.params.tab;
      return {
        kind: 'workspace',
        surveyId: workspaceMatch.params.surveyId,
        tab: WORKSPACE_TABS.includes(requestedTab) ? requestedTab : 'overview',
      };
    }
    if (matchPath({ path: '/', end: true }, pathname)) return { kind: 'list', surveyId: null, tab: null };
  } catch (err) {
    // Malformed percent-encoding: treat as not found.
  }
  return { kind: 'notfound', surveyId: null, tab: null };
};

const NotFoundPanel = ({ onBack }) => (
  <Box data-testid="dashboard-not-found" sx={{ maxWidth: 520, mx: 'auto', mt: 8, textAlign: 'center' }}>
    <Typography component="h1" sx={{ fontSize: 26, fontWeight: 700, color: '#233431' }}>Page not found</Typography>
    <Typography sx={{ fontSize: 13, color: '#647570', mt: 1.5, lineHeight: 1.7 }}>
      We couldn’t find that survey or page. It may have been archived or the link may be incorrect.
    </Typography>
    <Button variant="contained" onClick={onBack} sx={{ mt: 3, bgcolor: '#147d78', '&:hover': { bgcolor: '#105e5b' }, textTransform: 'none' }}>
      Back to surveys
    </Button>
  </Box>
);

const Dashboard = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const route = React.useMemo(() => parseDashboardRoute(location.pathname), [location.pathname]);
  const [surveyData, setSurveyData] = React.useState(null);
  const [surveyList, setSurveyList] = React.useState({ loaded: false, error: '' });
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
  const [launchInfo, setLaunchInfo] = React.useState({ latest: null, error: '', loading: false, loaded: false });
  const surveyRequest = React.useRef(0);
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
      setSurveyList({ loaded: true, error: '' });
      return surveys;
    } catch (err) {
      if (request === surveyRequest.current) {
        setSurveyList((current) => ({ loaded: current.loaded, error: 'Unable to load surveys. Check your connection and retry.' }));
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

  const retrySurveyList = React.useCallback(() => {
    setSurveyList((current) => ({ ...current, error: '' }));
    fetchSurveyData();
  }, [fetchSurveyData]);

  // Selecting a survey resets related questions/respondents (and launch/campaign
  // state) so the previous survey's data is never shown for the new selection.
  // The same path is used for row clicks and URL/history transitions.
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
      setLaunchInfo({ latest: null, error: '', loading: false, loaded: false });
      setLaunchSignal(0);
    }
    selectionRef.current = nextId;
    setSelectSurvey(next);
  }, [canViewSensitiveSurveyData]);

  // Resolve the workspace URL to a survey. The list route intentionally keeps the
  // last selection (and its editor drafts) mounted but hidden.
  React.useEffect(() => {
    if (route.kind !== 'workspace' || !route.surveyId || !surveyData) return;
    const found = surveyData.find((survey) => surveyId(survey) === route.surveyId);
    if (found) applySelection(found);
  }, [route.kind, route.surveyId, surveyData, applySelection]);

  React.useEffect(() => {
    if (!selectSurvey) selectionRef.current = null;
  }, [selectSurvey]);

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

  const handleLaunchSummary = React.useCallback((info) => {
    setLaunchInfo((current) => ({ ...current, ...info }));
  }, []);

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
  const activeTab = route.tab || 'overview';

  const showRespondentsPanel = selectedCanViewRespondents || hasRespondentDrafts || hasRespondentOperations;
  const showEmailPanel = selectedCanEdit || selectedCanViewRespondents || hasInvitationDrafts || hasInvitationOperations;

  const workspaceSubtitle = selectSurvey && lifecycleStatus(selectSurvey) !== 'draft'
    ? `${responseRateSummary(selectSurvey).eligibleCount || selectSurvey.respondents || 0} respondents`
    : null;

  const lifecycleDetails = selectSurvey && lifecycleStatus(selectSurvey) !== 'draft'
    ? <SurveyLifecyclePanel survey={selectSurvey} onSurveyRefresh={handlePanelSurveyRefresh} refreshToken={lifecycleRefreshToken} onLaunchSummary={handleLaunchSummary} />
    : null;

  const workspacePanels = selectSurvey ? [
    {
      key: 'overview',
      node: (
        <SurveyOverviewPanel
          survey={selectSurvey}
          campaign={selectOverviewCampaign(launchInfo, selectSurvey)}
          campaignLoading={launchInfo.loading}
          campaignError={launchInfo.error}
          canOpenRespondents={showRespondentsPanel}
          canOpenEmail={showEmailPanel}
          onGoToTab={handleTabChange}
          onViewResults={() => navigate('/results')}
          onRefresh={() => setLifecycleRefreshToken((value) => value + 1)}
          onReviewLaunch={() => setLaunchSignal((value) => value + 1)}
          canLaunch={selectedCanEdit && lifecycleStatus(selectSurvey) === 'draft'}
          lifecycleDetails={lifecycleDetails}
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
    ...(showRespondentsPanel ? [{
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
    ...(showEmailPanel ? [{
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

  const showWorkspace = route.kind === 'workspace';
  const showList = route.kind === 'list';
  const showNotFound = route.kind === 'notfound';
  const workspaceMissing = showWorkspace && surveyList.loaded && !surveyList.error && Array.isArray(surveyData)
    && !surveyData.some((survey) => surveyId(survey) === route.surveyId);
  const workspaceReady = showWorkspace && Boolean(selectSurvey) && selectedId === route.surveyId && !workspaceMissing;
  const workspaceListError = showWorkspace && Boolean(surveyList.error) && !surveyData;
  const workspaceLoading = showWorkspace && !workspaceReady && !workspaceMissing && !workspaceListError;
  const listLoading = !surveyList.loaded && !surveyList.error;

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

      {showList && (
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
          loading={listLoading}
          error={surveyList.error}
          onRetry={retrySurveyList}
        />
      )}

      {(showNotFound || workspaceMissing) && <NotFoundPanel onBack={handleBack} />}

      {workspaceListError && (
        <Box data-testid="workspace-list-error" sx={{ maxWidth: 520, mx: 'auto', mt: 8, textAlign: 'center' }}>
          <Typography component="h1" sx={{ fontSize: 24, fontWeight: 700, color: '#233431' }}>Survey workspace unavailable</Typography>
          <Typography sx={{ fontSize: 13, color: '#647570', mt: 1.5, lineHeight: 1.7 }}>{surveyList.error}</Typography>
          <Stack direction="row" spacing={1.5} justifyContent="center" sx={{ mt: 3 }}>
            <Button variant="contained" onClick={retrySurveyList} sx={{ bgcolor: '#147d78', '&:hover': { bgcolor: '#105e5b' }, textTransform: 'none' }}>Retry</Button>
            <Button variant="outlined" onClick={handleBack} sx={{ textTransform: 'none' }}>Back to surveys</Button>
          </Stack>
        </Box>
      )}

      {workspaceLoading && (
        <Box sx={{ minHeight: 320, display: 'grid', placeItems: 'center' }}>
          <CircularProgress size={30} aria-label="Loading survey workspace" />
        </Box>
      )}

      {selectSurvey && (
        <Box sx={{ display: workspaceReady ? 'block' : 'none' }} aria-hidden={!workspaceReady}>
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
        </Box>
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
