import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ title: 'Survey title', instructions: '' }));
vi.mock('./SurveyComponent', () => ({
  default: ({ setTitle, setInstructions }) => {
    React.useEffect(() => {
      setTitle(runtime.title);
      setInstructions(runtime.instructions);
    }, [setTitle, setInstructions]);
    return <div data-testid="survey-component" />;
  },
}));
vi.mock('./Header', () => ({ default: ({ title }) => <header>{title}</header> }));
vi.mock('./logo.svg?react', () => ({ default: () => null }));
vi.mock('@network-survey/frontend-react', () => ({
  AppPage: ({ children }) => <main>{children}</main>,
  Surface: ({ children }) => <section>{children}</section>,
  appShadows: { surface: 'none' },
}));
vi.mock('@network-survey/frontend-shared', () => ({ PRODUCTION_SURVEY_WRAPPER_SX: {} }));

import Survey from './Survey';

describe('respondent instruction rendering', () => {
  it('preserves multiline plain text and safely renders markup-like content literally', async () => {
    runtime.instructions = 'First line\n<script>alert("x")</script>\nA'.repeat(400);
    const { container } = render(<Survey />);
    expect(await screen.findByText(/First line/)).toHaveTextContent('<script>alert("x")</script>');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('.survey-instructions')).toHaveStyle({ overflowWrap: 'anywhere' });
    expect(screen.getByText(/First line/)).toHaveStyle({ whiteSpace: 'pre-wrap' });
  });

  it('omits the entire instruction block for an explicit empty value', () => {
    runtime.instructions = '';
    const { container } = render(<Survey />);
    expect(container.querySelector('.survey-instructions')).toBeNull();
  });
});
