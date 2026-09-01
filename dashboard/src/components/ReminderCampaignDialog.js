import React from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, List, ListItem, ListItemText, Skeleton, Typography } from '@mui/material';
import api from '../api/axios';
import { surveyId } from './surveyLifecycle';

const newKey=()=>globalThis.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&3|8)).toString(16);});
const ReminderCampaignDialog=({open,survey,onClose,onAccepted,unsavedChanges={},pendingOperations={}})=>{
  const [readiness,setReadiness]=React.useState(null);const [readinessSurveyId,setReadinessSurveyId]=React.useState(null);const [error,setError]=React.useState('');const [loading,setLoading]=React.useState(false);const [submitting,setSubmitting]=React.useState(false);const [key,setKey]=React.useState(newKey);const request=React.useRef(0);const requestInFlight=React.useRef(null);const id=surveyId(survey);const idRef=React.useRef(id);idRef.current=id;
  React.useEffect(()=>{const version=++request.current;requestInFlight.current=null;setSubmitting(false);if(!open||!id)return undefined;const controller=new AbortController();setLoading(true);setError('');setReadiness(null);setReadinessSurveyId(null);setKey(newKey());api.get(`/surveys/${id}/reminder-readiness`,{signal:controller.signal}).then(({data})=>{if(!controller.signal.aborted&&version===request.current){setReadiness(data);setReadinessSurveyId(id);}}).catch(err=>{if(!controller.signal.aborted&&version===request.current)setError(err.response?.data?.message||'Unable to preview reminder campaign.');}).finally(()=>{if(!controller.signal.aborted&&version===request.current)setLoading(false);});return()=>controller.abort();},[open,id]);
  const dirty=Object.values(unsavedChanges).some(Boolean);const pending=Object.values(pendingOperations).some(Boolean);const blockers=readiness?.blockers||[];const canLaunch=readinessSurveyId===id&&readiness?.canLaunch&&readiness.targetCount>0&&blockers.length===0&&!dirty&&!pending&&!submitting;
  const submit=async()=>{if(!canLaunch||requestInFlight.current)return;const targetId=id;const version=request.current;const attempt={};requestInFlight.current=attempt;setSubmitting(true);setError('');try{const {data}=await api.post(`/surveys/${id}/launches`,{kind:'reminder'},{headers:{'Idempotency-Key':key}});if(version===request.current&&targetId===idRef.current)onAccepted?.(data);}catch(err){if(version!==request.current||targetId!==idRef.current)return;if(err.response?.status===422&&err.response?.data?.details){setReadiness({...err.response.data.details,canLaunch:false});setReadinessSurveyId(targetId);}else if(err.response?.status===409){setReadiness(null);setReadinessSurveyId(null);}setError(err.response?.data?.message||'Unable to queue reminder campaign.');}finally{if(requestInFlight.current===attempt)requestInFlight.current=null;if(version===request.current&&targetId===idRef.current)setSubmitting(false);}};
  return <Dialog open={open} onClose={()=>!submitting&&onClose?.()} fullWidth maxWidth="sm" aria-describedby="reminder-consequences" aria-busy={loading||submitting}>
    <DialogTitle>Send bulk reminder</DialogTitle><DialogContent>
      <DialogContentText id="reminder-consequences">This creates one auditable reminder campaign using the saved localized reminder templates. It does not resend invitations or change responses. Eligibility is checked again immediately before each provider request.</DialogContentText>
      {loading&&<Skeleton variant="rectangular" height={90} sx={{mt:2}} />}
      {readiness&&<Typography sx={{mt:2}} component="p" variant="h6">{readiness.targetCount} incomplete eligible {readiness.targetCount===1?'respondent':'respondents'} will be targeted</Typography>}
      {readiness?.templateCoverage?.length>0&&<List dense aria-label="Reminder template coverage">{readiness.templateCoverage.map(item=><ListItem key={item.language}><ListItemText primary={`${item.language}: ${item.covered?'ready':'missing'}`} /></ListItem>)}</List>}
      {(dirty||pending)&&<Alert severity="warning" sx={{mt:2}}>{pending?'Wait for current survey updates to finish.':'Save or revert unsaved survey changes before sending reminders.'}</Alert>}
      {blockers.map((item,index)=><Alert severity="error" sx={{mt:1}} key={`${item.code}-${index}`}>{item.message}</Alert>)}
      {readiness?.warnings?.map((item,index)=><Alert severity="warning" sx={{mt:1}} key={`${item.code}-${index}`}>{item.message}</Alert>)}
      {error&&<Alert severity="error" sx={{mt:2}}>{error}</Alert>}
    </DialogContent><DialogActions><Button onClick={onClose} disabled={submitting}>Cancel</Button><Button variant="contained" onClick={submit} disabled={!canLaunch}>{submitting?'Queueing…':'Send reminders'}</Button></DialogActions>
  </Dialog>;
};
export default ReminderCampaignDialog;
