import React from 'react';
import { Alert, Autocomplete, Box, Button, Paper, TextField, Typography } from '@mui/material';
import { LANGUAGES } from '@network-survey/frontend-shared';
import api from '../api/axios';
import useSurveyOperationState from './useSurveyOperationState';

const emptyTemplate = (language) => ({ language, subject: '', body: '', version: 0 });

const ReminderTemplateEditor = ({ surveyId, editable, onDirtyChange, onOperationChange }) => {
  const [language, setLanguage] = React.useState(LANGUAGES[0]);
  const [templates, setTemplates] = React.useState({});
  const [draft, setDraft] = React.useState(emptyTemplate(LANGUAGES[0].label.toLowerCase()));
  const [original, setOriginal] = React.useState(emptyTemplate(LANGUAGES[0].label.toLowerCase()));
  const [loading, setLoading] = React.useState(false);
  const [notice, setNotice] = React.useState(null);
  const request = React.useRef(0);
  const surveyRef = React.useRef(surveyId);
  const drafts = React.useRef(new Map());
  const { begin, end, isPending, generation, advanceGeneration } = useSurveyOperationState('reminderTemplate', onOperationChange);
  surveyRef.current = surveyId;
  const saving = isPending(surveyId);
  const dirty = draft.subject !== original.subject || draft.body !== original.body;

  const select = React.useCallback((option, records) => {
    const key = option.label.toLowerCase();
    const persisted = records[key] || emptyTemplate(key);
    const savedDraft = drafts.current.get(`${surveyId}:${key}`);
    setLanguage(option); setOriginal(persisted); setDraft(savedDraft || persisted);
  }, [surveyId]);

  React.useEffect(() => {
    const version = ++request.current;
    const loadGeneration = generation(surveyId);
    const reset = emptyTemplate(LANGUAGES[0].label.toLowerCase());
    setTemplates({}); setLanguage(LANGUAGES[0]); setDraft(reset); setOriginal(reset); setNotice(null); setLoading(Boolean(surveyId));
    if (!surveyId) return undefined;
    const controller = new AbortController();
    api.get(`/surveys/${surveyId}/reminder-templates`, { signal: controller.signal }).then(({data}) => {
      if (controller.signal.aborted || request.current !== version || generation(surveyId) !== loadGeneration) return;
      const records = Object.fromEntries((data.templates || []).map(item => [item.language, {...item,version:Number(item.version)}]));
      setTemplates(records);
      const draftLanguage = LANGUAGES.find(item => drafts.current.has(`${surveyId}:${item.label.toLowerCase()}`));
      select(draftLanguage || LANGUAGES[0], records);
    }).catch(error => {
      if (!controller.signal.aborted && request.current === version) setNotice({severity:'error',message:error.response?.data?.message || 'Unable to load reminder templates.'});
    }).finally(() => { if (!controller.signal.aborted && request.current === version) setLoading(false); });
    return () => controller.abort();
  }, [surveyId, select]);

  const change = (field, value) => {
    const next = {...draft,[field]:value}; setDraft(next);
    const key = `${surveyId}:${draft.language}`;
    const nextDirty = next.subject !== original.subject || next.body !== original.body;
    if (nextDirty) drafts.current.set(key,next); else drafts.current.delete(key);
    advanceGeneration(surveyId); onDirtyChange?.(surveyId,'reminderTemplate',nextDirty);
  };

  const save = async () => {
    if (!editable || !dirty || !draft.subject.trim() || !draft.body.trim() || !begin(surveyId)) return;
    const targetSurvey=surveyId; const target={...draft}; const version=request.current;
    const draftKey=`${targetSurvey}:${target.language}`; const savedDraft=drafts.current.get(draftKey);
    try {
      const {data}=await api.put(`/surveys/${targetSurvey}/reminder-templates/${target.language}`,{subject:target.subject,body:target.body,expectedVersion:target.version});
      const saved=data.template;
      if(drafts.current.get(draftKey)===savedDraft){drafts.current.delete(draftKey);onDirtyChange?.(targetSurvey,'reminderTemplate',false);}
      if (targetSurvey !== surveyRef.current || version !== request.current) return;
      setTemplates(current=>({...current,[target.language]:saved})); setOriginal(saved); setDraft(saved);
      advanceGeneration(targetSurvey);
      setNotice({severity:'success',message:'Reminder template saved.'});
    } catch(error) {
      if (targetSurvey === surveyRef.current && version === request.current) setNotice({severity:'error',message:error.response?.data?.message || 'Unable to save reminder template.'});
    } finally { end(targetSurvey); }
  };

  return <Paper elevation={2} sx={{p:3,borderRadius:2}} aria-label="Reminder email templates">
    {!editable && <Alert severity="info" sx={{mb:2}}>Reminder templates are editable by survey administrators only while the survey is active.</Alert>}
    {notice && <Alert severity={notice.severity} sx={{mb:2}} onClose={()=>setNotice(null)}>{notice.message}</Alert>}
    <Typography component="h3" variant="h6" color="primary" sx={{fontWeight:'bold',mb:2}}>Reminder Email</Typography>
    <Autocomplete value={language} options={LANGUAGES} disableClearable disabled={!editable||loading||saving||dirty} getOptionLabel={item=>item?.label||''} onChange={(_event,next)=>next&&select(next,templates)} renderInput={params=><TextField {...params} label="Reminder language" helperText={dirty?'Save or revert before changing language.':' '} />} sx={{maxWidth:300,mb:2}} />
    <TextField fullWidth required label="Reminder subject" inputProps={{maxLength:255}} value={draft.subject} disabled={!editable||loading||saving} onChange={event=>change('subject',event.target.value)} error={dirty&&!draft.subject.trim()} sx={{mb:2}} />
    <TextField fullWidth required multiline rows={7} label="Reminder body" inputProps={{maxLength:2555}} value={draft.body} disabled={!editable||loading||saving} onChange={event=>change('body',event.target.value)} error={dirty&&!draft.body.trim()} />
    <Box sx={{display:'flex',justifyContent:'flex-end',gap:2,mt:2}}>
      <Button variant="outlined" disabled={!editable||loading||saving||!dirty} onClick={()=>{drafts.current.delete(`${surveyId}:${draft.language}`);advanceGeneration(surveyId);onDirtyChange?.(surveyId,'reminderTemplate',false);setDraft(original);}}>Revert</Button>
      <Button variant="contained" disabled={!editable||loading||saving||!dirty||!draft.subject.trim()||!draft.body.trim()} onClick={save}>{saving?'Saving…':'Save reminder template'}</Button>
    </Box>
  </Paper>;
};
export default ReminderTemplateEditor;
