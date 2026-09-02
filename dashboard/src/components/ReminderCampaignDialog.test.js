import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import api from '../api/axios';
import ReminderCampaignDialog from './ReminderCampaignDialog';
vi.mock('../api/axios',()=>({default:{get:vi.fn(),post:vi.fn()}}));
const ready={canLaunch:true,targetCount:1,blockers:[],warnings:[],templateCoverage:[{language:'english',covered:true}]};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();});
test('shows consequences and queues exactly one idempotent reminder campaign',async()=>{api.get.mockResolvedValue({data:ready});api.post.mockResolvedValue({data:{launch:{id:'run-1',kind:'reminder'}}});const accepted=vi.fn();render(<ReminderCampaignDialog open survey={{id:'survey-1'}} onClose={()=>{}} onAccepted={accepted}/>);expect(await screen.findByText(/1 incomplete eligible respondent/)).toBeInTheDocument();expect(screen.getByText(/does not resend invitations or change responses/i)).toBeInTheDocument();await userEvent.dblClick(screen.getByRole('button',{name:'Send reminders'}));await waitFor(()=>expect(api.post).toHaveBeenCalledTimes(1));expect(api.post.mock.calls[0][1]).toEqual({kind:'reminder'});expect(api.post.mock.calls[0][2].headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/i);expect(accepted).toHaveBeenCalled();});
test('retains a survey key across an ambiguous failure and close/reopen, then rotates it after success',async()=>{
  api.get.mockResolvedValue({data:ready});
  api.post
    .mockRejectedValueOnce(new Error('network disconnected'))
    .mockResolvedValueOnce({data:{launch:{id:'run-1'}}})
    .mockResolvedValueOnce({data:{launch:{id:'run-2'}}});
  const view=render(<ReminderCampaignDialog open survey={{id:'survey-1'}} onClose={()=>{}}/>);
  await screen.findByText(/1 incomplete eligible respondent/);
  await userEvent.click(screen.getByRole('button',{name:'Send reminders'}));
  expect(await screen.findByText('Unable to queue reminder campaign.')).toBeInTheDocument();
  const firstKey=api.post.mock.calls[0][2].headers['Idempotency-Key'];

  view.unmount();
  const reopened=render(<ReminderCampaignDialog open survey={{id:'survey-1'}} onClose={()=>{}}/>);
  await screen.findByText(/1 incomplete eligible respondent/);
  await userEvent.click(screen.getByRole('button',{name:'Send reminders'}));
  await waitFor(()=>expect(api.post).toHaveBeenCalledTimes(2));
  expect(api.post.mock.calls[1][2].headers['Idempotency-Key']).toBe(firstKey);

  reopened.rerender(<ReminderCampaignDialog open={false} survey={{id:'survey-1'}} onClose={()=>{}}/>);
  reopened.rerender(<ReminderCampaignDialog open survey={{id:'survey-1'}} onClose={()=>{}}/>);
  await screen.findByText(/1 incomplete eligible respondent/);
  await userEvent.click(screen.getByRole('button',{name:'Send reminders'}));
  await waitFor(()=>expect(api.post).toHaveBeenCalledTimes(3));
  expect(api.post.mock.calls[2][2].headers['Idempotency-Key']).not.toBe(firstKey);
});

test('shares an in-flight result across unmount and remount without enabling a second launch',async()=>{
  const launch=deferred();api.get.mockResolvedValue({data:ready});api.post.mockReturnValue(launch.promise);const accepted=vi.fn();
  const first=render(<ReminderCampaignDialog open survey={{id:'shared-survey'}} onClose={()=>{}} onAccepted={accepted}/>);
  await screen.findByText(/1 incomplete eligible respondent/);await userEvent.click(screen.getByRole('button',{name:'Send reminders'}));
  first.unmount();render(<ReminderCampaignDialog open survey={{id:'shared-survey'}} onClose={()=>{}} onAccepted={accepted}/>);
  await screen.findByText(/1 incomplete eligible respondent/);expect(screen.getByRole('button',{name:'Queueing…'})).toBeDisabled();
  await act(async()=>launch.resolve({data:{launch:{id:'run-shared'}}}));
  await waitFor(()=>expect(accepted).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button',{name:'Send reminders'})).toBeDisabled();expect(api.post).toHaveBeenCalledTimes(1);
});

test('acknowledges a successful launch when returning to its survey',async()=>{
  const launch=deferred();api.get.mockResolvedValue({data:ready});api.post.mockReturnValue(launch.promise);const accepted=vi.fn();
  const view=render(<ReminderCampaignDialog open survey={{id:'survey-a'}} onClose={()=>{}} onAccepted={accepted}/>);await screen.findByText(/1 incomplete eligible respondent/);await userEvent.click(screen.getByRole('button',{name:'Send reminders'}));
  view.rerender(<ReminderCampaignDialog open survey={{id:'survey-b'}} onClose={()=>{}} onAccepted={accepted}/>);await screen.findByText(/1 incomplete eligible respondent/);
  await act(async()=>launch.resolve({data:{launch:{id:'run-a'}}}));expect(accepted).not.toHaveBeenCalled();
  view.rerender(<ReminderCampaignDialog open survey={{id:'survey-a'}} onClose={()=>{}} onAccepted={accepted}/>);await waitFor(()=>expect(accepted).toHaveBeenCalledTimes(1));expect(screen.getByRole('button',{name:'Send reminders'})).toBeDisabled();
});

test('ignores a remounted readiness response that arrives after shared launch success',async()=>{
  const launch=deferred();const stalePreview=deferred();api.get.mockResolvedValueOnce({data:ready}).mockReturnValueOnce(stalePreview.promise);api.post.mockReturnValue(launch.promise);const accepted=vi.fn();
  const first=render(<ReminderCampaignDialog open survey={{id:'stale-preview-survey'}} onClose={()=>{}} onAccepted={accepted}/>);
  await screen.findByText(/1 incomplete eligible respondent/);await userEvent.click(screen.getByRole('button',{name:'Send reminders'}));first.unmount();
  render(<ReminderCampaignDialog open survey={{id:'stale-preview-survey'}} onClose={()=>{}} onAccepted={accepted}/>);expect(screen.getByRole('button',{name:'Queueing…'})).toBeDisabled();
  await act(async()=>launch.resolve({data:{launch:{id:'run-stale'}}}));await waitFor(()=>expect(accepted).toHaveBeenCalledTimes(1));
  await act(async()=>stalePreview.resolve({data:ready}));expect(screen.queryByText(/1 incomplete eligible respondent/)).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Send reminders'})).toBeDisabled();
});

test('keeps idempotency keys isolated by survey during switches and delayed responses',async()=>{
  const firstLaunch=deferred();
  api.get.mockResolvedValue({data:ready});
  api.post.mockReturnValueOnce(firstLaunch.promise).mockResolvedValueOnce({data:{launch:{id:'run-2'}}});
  const accepted=vi.fn();
  const view=render(<ReminderCampaignDialog open survey={{id:'one'}} onClose={()=>{}} onAccepted={accepted}/>);
  await screen.findByText(/1 incomplete eligible respondent/);
  await userEvent.click(screen.getByRole('button',{name:'Send reminders'}));
  const oneKey=api.post.mock.calls[0][2].headers['Idempotency-Key'];
  view.rerender(<ReminderCampaignDialog open survey={{id:'two'}} onClose={()=>{}} onAccepted={accepted}/>);
  await screen.findByText(/1 incomplete eligible respondent/);
  await userEvent.click(screen.getByRole('button',{name:'Send reminders'}));
  const twoKey=api.post.mock.calls[1][2].headers['Idempotency-Key'];
  expect(twoKey).not.toBe(oneKey);
  view.rerender(<ReminderCampaignDialog open survey={{id:'one'}} onClose={()=>{}} onAccepted={accepted}/>);
  await screen.findByText(/1 incomplete eligible respondent/);
  expect(screen.getByRole('button',{name:'Queueing…'})).toBeDisabled();
  await act(async()=>firstLaunch.resolve({data:{launch:{id:'run-1'}}}));
  await waitFor(()=>expect(accepted).toHaveBeenCalledTimes(2));
  expect(api.post).toHaveBeenCalledTimes(2);
});

test('blocks zero targets and unsaved work',async()=>{api.get.mockResolvedValue({data:{...ready,canLaunch:false,targetCount:0,blockers:[{code:'recipients_missing',message:'No respondents.'}]}});render(<ReminderCampaignDialog open survey={{id:'survey-1'}} onClose={()=>{}} unsavedChanges={{reminderTemplate:true}}/>);expect(await screen.findByText('No respondents.')).toBeInTheDocument();expect(screen.getByText(/Save or revert unsaved/)).toBeInTheDocument();expect(screen.getByRole('button',{name:'Send reminders'})).toBeDisabled();});
test('ignores readiness after survey switch',async()=>{const first=deferred();api.get.mockReturnValueOnce(first.promise).mockResolvedValueOnce({data:{...ready,targetCount:7}});const view=render(<ReminderCampaignDialog open survey={{id:'one'}} onClose={()=>{}}/>);view.rerender(<ReminderCampaignDialog open survey={{id:'two'}} onClose={()=>{}}/>);expect(await screen.findByText(/7 incomplete eligible/)).toBeInTheDocument();first.resolve({data:{...ready,targetCount:99}});await Promise.resolve();expect(screen.queryByText(/99 incomplete eligible/)).not.toBeInTheDocument();});
test('invalidates stale readiness after a launch conflict',async()=>{
  api.get.mockResolvedValue({data:ready});
  api.post.mockRejectedValue({response:{status:409,data:{message:'Wait for the current reminder campaign to finish.'}}});
  render(<ReminderCampaignDialog open survey={{id:'survey-1'}} onClose={()=>{}}/>);
  expect(await screen.findByText(/1 incomplete eligible respondent/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button',{name:'Send reminders'}));
  expect(await screen.findByText('Wait for the current reminder campaign to finish.')).toBeInTheDocument();
  expect(screen.queryByText(/1 incomplete eligible respondent/)).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Send reminders'})).toBeDisabled();
});

test('replaces stale preview with launch-time readiness after a 422',async()=>{
  api.get.mockResolvedValue({data:ready});
  api.post.mockRejectedValue({response:{status:422,data:{message:'Reminder campaign is not ready to launch.',details:{
    ...ready,targetCount:0,canLaunch:true,
    blockers:[{code:'recipients_missing',message:'No incomplete respondents remain.'}],
    templateCoverage:[{language:'french',covered:false}],
  }}}});
  render(<ReminderCampaignDialog open survey={{id:'survey-1'}} onClose={()=>{}}/>);
  expect(await screen.findByText(/1 incomplete eligible respondent/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button',{name:'Send reminders'}));
  expect(await screen.findByText('No incomplete respondents remain.')).toBeInTheDocument();
  expect(screen.getByText(/0 incomplete eligible respondents/)).toBeInTheDocument();
  expect(screen.getByText('french: missing')).toBeInTheDocument();
  expect(screen.queryByText('english: ready')).not.toBeInTheDocument();
  expect(screen.getByText('Reminder campaign is not ready to launch.')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Send reminders'})).toBeDisabled();
});
