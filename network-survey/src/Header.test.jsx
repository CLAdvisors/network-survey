import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-device-detect', () => ({ isMobile: true }));

import Header from './Header';

describe('Header', () => {
  it('keeps the survey title on mobile devices regardless of landscape width', () => {
    render(
      <Header
        svgComponent={<span>Desktop logo</span>}
        title="Mobile survey title"
      />
    );

    expect(screen.getByRole('heading', { name: 'Mobile survey title' })).toBeInTheDocument();
    expect(screen.queryByText('Desktop logo')).not.toBeInTheDocument();
  });
});
