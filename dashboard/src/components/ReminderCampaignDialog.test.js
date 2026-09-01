import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import api from '../api/axios';
import ReminderCampaignDialog from './ReminderCampaignDialog';
vi.mock('../api/axios',()=>({default:{get:vi.fn(),post:vi.fn()}}));
const ready={canLaunch:true,targetCount:1,blockers:[],warnings:[],templateCoverage:[{language:'english',covered:true}]};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
beforeEach(()=>vi.clearAllMocks());
test('shows consequences and queues exactly one idempotent reminder campaign',async()=>{api.get.mockResolvedValue({data:ready});api.post.mockResolvedValue({data:{launch:{id:'run-1',kind:'reminder'}}});const accepted=vi.fn();render(<ReminderCampaignDialog open survey={{id:'survey-1'}} onClose={()=>{}} onAccepted={accepted}/>);expect(await screen.findByText(/1 incomplete eligible respondent/)).toBeInTheDocument();expect(screen.getByText(/does not resend invitations or change responses/i)).toBeInTheDocument();await userEvent.dblClick(screen.getByRole('button',{name:'Send reminders'}));await waitFor(()=>expect(api.post).toHaveBeenCalledTimes(1));expect(api.post.mock.calls[0][1]).toEqual({kind:'reminder'});expect(api.post.mock.calls[0][2].headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/i);expect(accepted).toHaveBeenCalled();});
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
