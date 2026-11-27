import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MatchResultRow from './MatchResultRow';

const row = (p: Partial<Parameters<typeof MatchResultRow>[0]>) => render(<MatchResultRow title="Соперник" meta="01.12.2026" gf={2} ga={1} {...p} />).container.firstElementChild as HTMLElement;

describe('строка результата матча (О1, О4, О5)', () => {
  it('светофор: победа, ничья, поражение, без счёта', () => {
    expect(row({ gf: 2, ga: 1 })).toHaveClass('w');
    expect(row({ gf: 1, ga: 1 })).toHaveClass('d');
    expect(row({ gf: 0, ga: 1 })).toHaveClass('l');
    const n = row({ gf: null, ga: null });
    expect(n).toHaveClass('n');
    expect(n).toHaveTextContent('Без счёта');
  });
  it('метка результата словом, цвет дополнительный', () => {
    row({ gf: 1, ga: 1 });
    expect(screen.getByText('Ничья')).toHaveClass('warning');
  });
  it('оценка 1-5 точками, баллы не выше 6; без оценки ничего', () => {
    const el = row({ kids: [{ status: 'played', rating: 5, best: true }] });
    expect(within(el).getByRole('img', { name: 'Оценка 5 из 5' }).querySelectorAll('i.f')).toHaveLength(5);
    expect(el).toHaveTextContent('+6 б.');
    const el2 = row({ kids: [{ status: 'played', rating: null }] });
    expect(within(el2).queryByRole('img', { name: /Оценка/ })).toBeNull();
    expect(el2).not.toHaveTextContent('б.');
  });
  it('без счёта баллы не показываются; у «Не играл» нет оценки и звезды', () => {
    expect(row({ gf: null, ga: null, kids: [{ status: 'played', rating: 3 }] })).not.toHaveTextContent('б.');
    const el = row({ kids: [{ status: 'not', rating: 3, best: true }] });
    expect(el).toHaveTextContent('Не играл');
    expect(el).not.toHaveTextContent('Лучший');
  });
});

describe('плитки сводки: числа на одном уровне', () => {
  it('плитка прижимает содержимое к верху, чтобы переносимая подпись не сдвигала число', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('src/ui/kit.css', 'utf8');
    const rule = css.split('\n').find(l => l.startsWith('.ks-mres-tiles .ks-tile {')) ?? '';
    expect(rule).toContain('flex-direction: column-reverse');
    expect(rule).toContain('justify-content: flex-end'); // в column-reverse это верх плитки
  });
});
