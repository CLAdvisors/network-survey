import React from 'react';
import {
  Alert, Box, Button, FormControl, FormControlLabel, FormHelperText,
  FormLabel, Paper, Radio, RadioGroup, Stack, TextField, Typography,
} from '@mui/material';
import api from '../api/axios';
import useSurveyOperationState from './useSurveyOperationState';

const DEFAULT_CHARACTER_LIMIT = 5000;
const DEFAULT_BYTE_LIMIT = 16000;
const modeFor = (value) => value === null ? 'derived' : value === '' ? 'hidden' : 'custom';
const characters = (value) => [...(value || '')].length;
const bytes = (value) => new TextEncoder().encode(value || '').length;
const errorMessage = (error, fallback) => error.response?.data?.message || error.response?.data?.error || fallback;

const SurveyInstructionsEditor = ({ surveyId, readOnly = false, readOnlyMessage, onDirtyChange, onOperationChange }) => {
  const [value, setValue] = React.useState(null);
  const [original, setOriginal] = React.useState(null);
  const [effectiveDefault, setEffectiveDefault] = React.useState('');
  const [limits, setLimits] = React.useState({ characters: DEFAULT_CHARACTER_LIMIT, bytes: DEFAULT_BYTE_LIMIT });
  const [loading, setLoading] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [reloadToken, setReloadToken] = React.useState(0);
  const [notice, setNotice] = React.useState(null);
  const draftsRef = React.useRef(new Map());
  const requestVersion = React.useRef(0);
  const surveyIdRef = React.useRef(surveyId);
  const noticeRef = React.useRef(null);
  const { begin, end, isPending, generation, advanceGeneration } = useSurveyOperationState('instructions', onOperationChange);
  const saving = isPending(surveyId);
  surveyIdRef.current = surveyId;

  React.useEffect(() => {
    if (notice?.severity === 'error') noticeRef.current?.focus();
  }, [notice]);

  React.useEffect(() => {
    const version = ++requestVersion.current;
    const loadGeneration = generation(surveyId);
    const controller = new AbortController();
    setNotice(null);
    setLoaded(false);
    setValue(null);
    setOriginal(null);
    setEffectiveDefault('');
    if (!surveyId) return () => controller.abort();
    setLoading(true);
    api.get(`/surveys/${surveyId}/instructions`, { signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted || version !== requestVersion.current) return;
        if (generation(surveyId) !== loadGeneration) {
          setReloadToken((value) => value + 1);
          return;
        }
        const persisted = data.instructions ?? null;
        const draft = draftsRef.current.get(surveyId);
        setOriginal(persisted);
        setValue(draft === undefined ? persisted : draft);
        setEffectiveDefault(data.derivedInstructions || data.effectiveInstructions || '');
        if (data.limits) setLimits(data.limits);
        setLoaded(true);
      })
      .catch((error) => {
        if (controller.signal.aborted || version !== requestVersion.current) return;
        if (generation(surveyId) !== loadGeneration) {
          setReloadToken((value) => value + 1);
          return;
        }
        setNotice({ severity: 'error', message: errorMessage(error, 'Unable to load survey instructions. Retry before editing.') });
      })
      .finally(() => {
        if (!controller.signal.aborted && version === requestVersion.current) setLoading(false);
      });
    return () => controller.abort();
  }, [surveyId, reloadToken]);

  const setDraft = (nextValue) => {
    if (!surveyId || readOnly) return;
    setValue(nextValue);
    const dirty = nextValue !== original;
    if (dirty) draftsRef.current.set(surveyId, nextValue);
    else draftsRef.current.delete(surveyId);
    advanceGeneration(surveyId);
    onDirtyChange?.(surveyId, 'instructions', dirty);
  };

  const handleModeChange = (_event, mode) => {
    if (mode === 'derived') setDraft(null);
    else if (mode === 'hidden') setDraft('');
    else if (mode === 'custom') setDraft(value && value !== '' ? value : effectiveDefault);
  };

  const discardDraft = () => {
    if (!surveyId || loading || saving || !loaded) return;
    if (readOnly) setReloadToken((value) => value + 1);
    else setValue(original);
    draftsRef.current.delete(surveyId);
    advanceGeneration(surveyId);
    onDirtyChange?.(surveyId, 'instructions', false);
  };

  const handleSave = async () => {
    if (readOnly || loading || !loaded || value === original || !begin(surveyId)) return;
    const targetId = surveyId;
    const targetValue = value;
    const savedDraft = draftsRef.current.get(targetId);
    const savedGeneration = generation(targetId);
    setNotice(null);
    try {
      const { data } = await api.put(`/surveys/${targetId}/instructions`, {
        instructions: targetValue,
        expectedInstructions: original,
      });
      const unchanged = draftsRef.current.get(targetId) === savedDraft && generation(targetId) === savedGeneration;
      advanceGeneration(targetId);
      if (unchanged) {
        draftsRef.current.delete(targetId);
        onDirtyChange?.(targetId, 'instructions', false);
      }
      if (surveyIdRef.current !== targetId || !unchanged) return;
      const authoritative = data.instructions ?? null;
      setOriginal(authoritative);
      setValue(authoritative);
      setEffectiveDefault(data.derivedInstructions || data.effectiveInstructions || '');
      setNotice({ severity: 'success', message: 'Survey instructions saved.' });
    } catch (error) {
      if (surveyIdRef.current !== targetId) return;
      setNotice({
        severity: 'error',
        message: errorMessage(error, 'Unable to save survey instructions. Your draft has been retained.'),
        reload: error.response?.data?.error === 'instructions_conflict',
      });
    } finally {
      end(targetId);
    }
  };

  const characterCount = characters(value);
  const byteCount = bytes(value);
  const tooLarge = characterCount > limits.characters || byteCount > limits.bytes;
  const dirty = value !== original;
  const mode = modeFor(value);

  return (
    <Paper elevation={2} sx={{ p: 3, borderRadius: 2 }} aria-busy={loading || saving}>
      <Typography variant="h6" color="primary" sx={{ fontWeight: 'bold', mb: 1 }}>Respondent Survey Instructions</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Choose the current survey-specific default, hide the block completely, or provide plain-text instructions.
      </Typography>
      {readOnly && <Alert severity="info" sx={{ mb: 2 }}>{readOnlyMessage || 'You do not have permission to update these instructions.'}</Alert>}
      {notice && <Alert
        ref={noticeRef}
        tabIndex={-1}
        severity={notice.severity}
        sx={{ mb: 2 }}
        action={notice.severity === 'error' && (!loaded || notice.reload) ? (
          <Button color="inherit" onClick={() => setReloadToken((value) => value + 1)}>
            {notice.reload ? 'Reload latest' : 'Retry'}
          </Button>
        ) : undefined}
      >{notice.message}</Alert>}
      <FormControl disabled={readOnly || loading || saving || !loaded}>
        <FormLabel id="survey-instructions-mode-label">Instruction display</FormLabel>
        <RadioGroup aria-labelledby="survey-instructions-mode-label" value={mode} onChange={handleModeChange}>
          <FormControlLabel value="derived" control={<Radio />} label="Use the derived default" />
          <FormControlLabel value="hidden" control={<Radio />} label="Hide the instruction block" />
          <FormControlLabel value="custom" control={<Radio />} label="Use custom instructions" />
        </RadioGroup>
        <FormHelperText>Derived defaults automatically preserve approved TeamEVAL-specific wording.</FormHelperText>
      </FormControl>
      {mode === 'derived' && effectiveDefault && (
        <Alert severity="info" variant="outlined" sx={{ mt: 2, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          Current derived default: {effectiveDefault}
        </Alert>
      )}
      {mode === 'custom' && (
        <TextField
          fullWidth multiline minRows={5} label="Custom survey instructions" value={value || ''}
          onChange={(event) => setDraft(event.target.value)} disabled={loading || saving || !loaded}
          InputProps={{ readOnly }}
          error={tooLarge}
          helperText={`${characterCount}/${limits.characters} characters; ${byteCount}/${limits.bytes} UTF-8 bytes${tooLarge ? '. Limit exceeded; shorten the instructions before saving.' : ''}`}
          FormHelperTextProps={{ id: 'survey-instructions-count' }}
          inputProps={{ 'aria-describedby': 'survey-instructions-count' }}
          sx={{ mt: 2, '& textarea': { overflowWrap: 'anywhere' } }}
        />
      )}
      {mode !== 'custom' && (
        <Typography id="survey-instructions-count" variant="caption" sx={{ display: 'block', mt: 1 }}>
          {characterCount}/{limits.characters} characters; {byteCount}/{limits.bytes} UTF-8 bytes
        </Typography>
      )}
      <Box sx={{ mt: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="flex-end">
          <Button variant="outlined" onClick={discardDraft} disabled={loading || saving || !loaded || !dirty}>Undo changes</Button>
          <Button variant="contained" onClick={handleSave} disabled={readOnly || loading || saving || !loaded || !dirty || tooLarge}>
            {saving ? 'Saving…' : 'Save instructions'}
          </Button>
        </Stack>
      </Box>
    </Paper>
  );
};

export default SurveyInstructionsEditor;
