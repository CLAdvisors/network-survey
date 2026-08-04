import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CreateSurveyDialog from './CreateSurveyDialog';

const renderDialog = (props) => render(
  <ThemeProvider theme={createTheme()}>
    <CreateSurveyDialog open onClose={vi.fn()} {...props} />
  </ThemeProvider>
);

test('submits the sole creatable organization for platform-admin survey creation', async () => {
  const onSubmit = vi.fn();
  renderDialog({
    onSubmit,
    memberships: [{
      organizationId: 'default-imported',
      organizationName: 'Default Imported',
      role: 'owner',
    }],
  });

  await userEvent.type(screen.getByLabelText('Survey Name'), 'QAEditableContent');
  await userEvent.click(screen.getByRole('button', { name: 'Create' }));

  expect(onSubmit).toHaveBeenCalledWith('QAEditableContent', 'default-imported');
});
