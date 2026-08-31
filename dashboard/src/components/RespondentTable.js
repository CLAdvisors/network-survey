import React, { useState, useEffect, useRef } from 'react';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';
import TableUploadButton from './TableUploadButton';
import AddRowButton from './AddRowButton';
import api from '../api/axios';
import { Alert, Box, CircularProgress, Paper, Typography, Button, Switch } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import SaveIcon from '@mui/icons-material/Save';
import DeleteIcon from '@mui/icons-material/Delete';
import TableMenuCell from './TableMenuCell';
import { LANGUAGES } from '@network-survey/frontend-shared';
import { formatDateTime, providerOutcome, providerOutcomeLabel, providerOutcomeTimestamp } from './surveyLifecycle';
import useSurveyOperationState from './useSurveyOperationState';

const TEMPLATE_DATA = [
  'First,Last,Email,Respondent,Location,Level,Gender,Race,Manager,VP,Business Group,Business Group - 1,Business Group - 2,Language',
  'Alicia,Smith,AliciaSmith@test.com,FALSE,Medical Towers,5,Female,Black,Sarah Currier,Sarah Currier,HR,System,Talent Management,English',
  'Andrea,Terrell,AndreaTerrell@test.com,TRUE,Medical Towers,6,Female,White,Alicia Smith,Brian Reed,HR,System,Talent Acquisition,English',
];

const apiErrorMessage = (error, fallback) => error?.response?.data?.message || error?.response?.data?.error || fallback;

const responseRevision = (response) => {
  const value = Number(response?.headers?.['x-roster-revision'] ?? response?.data?.revision);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
};

const editableRespondentValue = (row) => [
  row.name || '',
  row.email || row.contact_info || '',
  row.language || row.lang || 'English',
  row.canRespond ?? row.can_respond ?? true,
];

const editableRespondentDraftMatches = (draft, authoritativeRows = []) => {
  if (!draft || !Array.isArray(draft.rows) || !Array.isArray(draft.baseRows)) return false;
  const baseIds = new Set(draft.baseRows.map((row) => row.id));
  const authoritativeById = new Map(authoritativeRows.map((row) => [row.id, row]));
  const existingDraftRows = draft.rows.filter((row) => baseIds.has(row.id));
  if (existingDraftRows.length !== draft.baseRows.length) return false;
  for (const row of existingDraftRows) {
    const authoritative = authoritativeById.get(row.id);
    if (!authoritative || JSON.stringify(editableRespondentValue(row)) !== JSON.stringify(editableRespondentValue(authoritative))) return false;
  }
  const additions = draft.rows.filter((row) => !baseIds.has(row.id)).map(editableRespondentValue);
  const authoritativeAdditions = authoritativeRows.filter((row) => !baseIds.has(row.id)).map(editableRespondentValue);
  const sorted = (items) => items.map(JSON.stringify).sort();
  return JSON.stringify(sorted(additions)) === JSON.stringify(sorted(authoritativeAdditions));
};

const RespondentTable = ({ rows, revision, surveyName, loading = false, loadError = null, onRetry, onSurveyDataChanged, readOnly = false, onDirtyChange, onOperationChange }) => {
  const theme = useTheme();
  const [tableRows, setTableRows] = useState([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [originalRows, setOriginalRows] = useState([]);
  const [authoritativeRevision, setAuthoritativeRevision] = useState(null);
  const [mutationErrors, setMutationErrors] = useState({});
  const draftsRef = useRef(new Map());
  const acceptedRevisionRef = useRef(new Map());
  const propRevision = Number(revision);
  if (surveyName && Number.isSafeInteger(propRevision) && propRevision >= 0) {
    acceptedRevisionRef.current.set(surveyName, Math.max(acceptedRevisionRef.current.get(surveyName) ?? -1, propRevision));
  }
  const mutationError = mutationErrors[surveyName] || null;
  const setSurveyMutationError = (targetSurveyId, message) => setMutationErrors((current) => {
    if (!message) {
      if (!current[targetSurveyId]) return current;
      const next = { ...current };
      delete next[targetSurveyId];
      return next;
    }
    return { ...current, [targetSurveyId]: message };
  });
  const { begin, end, isPending, advanceGeneration } = useSurveyOperationState('respondents', onOperationChange);
  const operationPending = isPending(surveyName);
  const respondentsReady = Array.isArray(rows) && Number.isSafeInteger(authoritativeRevision) && !loading && !loadError;
  const hasIncompleteRows = tableRows.some((row) => !String(row.name || '').trim() || !String(row.email || '').trim());
  const surveyIdentity = useRef(surveyName);
  surveyIdentity.current = surveyName;
  const [sortModel, setSortModel] = useState([
    {
      field: 'id',
      sort: 'asc',
    },
  ]);

  const columns = [
    { field: 'name', headerName: 'User Name', width: 150, editable: !readOnly && !operationPending && respondentsReady },
    { field: 'email', headerName: 'Email', width: 200, editable: !readOnly && !operationPending && respondentsReady },
    { 
      field: 'language', 
      headerName: 'Language', 
      width: 130,
      editable: !readOnly && !operationPending && respondentsReady,
      type: 'singleSelect',
      valueOptions: LANGUAGES.map(lang => lang.label),
      renderCell: (params) => {
        const language = LANGUAGES.find(lang => lang.label === params.value);
        return language ? language.label : 'English';
      }
    },
    {
      field: 'canRespond',
      headerName: 'Can Respond',
      width: 120,
      editable: false, // Changed from true to false
      type: 'boolean',
      renderCell: (params) => (
        <Switch
          checked={params.value}
          disabled={readOnly || operationPending || !respondentsReady}
          onChange={(e) => {
            e.stopPropagation();
            const newValue = e.target.checked;
            // Update the row directly
            const updatedRow = { ...params.row, canRespond: newValue };
            params.api.updateRows([{ id: params.id, canRespond: newValue }]);
            handleProcessRowUpdate(updatedRow);
          }}
        />
      )
    },
    {
      field: 'responseStatus',
      headerName: 'Response status',
      width: 145,
      valueGetter: (_, row) => row.responseStatus || row.response_status || row.status || 'Not started'
    },
    {
      field: 'dispatchStatus',
      headerName: 'Dispatch status',
      width: 150,
      valueGetter: (_, row) => row.dispatchStatus || row.dispatch_status || row.emailStatus || row.email_status || 'Not queued'
    },
    {
      field: 'providerOutcome',
      headerName: 'Provider outcome',
      width: 175,
      valueGetter: (_, row) => providerOutcomeLabel(providerOutcome(row))
    },
    {
      field: 'providerOutcomeAt',
      headerName: 'Provider outcome time',
      width: 190,
      valueGetter: (_, row) => providerOutcomeTimestamp(row),
      valueFormatter: (value) => formatDateTime(value)
    },
    {
      field: 'lastEmailAttempt',
      headerName: 'Last email attempt',
      width: 190,
      valueGetter: (_, row) => row.lastEmailAttempt || row.last_email_attempt || null,
      valueFormatter: (value) => {
        if (!value) return '—';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
      }
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 100,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <TableMenuCell
          row={params.row}
          actions={[
            {
              label: 'Delete Respondent',
              icon: <DeleteIcon fontSize="small" />,
              color: 'error.main',
              handler: async (row) => {
                if (!respondentsReady) return;
                const targetSurveyId = surveyName;
                if (!begin(targetSurveyId)) return;
                try {
                  setSurveyMutationError(targetSurveyId, null);
                  const response = await api.delete('/user', {
                    data: {
                      respondentId: row.id,
                      surveyName: targetSurveyId,
                      expectedRevision: authoritativeRevision,
                    }
                  });
                  const nextRevision = responseRevision(response);
                  if (nextRevision !== null) {
                    acceptedRevisionRef.current.set(targetSurveyId, Math.max(acceptedRevisionRef.current.get(targetSurveyId) ?? -1, nextRevision));
                    if (targetSurveyId === surveyIdentity.current) setAuthoritativeRevision(nextRevision);
                  }
                  advanceGeneration(targetSurveyId);
                  await params.row.onRespondentDeleted(targetSurveyId, { replaceDraft: true });
                } catch (error) {
                  setSurveyMutationError(targetSurveyId, apiErrorMessage(error, 'Failed to delete the respondent. Refresh the roster and try again.'));
                } finally {
                  end(targetSurveyId);
                }
              }
            }
          ]}
        />
      ),
    }
  ].filter(column => (!readOnly && !hasChanges && !operationPending && respondentsReady) || column.field !== 'actions');



  useEffect(() => {
    const parsedRevision = Number(revision);
    const nextRevision = Number.isSafeInteger(parsedRevision) && parsedRevision >= 0 ? parsedRevision : null;
    if (nextRevision !== null && nextRevision < (acceptedRevisionRef.current.get(surveyName) ?? -1)) return;
    if (Array.isArray(rows)) {
      const updatedRows = rows.map(row => ({
        ...row,
        language: row.language || 'English',
        canRespond: row.canRespond === undefined ? true : row.canRespond,
        onRespondentDeleted: fetchRespondentData
      }));
      const original = JSON.parse(JSON.stringify(updatedRows));
      const draft = draftsRef.current.get(surveyName);
      const draftPersisted = editableRespondentDraftMatches(draft, updatedRows);
      if (draftPersisted) {
        draftsRef.current.delete(surveyName);
        setSurveyMutationError(surveyName, null);
        onDirtyChange?.(surveyName, 'respondents', false);
      } else if (!draft) {
        setSurveyMutationError(surveyName, null);
      }
      if (draft && !draftPersisted) draftsRef.current.set(surveyName, { ...draft, latestRows: original, latestRevision: nextRevision });
      setTableRows(draft && !draftPersisted ? draft.rows : updatedRows);
      setOriginalRows(draft && !draftPersisted ? draft.baseRows : original);
      setAuthoritativeRevision(draft && !draftPersisted ? draft.revision : nextRevision);
      setHasChanges(Boolean(draft) && !draftPersisted);
    } else {
      setTableRows([]);
      setOriginalRows([]);
      setHasChanges(false);
    }
  }, [rows, surveyName, revision]);

  const fetchRespondentData = async (targetSurveyId = surveyName, { replaceDraft = false } = {}) => {
    let applied = false;
    let confirmed = false;
    try {
      const response = await api.get(`/targets?surveyName=${targetSurveyId}`);
      const refreshedRevision = responseRevision(response);
      if (refreshedRevision === null) throw new Error('Roster revision missing from response');
      const latestAcceptedRevision = acceptedRevisionRef.current.get(targetSurveyId) ?? -1;
      if (refreshedRevision < latestAcceptedRevision) return { applied: false, confirmed: false, stale: true };
      acceptedRevisionRef.current.set(targetSurveyId, refreshedRevision);
      const refreshedRows = response.data.map(row => ({
        ...row,
        language: row.language || 'English',
        canRespond: row.canRespond === undefined ? true : row.canRespond,
        onRespondentDeleted: fetchRespondentData
      }));
      const draft = draftsRef.current.get(targetSurveyId);
      confirmed = editableRespondentDraftMatches(draft, refreshedRows);
      if (confirmed || !draft) setSurveyMutationError(targetSurveyId, null);
      if (confirmed && draftsRef.current.get(targetSurveyId) === draft) {
        draftsRef.current.delete(targetSurveyId);
        onDirtyChange?.(targetSurveyId, 'respondents', false);
      } else if (draft && draftsRef.current.get(targetSurveyId) === draft) {
        draftsRef.current.set(targetSurveyId, { ...draft, latestRows: JSON.parse(JSON.stringify(refreshedRows)), latestRevision: refreshedRevision });
      }
      if (
        targetSurveyId === surveyIdentity.current &&
        (replaceDraft || confirmed || !draftsRef.current.has(targetSurveyId))
      ) {
        setTableRows(confirmed || replaceDraft || !draft ? refreshedRows : draft.rows);
        setOriginalRows(JSON.parse(JSON.stringify(refreshedRows)));
        setHasChanges(Boolean(draft) && !confirmed && !replaceDraft);
        setAuthoritativeRevision(refreshedRevision);
        applied = true;
      }
    } catch (error) {
      setSurveyMutationError(targetSurveyId, mutationErrors[targetSurveyId] || 'The change may have saved, but the authoritative roster could not be refreshed. Your draft was retained; retry after refreshing.');
    }
    await onSurveyDataChanged?.();
    return { applied, confirmed };
  };

  const handleProcessRowUpdate = (newRow) => {
    if (readOnly || operationPending || !respondentsReady) return originalRows.find(row => row.id === newRow.id) || newRow;
    const updatedRows = tableRows.map((row) => (row.id === newRow.id ? newRow : row));
    const hasUnsavedChanges = updatedRows.some((row) => {
      const original = originalRows.find(origRow => origRow.id === row.id);
      return !original || 
             original.name !== row.name || 
             original.email !== row.email ||
             original.language !== row.language ||
             original.canRespond !== row.canRespond;
    });
    
    const existingDraft = draftsRef.current.get(surveyName);
    setHasChanges(hasUnsavedChanges);
    if (hasUnsavedChanges) {
      setTableRows(updatedRows);
      draftsRef.current.set(surveyName, {
        rows: updatedRows,
        baseRows: existingDraft?.baseRows || JSON.parse(JSON.stringify(originalRows)),
        revision: existingDraft?.revision ?? authoritativeRevision,
        latestRows: existingDraft?.latestRows || JSON.parse(JSON.stringify(originalRows)),
        latestRevision: existingDraft?.latestRevision ?? authoritativeRevision,
      });
    } else {
      draftsRef.current.delete(surveyName);
      const restoredRows = existingDraft?.latestRows || updatedRows;
      setTableRows(JSON.parse(JSON.stringify(restoredRows)));
      setOriginalRows(JSON.parse(JSON.stringify(restoredRows)));
      setAuthoritativeRevision(existingDraft?.latestRevision ?? authoritativeRevision);
    }
    advanceGeneration(surveyName);
    onDirtyChange?.(surveyName, 'respondents', hasUnsavedChanges);
    return newRow;
  };

  const handleSave = async () => {
    if (!respondentsReady || hasIncompleteRows) return;
    const targetSurveyId = surveyName;
    if (!begin(targetSurveyId)) return;
    const savedDraft = draftsRef.current.get(targetSurveyId);
    try {
      setSurveyMutationError(targetSurveyId, null);
      const updates = [];
      const additions = [];
      for (const row of tableRows) {
        const original = originalRows.find((candidate) => candidate.id === row.id);
        const fields = { name: row.name, email: row.email, language: row.language, canRespond: row.canRespond };
        if (!original) additions.push(fields);
        else if (
          original.name !== row.name || original.email !== row.email ||
          original.language !== row.language || original.canRespond !== row.canRespond
        ) updates.push({ respondentId: row.id, ...fields });
      }
      if (updates.length || additions.length) {
        const response = await api.patch(`/surveys/${targetSurveyId}/respondents`, {
          expectedRevision: savedDraft?.revision ?? authoritativeRevision,
          updates,
          additions,
        });
        const nextRevision = responseRevision(response);
        if (nextRevision !== null) {
          acceptedRevisionRef.current.set(targetSurveyId, Math.max(acceptedRevisionRef.current.get(targetSurveyId) ?? -1, nextRevision));
          if (targetSurveyId === surveyIdentity.current) setAuthoritativeRevision(nextRevision);
        }
        advanceGeneration(targetSurveyId);
        if (draftsRef.current.get(targetSurveyId) === savedDraft) {
          await fetchRespondentData(targetSurveyId, { replaceDraft: false });
        }
      }
    } catch (error) {
      setSurveyMutationError(targetSurveyId, apiErrorMessage(error, 'Failed to save the respondent roster. Your draft was retained.'));
    } finally {
      end(targetSurveyId);
    }
  };

  const handleUpload = async (csvContent) => {
    if (!respondentsReady) return;
    const targetSurveyId = surveyName;
    if (draftsRef.current.has(targetSurveyId)) {
      setSurveyMutationError(targetSurveyId, 'Finish or discard the current respondent draft before importing a CSV file.');
      return;
    }
    if (!begin(targetSurveyId)) return;
    try {
      setSurveyMutationError(targetSurveyId, null);
      const response = await api.post('/updateTargets', {
        csvData: csvContent,
        surveyName: targetSurveyId,
        expectedRevision: authoritativeRevision,
      });

      if (response.status === 200) {
        const nextRevision = responseRevision(response);
        if (nextRevision !== null) {
          acceptedRevisionRef.current.set(targetSurveyId, Math.max(acceptedRevisionRef.current.get(targetSurveyId) ?? -1, nextRevision));
          if (targetSurveyId === surveyIdentity.current) setAuthoritativeRevision(nextRevision);
        }
        advanceGeneration(targetSurveyId);
        await fetchRespondentData(targetSurveyId, { replaceDraft: true });
      }
    } catch (err) {
      setSurveyMutationError(targetSurveyId, apiErrorMessage(err, 'Failed to import respondents. No rows were added.'));
      throw err;
    } finally {
      end(targetSurveyId);
    }
  };

  const handleDiscard = () => {
    if (operationPending || !respondentsReady) return;
    const draft = draftsRef.current.get(surveyName);
    draftsRef.current.delete(surveyName);
    const restoredRows = draft?.latestRows || originalRows;
    setTableRows(JSON.parse(JSON.stringify(restoredRows)));
    setOriginalRows(JSON.parse(JSON.stringify(restoredRows)));
    setAuthoritativeRevision(draft?.latestRevision ?? authoritativeRevision);
    setHasChanges(false);
    advanceGeneration(surveyName);
    onDirtyChange?.(surveyName, 'respondents', false);
  };

  const handleAddRow = () => {
    if (operationPending || !respondentsReady) return;
    const newId = Math.max(0, ...tableRows.map(row => row.id)) + 1;
    const newRow = {
      id: newId,
      name: '',
      email: '',
      language: 'English',
      canRespond: true,
      status: 'pending',
      onRespondentDeleted: fetchRespondentData
    };
    
    const updatedRows = [newRow, ...tableRows];
    setTableRows(updatedRows);
    setHasChanges(true);
    draftsRef.current.set(surveyName, {
      rows: updatedRows,
      baseRows: JSON.parse(JSON.stringify(originalRows)),
      revision: authoritativeRevision,
      latestRows: JSON.parse(JSON.stringify(originalRows)),
      latestRevision: authoritativeRevision,
    });
    advanceGeneration(surveyName);
    onDirtyChange?.(surveyName, 'respondents', true);
  };

  return (
    <Paper elevation={2} sx={{ p: 3, bgcolor: theme.palette.background.paper, borderRadius: 2 }}>
      <Box sx={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        mb: 3,
        borderBottom: `2px solid ${theme.palette.primary.main}`,
        pb: 1
      }}>
        <Typography variant="h6" color="primary" sx={{ fontWeight: 'bold' }}>
          Respondent Table
        </Typography>
        {!readOnly && respondentsReady && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AddRowButton onClick={handleAddRow} disabled={operationPending} />
            <TableUploadButton
              onUpload={handleUpload}
              templateData={TEMPLATE_DATA}
              tableName="Respondents"
              disabled={hasChanges || operationPending}
            />
            {hasChanges && (
              <>
                <Button onClick={handleDiscard} disabled={operationPending} size="small">
                  Discard changes
                </Button>
                <Button
                  variant="contained"
                  startIcon={<SaveIcon />}
                  onClick={handleSave}
                  disabled={operationPending || hasIncompleteRows}
                  size="small"
                >
                  Save
                </Button>
              </>
            )}
          </Box>
        )}
      </Box>

      {mutationError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {mutationError}
        </Alert>
      )}
      {Array.isArray(rows) && authoritativeRevision === null && !loading && !loadError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          The roster revision is unavailable. Refresh before editing respondents.
        </Alert>
      )}
      {hasChanges && hasIncompleteRows && respondentsReady && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Complete each respondent’s name and email, or discard changes, before saving.
        </Alert>
      )}
      {loading && (
        <Alert severity="info" icon={<CircularProgress size={18} />} sx={{ mb: 2 }}>
          Loading survey respondents…
        </Alert>
      )}
      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }} action={onRetry ? <Button color="inherit" size="small" onClick={onRetry}>Retry</Button> : undefined}>
          {loadError}
        </Alert>
      )}

      <DataGrid
        rows={tableRows}
        columns={columns}
        initialState={{
          pagination: { paginationModel: { pageSize: 10, page: 0 } },
        }}
        pageSizeOptions={[10, 25, 50, { value: -1, label: 'All' }]}
        disableSelectionOnClick
        processRowUpdate={readOnly || operationPending || !respondentsReady ? undefined : handleProcessRowUpdate}
        components={{
          Toolbar: GridToolbar,
        }}
        sortModel={sortModel}
        onSortModelChange={(model) => setSortModel(model)}
        sx={{
          '& .MuiDataGrid-columnHeader:hover': {
            backgroundColor: 'rgba(66, 179, 175, 0.3)',
          },
          '& .MuiDataGrid-row:hover': {
            backgroundColor: 'rgba(0, 178, 140, 0.2)',
          },
        }}
      />
    </Paper>
  );
};

export default RespondentTable;