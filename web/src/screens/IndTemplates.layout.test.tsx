import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import IndTemplates from './IndTemplates';

describe('Шаблоны индивидуальных: название и плашка статуса', () => {
  beforeEach(() => fake.reset());
  it('название и плашка лежат в заголовке с бейджем (ks-head-badge), а не в переносимой строке', async () => {
    fake.db.individual_templates = [{ id: 't1', isodow: 6, start_time: '19:00:00', end_time: null, goalkeepers: 0, active: true }];
    fake.rpc.ind_template_overflow = () => ({ data: [], error: null });
    render(<IndTemplates />);
    const pill = await screen.findByText('Активен');
    await waitFor(() => expect(pill.parentElement?.className).toContain('ks-head-badge'));
    expect(pill.parentElement?.className).not.toBe('ks-line');
  });
});
