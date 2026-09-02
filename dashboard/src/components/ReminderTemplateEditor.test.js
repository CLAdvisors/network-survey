import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import api from '../api/axios';
import ReminderTemplateEditor, { resetReminderTemplateVersionCacheForTests } from './ReminderTemplateEditor';
vi.mock('../api/axios',()=>({default:{get:vi.fn(),put:vi.fn()}}));
beforeEach(()=>{vi.clearAllMocks();resetReminderTemplateVersionCacheForTests();});
test('saves a localized template with optimistic version and clear dirty state',async()=>{api.get.mockResolvedValue({data:{templates:[{language:'english',subject:'Reminder',body:'Old body',version:3}]}});api.put.mockResolvedValue({data:{template:{language:'english',subject:'Reminder now',body:'New body',version:4}}});const dirty=vi.fn();render(<ReminderTemplateEditor surveyId="survey-1" editable onDirtyChange={dirty}/>);const subject=await screen.findByLabelText(/Reminder subject/);const body=screen.getByLabelText(/Reminder body/);await waitFor(()=>expect(subject).toBeEnabled());await userEvent.clear(subject);await userEvent.type(subject,'Reminder now');await userEvent.clear(body);await userEvent.type(body,'New body');expect(dirty).toHaveBeenLastCalledWith('survey-1','reminderTemplate',true);await userEvent.click(screen.getByRole('button',{name:'Save reminder template'}));await waitFor(()=>expect(api.put).toHaveBeenCalledWith('/surveys/survey-1/reminder-templates/english',{subject:'Reminder now',body:'New body',expectedVersion:3}));expect(await screen.findByText('Reminder template saved.')).toBeInTheDocument();expect(dirty).toHaveBeenLastCalledWith('survey-1','reminderTemplate',false);});
test('rebases a conflicting draft onto the persisted version so an explicit retry succeeds',async()=>{
  api.get
    .mockResolvedValueOnce({data:{templates:[{language:'english',subject:'Original',body:'Original body',version:3},{language:'spanish',subject:'Old Spanish',body:'Old Spanish body',version:2}]}})
    .mockResolvedValueOnce({data:{templates:[{language:'english',subject:'Someone else changed it',body:'Server body',version:8},{language:'spanish',subject:'Current Spanish',body:'Current Spanish body',version:9}]}});
  api.put
    .mockRejectedValueOnce({response:{status:409,data:{error:'template_version_conflict',message:'The reminder template changed. Reload before saving.'}}})
    .mockResolvedValueOnce({data:{template:{language:'english',subject:'My draft',body:'My draft body',version:9}}});
  const dirty=vi.fn();
  render(<ReminderTemplateEditor surveyId="survey-1" editable onDirtyChange={dirty}/>);
  const subject=await screen.findByLabelText(/Reminder subject/);const body=screen.getByLabelText(/Reminder body/);
  await waitFor(()=>expect(subject).toHaveValue('Original'));
  await userEvent.clear(subject);await userEvent.type(subject,'My draft');
  await userEvent.clear(body);await userEvent.type(body,'My draft body');
  await userEvent.click(screen.getByRole('button',{name:'Save reminder template'}));

  expect(await screen.findByText('The reminder template changed. Reload before saving.')).toBeInTheDocument();
  expect(subject).toHaveValue('My draft');expect(body).toHaveValue('My draft body');
  expect(dirty).toHaveBeenLastCalledWith('survey-1','reminderTemplate',true);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Save reminder template'})).toBeEnabled());
  await userEvent.click(screen.getByRole('button',{name:'Save reminder template'}));
  await waitFor(()=>expect(api.put).toHaveBeenLastCalledWith('/surveys/survey-1/reminder-templates/english',{subject:'My draft',body:'My draft body',expectedVersion:8}));
  expect(await screen.findByText('Reminder template saved.')).toBeInTheDocument();
  expect(dirty).toHaveBeenLastCalledWith('survey-1','reminderTemplate',false);
  await userEvent.click(screen.getByLabelText('Reminder language'));
  await userEvent.click(await screen.findByRole('option',{name:'Spanish'}));
  expect(subject).toHaveValue('Current Spanish');
  expect(body).toHaveValue('Current Spanish body');
});

test('does not apply a conflict reload to another survey',async()=>{
  const conflictReload=deferred();
  api.get
    .mockResolvedValueOnce({data:{templates:[{language:'english',subject:'Original A',body:'Body A',version:1}]}})
    .mockReturnValueOnce(conflictReload.promise)
    .mockResolvedValueOnce({data:{templates:[{language:'english',subject:'Original B',body:'Body B',version:4}]}})
    .mockResolvedValueOnce({data:{templates:[{language:'english',subject:'Server A',body:'Server body A',version:5}]}});
  api.put.mockRejectedValueOnce({response:{status:409,data:{error:'template_version_conflict',message:'Conflict'}}});
  const dirty=vi.fn();const view=render(<ReminderTemplateEditor surveyId="survey-a" editable onDirtyChange={dirty}/>);
  const subject=await screen.findByLabelText(/Reminder subject/);await waitFor(()=>expect(subject).toHaveValue('Original A'));
  await userEvent.clear(subject);await userEvent.type(subject,'Draft A');
  await userEvent.click(screen.getByRole('button',{name:'Save reminder template'}));
  view.rerender(<ReminderTemplateEditor surveyId="survey-b" editable onDirtyChange={dirty}/>);
  await waitFor(()=>expect(subject).toHaveValue('Original B'));
  conflictReload.resolve({data:{templates:[{language:'english',subject:'Server A',body:'Server body A',version:5}]}});
  await waitFor(()=>expect(subject).toHaveValue('Original B'));
  expect(screen.queryByText('Conflict')).not.toBeInTheDocument();
  view.rerender(<ReminderTemplateEditor surveyId="survey-a" editable onDirtyChange={dirty}/>);
  await waitFor(()=>expect(subject).toHaveValue('Draft A'));
  expect(dirty).toHaveBeenLastCalledWith('survey-a','reminderTemplate',true);
});

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};

test('preserves a draft when a delayed save is older than a newer A-B-A load',async()=>{
  const delayedSave=deferred();
  api.get
    .mockResolvedValueOnce({data:{templates:[{language:'english',subject:'Original A',body:'Body A',version:1}]}})
    .mockResolvedValueOnce({data:{templates:[{language:'english',subject:'Original B',body:'Body B',version:2}]}})
    .mockResolvedValueOnce({data:{templates:[{language:'english',subject:'Admin A',body:'Admin body',version:5}]}});
  api.put
    .mockReturnValueOnce(delayedSave.promise)
    .mockResolvedValueOnce({data:{template:{language:'english',subject:'My A draft',body:'Body A',version:6}}});
  const dirty=vi.fn();
  const view=render(<ReminderTemplateEditor surveyId="survey-a" editable onDirtyChange={dirty}/>);
  const subject=await screen.findByLabelText(/Reminder subject/);
  await waitFor(()=>expect(subject).toHaveValue('Original A'));
  await userEvent.clear(subject);await userEvent.type(subject,'My A draft');
  await userEvent.click(screen.getByRole('button',{name:'Save reminder template'}));
  view.rerender(<ReminderTemplateEditor surveyId="survey-b" editable onDirtyChange={dirty}/>);
  await waitFor(()=>expect(subject).toHaveValue('Original B'));
  view.rerender(<ReminderTemplateEditor surveyId="survey-a" editable onDirtyChange={dirty}/>);
  await waitFor(()=>expect(subject).toHaveValue('My A draft'));

  await act(async()=>delayedSave.resolve({data:{template:{language:'english',subject:'My A draft',body:'Body A',version:2}}}));
  expect(await screen.findByText(/newer reminder template was loaded while this save was pending/i)).toBeInTheDocument();
  expect(subject).toHaveValue('My A draft');
  expect(dirty).toHaveBeenLastCalledWith('survey-a','reminderTemplate',true);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Save reminder template'})).toBeEnabled());
  await userEvent.click(screen.getByRole('button',{name:'Save reminder template'}));
  await waitFor(()=>expect(api.put).toHaveBeenLastCalledWith('/surveys/survey-a/reminder-templates/english',{subject:'My A draft',body:'Body A',expectedVersion:5}));
});

test('applies a newer A reload that returns after an older pending save',async()=>{
  const delayedSave=deferred();const delayedReload=deferred();
  api.get
    .mockResolvedValueOnce({data:{templates:[{language:'english',subject:'Original A',body:'Body A',version:1}]}})
    .mockResolvedValueOnce({data:{templates:[{language:'english',subject:'Original B',body:'Body B',version:1}]}})
    .mockReturnValueOnce(delayedReload.promise);
  api.put.mockReturnValueOnce(delayedSave.promise);
  const view=render(<ReminderTemplateEditor surveyId="survey-a" editable/>);
  const subject=await screen.findByLabelText(/Reminder subject/);
  await waitFor(()=>expect(subject).toHaveValue('Original A'));
  await userEvent.clear(subject);await userEvent.type(subject,'Saved A');
  await userEvent.click(screen.getByRole('button',{name:'Save reminder template'}));
  view.rerender(<ReminderTemplateEditor surveyId="survey-b" editable/>);
  await waitFor(()=>expect(subject).toHaveValue('Original B'));
  view.rerender(<ReminderTemplateEditor surveyId="survey-a" editable/>);
  await act(async()=>delayedSave.resolve({data:{template:{language:'english',subject:'Saved A',body:'Body A',version:2}}}));
  await waitFor(()=>expect(subject).toHaveValue('Saved A'));
  await act(async()=>delayedReload.resolve({data:{templates:[{language:'english',subject:'Newer server A',body:'Newer body',version:5}]}}));
  await waitFor(()=>expect(subject).toHaveValue('Newer server A'));
});

test('accepts a lower authoritative version from a later reload after rollback',async()=>{
  api.get
    .mockResolvedValueOnce({data:{templates:[{language:'english',subject:'Before rollback',body:'Version eight',version:8}]}})
    .mockResolvedValueOnce({data:{templates:[{language:'english',subject:'Survey B',body:'Body B',version:1}]}})
    .mockResolvedValueOnce({data:{templates:[{language:'english',subject:'After rollback',body:'Version two',version:2}]}});
  const view=render(<ReminderTemplateEditor surveyId="survey-a" editable/>);const subject=await screen.findByLabelText(/Reminder subject/);
  await waitFor(()=>expect(subject).toHaveValue('Before rollback'));
  view.rerender(<ReminderTemplateEditor surveyId="survey-b" editable/>);await waitFor(()=>expect(subject).toHaveValue('Survey B'));
  view.rerender(<ReminderTemplateEditor surveyId="survey-a" editable/>);await waitFor(()=>expect(subject).toHaveValue('After rollback'));
});

test('preserves save ownership as a retryable draft across an A to B to A survey switch',async()=>{
  let resolveSave;
  const save=new Promise(resolve=>{resolveSave=resolve;});
  api.get
    .mockResolvedValueOnce({data:{templates:[{language:'english',subject:'Original A',body:'Body',version:8}]}})
    .mockResolvedValueOnce({data:{templates:[{language:'english',subject:'Original B',body:'Body',version:1}]}})
    .mockResolvedValueOnce({data:{templates:[{language:'english',subject:'Rolled back A',body:'Rollback body',version:2}]}});
  api.put.mockReturnValue(save);
  const dirty=vi.fn();
  const view=render(<ReminderTemplateEditor surveyId="survey-a" editable onDirtyChange={dirty}/>);
  const subject=await screen.findByLabelText(/Reminder subject/);
  await waitFor(()=>expect(subject).toHaveValue('Original A'));
  await userEvent.clear(subject);await userEvent.type(subject,'Saved A');
  await userEvent.click(screen.getByRole('button',{name:'Save reminder template'}));
  view.rerender(<ReminderTemplateEditor surveyId="survey-b" editable onDirtyChange={dirty}/>);
  await waitFor(()=>expect(subject).toHaveValue('Original B'));
  view.rerender(<ReminderTemplateEditor surveyId="survey-a" editable onDirtyChange={dirty}/>);
  await waitFor(()=>expect(subject).toHaveValue('Saved A'));
  await act(async()=>resolveSave({data:{template:{language:'english',subject:'Saved A',body:'Body',version:'9'}}}));
  expect(await screen.findByText(/newer reminder template was loaded while this save was pending/i)).toBeInTheDocument();
  expect(subject).toHaveValue('Saved A');
  expect(screen.getByRole('button',{name:'Save reminder template'})).toBeEnabled();
  expect(dirty).toHaveBeenLastCalledWith('survey-a','reminderTemplate',true);
});

test('allows a local draft to be reverted after editing becomes unavailable',async()=>{api.get.mockResolvedValue({data:{templates:[{language:'english',subject:'Original',body:'Body',version:1}]}});const dirty=vi.fn();const view=render(<ReminderTemplateEditor surveyId="survey-1" editable onDirtyChange={dirty}/>);const subject=await screen.findByLabelText(/Reminder subject/);await waitFor(()=>expect(subject).toHaveValue('Original'));await userEvent.clear(subject);await userEvent.type(subject,'Draft');view.rerender(<ReminderTemplateEditor surveyId="survey-1" editable={false} onDirtyChange={dirty}/>);expect(screen.getByLabelText(/Reminder subject/)).toBeDisabled();const revert=screen.getByRole('button',{name:'Revert'});expect(revert).toBeEnabled();await userEvent.click(revert);expect(subject).toHaveValue('Original');expect(dirty).toHaveBeenLastCalledWith('survey-1','reminderTemplate',false);});
test('is read-only outside active admin editing and exposes server conflicts',async()=>{api.get.mockResolvedValue({data:{templates:[]}});const view=render(<ReminderTemplateEditor surveyId="survey-1" editable={false}/>);expect(await screen.findByText(/editable by survey administrators only while the survey is active/i)).toBeInTheDocument();expect(screen.getByLabelText(/Reminder subject/)).toBeDisabled();view.rerender(<ReminderTemplateEditor surveyId="survey-1" editable/>);});
