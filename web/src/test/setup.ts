import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { fake } from './fakeSupabase';
import { dirtyGuard, resetDetachedNav } from '../nav';

beforeEach(() => {
  fake.reset();
  resetDetachedNav();
  dirtyGuard.reset();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
