import React from 'react';
import { Alert, Autocomplete, Box, Button, Paper, Snackbar, TextField, Typography } from '@mui/material';
import { LANGUAGES } from '@network-survey/frontend-shared';
import api from '../api/axios';

const DEFAULT_SUBJECT = 'CLA Network Survey';

const InvitationSubjectEditor = ({ surveyId }) => {
  const [language, setLanguage] = React.useState(LANGUAGES[0]);
  const [subjects, setSubjects] = React.useState({});
  const [subject, setSubject] = React.useState(DEFAULT_SUBJECT);
  const [originalSubject, setOriginalSubject] = React.useState(DEFAULT_SUBJECT);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [notice, setNotice] = React.useState(null);
  const surveyIdRef = React.useRef(surveyId);
  const draftsRef = React.useRef(new Map());
  surveyIdRef.current = surveyId;

  React.useEffect(() => {
    if (!surveyId) return;
    let active = true;
    setLoading(true);
    setSubjects({});
    setLanguage(LANGUAGES[0]);
    setSubject(DEFAULT_SUBJECT);
    setOriginalSubject(DEFAULT_SUBJECT);
    api.get(`/survey-notifications/${surveyId}`)
      .then(({ data }) => {
        if (!active) return;
        const nextSubjects = data.notificationSubjects || {};
        const draft = draftsRef.current.get(surveyId);
        const initialLanguage = LANGUAGES.find(item => item.label === draft?.language) || LANGUAGES[0];
        const initialSubject = nextSubjects[initialLanguage.label] || DEFAULT_SUBJECT;
        setSubjects(nextSubjects);
        setLanguage(initialLanguage);
        setSubject(draft?.subject ?? initialSubject);
        setOriginalSubject(initialSubject);
      })
      .catch(() => active && setNotice({ severity: 'error', message: 'Failed to load invitation subjects.' }))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [surveyId]);

  const handleLanguageChange = (_event, nextLanguage) => {
    if (!nextLanguage) return;
    const nextSubject = subjects[nextLanguage.label] || DEFAULT_SUBJECT;
    setLanguage(nextLanguage);
    setSubject(nextSubject);
    setOriginalSubject(nextSubject);
  };

  const handleSave = async () => {
    const trimmedSubject = subject.trim();
    if (!trimmedSubject) {
      setNotice({ severity: 'error', message: 'Invitation email subject is required.' });
      return;
    }
    const targetSurveyId = surveyId;
    const targetLanguage = language.label;
    setSaving(true);
    try {
      await api.put(`/survey-notifications/${targetSurveyId}/subject`, {
        language: targetLanguage,
        subject: trimmedSubject,
      });
      if (surveyIdRef.current !== targetSurveyId) return;
      draftsRef.current.delete(targetSurveyId);
      setSubjects(previous => ({ ...previous, [targetLanguage]: trimmedSubject }));
      setSubject(trimmedSubject);
      setOriginalSubject(trimmedSubject);
      setNotice({ severity: 'success', message: 'Invitation email subject saved.' });
    } catch (error) {
      setNotice({
        severity: 'error',
        message: error.response?.data?.message || 'Failed to save invitation email subject.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Paper elevation={2} sx={{ p: 3, mb: 2, borderRadius: 2 }}>
      <Typography variant="h6" color="primary" sx={{ mb: 2, fontWeight: 'bold' }}>
        Invitation Email Subject
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 2, alignItems: 'flex-start' }}>
        <Autocomplete
          value={language}
          onChange={handleLanguageChange}
          options={LANGUAGES}
          getOptionLabel={option => option?.label || ''}
          renderInput={params => <TextField {...params} label="Subject language" />}
          sx={{ width: '100%', maxWidth: 300 }}
          disableClearable
          disabled={loading || saving || subject !== originalSubject}
        />
        <TextField
          fullWidth
          required
          label="Invitation email subject"
          value={subject}
          onChange={event => {
            const nextSubject = event.target.value;
            setSubject(nextSubject);
            draftsRef.current.set(surveyId, { language: language.label, subject: nextSubject });
          }}
          inputProps={{ maxLength: 255 }}
          error={!subject.trim()}
          disabled={loading || saving}
          helperText={subject !== originalSubject ? 'Save or revert this subject before changing language.' : ' '}
        />
        <Button
          variant="outlined"
          onClick={() => {
            draftsRef.current.delete(surveyId);
            setSubject(originalSubject);
          }}
          disabled={loading || saving || subject === originalSubject}
          sx={{ minWidth: 100, mt: { xs: 0, sm: 1 } }}
        >
          Revert
        </Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={loading || saving || subject === originalSubject}
          sx={{ minWidth: 100, mt: { xs: 0, sm: 1 } }}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </Box>
      <Snackbar open={Boolean(notice)} autoHideDuration={6000} onClose={() => setNotice(null)}>
        <Alert severity={notice?.severity || 'info'} onClose={() => setNotice(null)} variant="filled">
          {notice?.message}
        </Alert>
      </Snackbar>
    </Paper>
  );
};

export default InvitationSubjectEditor;
