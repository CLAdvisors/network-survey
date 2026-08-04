import { cleanup } from '@testing-library/react';
import matchers from '@testing-library/jest-dom/matchers';
import { afterEach, expect } from 'vitest';

expect.extend(matchers);
afterEach(() => cleanup());
