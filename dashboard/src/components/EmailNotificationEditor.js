import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import DownloadIcon from '@mui/icons-material/Download';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import Papa from 'papaparse';
import api from '../api/axios';
import { LANGUAGES } from '@network-survey/frontend-shared';

const EMPTY_MESSAGE = { subject: '', text: '' };
const LEGACY_EMAIL_SUBJECT = 'CLA Network Survey';

const languageFromInput = (value) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  return LANGUAGES.find(
    (language) => language.label.toLowerCase() === normalized || language.code.toLowerCase() === normalized
  ) || null;
};

const normalizedHeader = (key) => String(key).trim().toLowerCase().replace(/[ _-]+/g, '');

const valueForHeader = (row, aliases) => {
  const entry = Object.entries(row).find(([key]) => aliases.includes(normalizedHeader(key)));
  return entry ? String(entry[1] ?? '') : '';
};

const hasHeader = (row, aliases) => Object.keys(row).some((key) => aliases.includes(normalizedHeader(key)));

export const buildNotificationDownloadRows = (notifications = {}, subjects = {}) => LANGUAGES
  .filter((language) => (
    Object.prototype.hasOwnProperty.call(notifications, language.label)
    || Object.prototype.hasOwnProperty.call(subjects, language.label)
  ))
  .map((language) => ({
    Language: language.label,
    Subject: subjects[language.label] ?? LEGACY_EMAIL_SUBJECT,
    // An explicitly persisted empty string must remain a row in the export.
    Text: notifications[language.label] ?? '',
  }));

const EmailNotificationEditor = ({ surveyId, onDirtyChange, onBusyChange }) => {
  const theme = useTheme();
  const uploadInputRef = useRef(null);
  const surveyIdRef = useRef(surveyId);
  const generationRef = useRef(0);
  const requestControllerRef = useRef(null);
  surveyIdRef.current = surveyId;
  const [selectedLanguage, setSelectedLanguage] = useState(LANGUAGES[0]);
  const [notifications, setNotifications] = useState({});
  const [subjects, setSubjects] = useState({});
  const [draft, setDraft] = useState(EMPTY_MESSAGE);
  const [original, setOriginal] = useState(EMPTY_MESSAGE);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState(null);

  const dirty = draft.subject !== original.subject || draft.text !== original.text;

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    onBusyChange?.(saving);
    return () => onBusyChange?.(false);
  }, [saving, onBusyChange]);

  useEffect(() => {
    const generation = ++generationRef.current;
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    let active = true;
    setSelectedLanguage(LANGUAGES[0]);
    setNotifications({});
    setSubjects({});
    setSaving(false);
    setDraft(EMPTY_MESSAGE);
    setOriginal(EMPTY_MESSAGE);
    setAlert(null);
    setLoadFailed(false);

    if (!surveyId) {
      setLoading(false);
      return () => { active = false; };
    }

    const isCurrent = () => active && generation === generationRef.current && surveyId === surveyIdRef.current;
    const loadNotifications = async () => {
      setLoading(true);
      try {
        const response = await api.get(`/survey-notifications/${surveyId}`);
        if (!isCurrent()) return;
        const nextNotifications = response.data?.notifications || {};
        const nextSubjects = response.data?.subjects || {};
        const language = LANGUAGES.find(
          (candidate) => Object.prototype.hasOwnProperty.call(nextNotifications, candidate.label)
            || Object.prototype.hasOwnProperty.call(nextSubjects, candidate.label)
        ) || LANGUAGES[0];
        const nextDraft = {
          subject: nextSubjects[language.label] ?? '',
          text: nextNotifications[language.label] ?? '',
        };
        setNotifications(nextNotifications);
        setSubjects(nextSubjects);
        setSelectedLanguage(language);
        setDraft(nextDraft);
        setOriginal(nextDraft);
      } catch (error) {
        if (isCurrent()) setLoadFailed(true);
      } finally {
        if (isCurrent()) setLoading(false);
      }
    };

    loadNotifications();
    return () => {
      active = false;
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
    };
  }, [surveyId, loadAttempt]);

  const selectLanguage = (_, language) => {
    if (!language || dirty) return;
    const nextDraft = {
      subject: subjects[language.label] ?? '',
      text: notifications[language.label] ?? '',
    };
    setSelectedLanguage(language);
    setDraft(nextDraft);
    setOriginal(nextDraft);
    setAlert(null);
  };

  const handleSave = async () => {
    if (!surveyId || loadFailed || !selectedLanguage || !dirty) return;
    const operationSurveyId = surveyId;
    const generation = generationRef.current;
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const isCurrent = () => generation === generationRef.current && operationSurveyId === surveyIdRef.current;
    setSaving(true);
    setAlert(null);
    try {
      await api.post(`/survey-notifications/${operationSurveyId}`, {
        language: selectedLanguage.label,
        subject: draft.subject,
        text: draft.text,
      }, { signal: controller.signal });
      if (!isCurrent()) return;
      setNotifications((current) => ({ ...current, [selectedLanguage.label]: draft.text }));
      setSubjects((current) => ({ ...current, [selectedLanguage.label]: draft.subject }));
      setOriginal(draft);
      setAlert({ severity: 'success', message: 'Email notification saved.' });
    } catch (error) {
      if (isCurrent() && !controller.signal.aborted) {
        setAlert({ severity: 'error', message: 'Failed to save email notification.' });
      }
    } finally {
      if (isCurrent()) {
        requestControllerRef.current = null;
        setSaving(false);
      }
    }
  };

  const handleReset = () => {
    setDraft(original);
    setAlert(null);
  };

  const downloadRows = useMemo(
    () => buildNotificationDownloadRows(notifications, subjects),
    [notifications, subjects]
  );

  const handleDownload = () => {
    const csv = Papa.unparse(downloadRows, { columns: ['Language', 'Subject', 'Text'] });
    const url = window.URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'survey-notifications.csv';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
  };

  const handleFileUpload = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || dirty || !surveyId || loadFailed) return;

    const operationSurveyId = surveyId;
    const generation = generationRef.current;
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const isCurrent = () => generation === generationRef.current && operationSurveyId === surveyIdRef.current;
    const finish = () => {
      if (!isCurrent()) return;
      requestControllerRef.current = null;
      setSaving(false);
    };

    setSaving(true);
    setAlert(null);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: async ({ data, errors, meta }) => {
        try {
          if (!isCurrent()) return;
          if (errors.length) throw new Error(errors[0].message);
          const normalizedFields = (meta?.fields || []).map(normalizedHeader);
          const textAliases = ['text', 'notificationtext', 'emailtext', 'message'];
          if (!normalizedFields.some((field) => textAliases.includes(field))) {
            throw new Error('CSV must include a recognized Text or Message header.');
          }

          const rows = data.map((row, index) => {
            const languageValue = valueForHeader(row, ['language', 'languagecode', 'lang']);
            const language = languageFromInput(languageValue);
            if (!language) throw new Error(`Unknown language on CSV row ${index + 2}: ${languageValue || '(blank)'}`);
            const includesSubject = hasHeader(row, ['subject', 'emailsubject']);
            return {
              Language: language.label,
              Subject: includesSubject
                ? valueForHeader(row, ['subject', 'emailsubject'])
                : (subjects[language.label] ?? LEGACY_EMAIL_SUBJECT),
              Text: valueForHeader(row, textAliases),
            };
          });

          if (!rows.length) throw new Error('No recognized notification rows were found.');

          const csvData = Papa.unparse(rows, { columns: ['Language', 'Subject', 'Text'] });
          await api.post('/updateEmails', { surveyName: operationSurveyId, csvData }, { signal: controller.signal });
          if (!isCurrent()) return;

          const importedNotifications = {};
          const importedSubjects = {};
          rows.forEach((row) => {
            importedNotifications[row.Language] = row.Text;
            importedSubjects[row.Language] = row.Subject;
          });
          const nextNotifications = { ...notifications, ...importedNotifications };
          const nextSubjects = { ...subjects, ...importedSubjects };
          const nextLanguage = languageFromInput(rows[0].Language) || LANGUAGES[0];
          const nextDraft = {
            subject: nextSubjects[nextLanguage.label] ?? '',
            text: nextNotifications[nextLanguage.label] ?? '',
          };
          setNotifications(nextNotifications);
          setSubjects(nextSubjects);
          setSelectedLanguage(nextLanguage);
          setDraft(nextDraft);
          setOriginal(nextDraft);
          setAlert({ severity: 'success', message: 'Email notifications imported.' });
        } catch (error) {
          if (isCurrent() && !controller.signal.aborted) {
            setAlert({ severity: 'error', message: error.message || 'Failed to import email notifications.' });
          }
        } finally {
          finish();
        }
      },
      error: (error) => {
        if (isCurrent() && !controller.signal.aborted) {
          setAlert({ severity: 'error', message: error.message || 'Failed to read the CSV file.' });
        }
        finish();
      },
    });
  };

  return (
    <Paper elevation={2} sx={{ p: 3, bgcolor: theme.palette.background.paper, borderRadius: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h6" color="primary" sx={{ fontWeight: 'bold' }}>
          Survey Email Notification
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleDownload} disabled={loading || saving || loadFailed || !surveyId}>
            Download CSV
          </Button>
          <Button
            variant="contained"
            startIcon={<UploadFileIcon />}
            onClick={() => uploadInputRef.current?.click()}
            disabled={loading || saving || loadFailed || dirty || !surveyId}
            title={dirty ? 'Save or reset the current changes before importing.' : undefined}
          >
            Upload CSV
          </Button>
          <input ref={uploadInputRef} type="file" hidden accept=".csv,text/csv" onChange={handleFileUpload} />
        </Box>
      </Box>

      {loadFailed && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={<Button color="inherit" size="small" onClick={() => setLoadAttempt((value) => value + 1)}>Retry</Button>}
        >
          Failed to load email notifications. Editing and CSV actions are disabled until the content is reloaded.
        </Alert>
      )}

      {alert && <Alert severity={alert.severity} onClose={() => setAlert(null)} sx={{ mb: 2 }}>{alert.message}</Alert>}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Autocomplete
            value={selectedLanguage}
            onChange={selectLanguage}
            options={LANGUAGES}
            getOptionLabel={(option) => option?.label || ''}
            isOptionEqualToValue={(option, value) => option.code === value?.code}
            disabled={loadFailed || dirty || saving}
            renderInput={(params) => <TextField {...params} label="Language" helperText={dirty ? 'Save or reset changes before switching languages.' : ' '} />}
            sx={{ maxWidth: 320 }}
          />
          <TextField
            fullWidth
            label="Email subject"
            value={draft.subject}
            onChange={(event) => setDraft((current) => ({ ...current, subject: event.target.value }))}
            disabled={!surveyId || loadFailed || saving}
          />
          <TextField
            fullWidth
            multiline
            minRows={8}
            label="Notification text"
            value={draft.text}
            onChange={(event) => setDraft((current) => ({ ...current, text: event.target.value }))}
            disabled={!surveyId || loadFailed || saving}
          />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
            <Button onClick={handleReset} disabled={loadFailed || !dirty || saving}>Reset</Button>
            <Button variant="contained" onClick={handleSave} disabled={loadFailed || !dirty || saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </Box>
        </Box>
      )}
    </Paper>
  );
};

export default EmailNotificationEditor;
