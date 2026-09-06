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
vi.mock('@network-survey/frontend-shared', async (importOriginal) => ({
  ...(await importOriginal()),
  PRODUCTION_SURVEY_WRAPPER_SX: {},
}));

import Survey from './Survey';

describe('respondent instruction rendering', () => {
  it('renders paired same-line markers as bold while preserving newlines and escaping HTML', async () => {
    runtime.instructions = 'First **important** line\n**<script>alert("x")</script>**\n**Fields marked * are required**';
    const { container } = render(<Survey />);
    const block = container.querySelector('.survey-instructions');
    const body = block.querySelector('p');
    expect(await screen.findByText('important', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('<script>alert("x")</script>', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('Fields marked * are required', { selector: 'strong' })).toBeInTheDocument();
    expect(body.textContent).toContain('line\n<script>alert("x")</script>\nFields');
    expect(container.querySelector('script')).toBeNull();
    expect(block).toHaveStyle({ overflowWrap: 'anywhere' });
    expect(body).toHaveStyle({ whiteSpace: 'pre-wrap' });
  });

  it('leaves legacy plain text and unsupported or malformed markers literal', () => {
    runtime.instructions = 'Legacy text\n**unfinished\n**** and *single* and ***triple***';
    const { container } = render(<Survey />);
    const body = container.querySelector('.survey-instructions p');
    expect(body).toHaveTextContent('Legacy text **unfinished **** and *single* and ***triple***');
    expect(body.textContent).toBe(runtime.instructions);
    expect(body.querySelector('strong')).toBeNull();
  });

  it('omits the entire instruction block for an explicit empty value', () => {
    runtime.instructions = '';
    const { container } = render(<Survey />);
    expect(container.querySelector('.survey-instructions')).toBeNull();
  });
});
