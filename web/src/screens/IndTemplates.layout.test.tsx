import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import IndTemplates from './IndTemplates';
// @ts-expect-error нет типов node
import { readFileSync } from 'node:fs';

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

  it('карточка шаблона держит плашку справа и на 320–359 px (keep-row переопределяет колоночное правило)', async () => {
    fake.db.individual_templates = [{ id: 't1', isodow: 6, start_time: '19:00:00', end_time: null, goalkeepers: 0, active: true }];
    fake.rpc.ind_template_overflow = () => ({ data: [], error: null });
    render(<IndTemplates />);
    const pill = await screen.findByText('Активен');
    await waitFor(() => expect(pill.parentElement?.className).toContain('keep-row'));
    const css: string = readFileSync('src/ui/kit.css', 'utf8');
    expect(css).toMatch(/@media \(max-width: 359px\) \{ \.ks-head-badge\.keep-row \{ flex-direction: row;/);
    expect(css.indexOf('.ks-head-badge.keep-row')).toBeGreaterThan(css.indexOf('.ks-head-badge { flex-direction: column'));
  });
});
