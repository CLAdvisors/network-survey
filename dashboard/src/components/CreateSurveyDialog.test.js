import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import CreateSurveyDialog from './CreateSurveyDialog';

test('create survey input enforces the shared alphanumeric 255-character contract', async () => {
  const onSubmit = vi.fn();
  render(
    <CreateSurveyDialog
      open
      onClose={() => {}}
      onSubmit={onSubmit}
      memberships={[{ organizationId: 'org-1', role: 'editor' }]}
    />
  );

  const input = screen.getByLabelText('Survey Name');
  expect(input).toHaveAttribute('maxlength', '255');
  expect(input).toHaveAttribute('pattern', '[A-Za-z0-9]*');

  await userEvent.type(input, 'Invalid Name');
  await userEvent.click(screen.getByRole('button', { name: 'Create' }));
  expect(screen.getByText('Only letters and numbers are allowed')).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
});
