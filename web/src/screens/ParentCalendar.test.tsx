import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
// @ts-expect-error в проекте нет типов node; vitest читает файл напрямую (CSS через ?raw в тестах пустой)
import { readFileSync } from 'node:fs';
import ParentCalendar from './ParentCalendar';

const tokens: string = readFileSync('src/ui/tokens.css', 'utf8');

describe('календарь родителя', () => {
  beforeEach(() => {
    fake.reset();
    fake.db.player_guardians = [{
      user_id: 'u',
      player_id: 'p1',
      consent_revoked_at: null,
      players: { id: 'p1', full_name: 'Аня', groups: { name: 'U9' } },
    }];
  });

  it('загружает календарь выбранного ребёнка и показывает событие на текущую дату', async () => {
    const today = new Date();
    const eventDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    fake.rpc.parent_calendar = () => [{
      event_id: 'match:m1',
      event_date: eventDate,
      event_time: null,
      event_type: 'match',
      title: 'Матч с Динамо',
      location: null,
      event_status: 'upcoming',
      attendance_status: null,
    }];

    render(<ParentCalendar />);
    expect(await screen.findByText('Календарь ребёнка')).toBeInTheDocument();
    expect(await screen.findByText('Матч с Динамо')).toBeInTheDocument();
    await waitFor(() => expect(fake.rpcCalls('parent_calendar')).toEqual([{
      p_player: 'p1',
      p_from: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`,
      p_to: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()}`,
    }]));
  });

  it('не подменяет ошибку загрузки пустым календарём', async () => {
    fake.rpc.parent_calendar = () => ({ data: null, error: { message: 'permission denied' } });
    render(<ParentCalendar />);
    expect(await screen.findByText('События не загрузились')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });

  it('дни месяца — обычные кнопки в группе, без недопустимых ролей таблицы', async () => {
    fake.rpc.parent_calendar = () => [];
    const { container } = render(<ParentCalendar />);
    await screen.findByText('Календарь ребёнка');
    expect(container.querySelector('[role="grid"], [role="gridcell"], [role="columnheader"]')).toBeNull();
    const days = container.querySelectorAll('button[aria-pressed]');
    expect(days.length).toBeGreaterThanOrEqual(28);
    expect(screen.getByRole('group', { name: /^Дни / })).toBeInTheDocument();
  });
  it('подпись матча по настоящему виду', async () => {
    const today = new Date();
    const eventDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const ev = (id: string) => ({ event_id: `match:${id}`, event_date: eventDate, event_time: null, event_type: 'match', title: 'Матч', location: null, event_status: 'past', attendance_status: null });
    fake.rpc.parent_calendar = () => [ev('f1'), ev('c1'), ev('k1')];
    fake.rpc.match_tournaments = () => [
      { match_id: 'f1', tournament_id: null, tournament_name: null, tournament_kind: null, match_kind: 'friendly' },
      { match_id: 'c1', tournament_id: 't1', tournament_name: 'Tbilisi Challenge Cup', tournament_kind: 'championship', match_kind: null },
      { match_id: 'k1', tournament_id: 't2', tournament_name: 'Newton Cup', tournament_kind: 'cup', match_kind: null },
    ];
    render(<ParentCalendar />);
    expect(await screen.findByText('Товарищеский матч')).toBeInTheDocument();
    expect(await screen.findByText('Матч чемпионата')).toBeInTheDocument();
    expect(await screen.findByText('Матч кубка')).toBeInTheDocument();
    expect(screen.queryByText('Футбольный матч')).toBeNull();
  });

  // листаем назад, пока кнопка доступна, и возвращаем заголовок месяца, на котором остановились
  async function earliestMonth() {
    fake.rpc.parent_calendar = () => [];
    render(<ParentCalendar />);
    await screen.findByText('Календарь ребёнка');
    await new Promise(r => setTimeout(r, 50)); // дать загрузиться первой отметке
    const prev = screen.getByRole('button', { name: 'Предыдущий месяц' });
    for (let i = 0; i < 24 && !(prev as HTMLButtonElement).disabled; i++) fireEvent.click(prev);
    return screen.getAllByRole('heading', { level: 2 })[0].textContent?.toLowerCase();
  }

  it('назад листается до месяца первой отметки ребёнка', async () => {
    fake.rpc.parent_first_attendance = () => '2026-08-20';
    expect(await earliestMonth()).toContain('август');
  });

  it('без отметок календарь начинается с сентября', async () => {
    fake.rpc.parent_first_attendance = () => null;
    expect(await earliestMonth()).toContain('сентябрь');
  });
  it('у матча показывает время начала из самого матча (Тбилиси)', async () => {
    const today = new Date();
    const eventDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    fake.db.matches = [{ id: 'm1', starts_at: `${eventDate}T14:30:00+04:00` }];
    fake.rpc.parent_calendar = () => [{
      event_id: 'match:m1', event_date: eventDate, event_time: null, event_type: 'match',
      title: 'Матч с Динамо', location: null, event_status: 'upcoming', attendance_status: null,
    }];
    render(<ParentCalendar />);
    expect(await screen.findByText('14:30')).toBeInTheDocument();
  });

  describe('маркеры событий: контраст и доступность (#734)', () => {
    const today = new Date();
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const ev = (id: string, type: 'match' | 'training') => ({ event_id: `${type}:${id}`, event_date: key, event_time: null, event_type: type, title: `Событие ${id}`, location: null, event_status: 'upcoming', attendance_status: null });
    const dateLabel = today.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    const dayName = () => new RegExp(`^${dateLabel.replace(/\./g, '\\.')}`);
    const day = async () => {
      render(<ParentCalendar />);
      return await screen.findByRole('button', { name: dayName() });
    };
    const suffix = (name: string) => name.replace(dayName(), '');

    it('имя дня сообщает типы: матч и тренировка', async () => {
      fake.rpc.parent_calendar = () => [ev('t1', 'training'), ev('m1', 'match')];
      expect(suffix((await day()).getAttribute('aria-label')!)).toBe(', 1 матч, 1 тренировка');
    });

    it.each([
      [[1, 0], ', 1 матч'],
      [[2, 0], ', 2 матча'],
      [[5, 0], ', 5 матчей'],
      [[0, 1], ', 1 тренировка'],
      [[0, 3], ', 3 тренировки'],
      [[0, 11], ', 11 тренировок'],
      [[21, 22], ', 21 матч, 22 тренировки'],
    ] as [number[], string][])('склонение %j: «%s»', async ([m, t], expected) => {
      fake.rpc.parent_calendar = () => [...Array.from({ length: m }, (_, i) => ev(`m${i}`, 'match')), ...Array.from({ length: t }, (_, i) => ev(`t${i}`, 'training'))];
      expect(suffix((await day()).getAttribute('aria-label')!)).toBe(expected);
    });

    it('день без событий: только дата, без «событий:»', async () => {
      fake.rpc.parent_calendar = () => [];
      const name = (await day()).getAttribute('aria-label')!;
      expect(suffix(name)).toBe('');
      expect(name).not.toMatch(/событий:/);
    });

    it('один маркер на тип, форма разная, цвета из токенов, в ячейке скрыты от AT', async () => {
      fake.rpc.parent_calendar = () => [ev('m1', 'match'), ev('m2', 'match'), ev('m3', 'match'), ev('m4', 'match'), ev('t1', 'training')];
      const cell = await day();
      const marks = cell.querySelectorAll<HTMLElement>('[data-marker]');
      expect([...marks].map(m => m.dataset.marker)).toEqual(['match', 'training']); // 4 матча и тренировка: оба типа видны
      const [match, training] = [...marks];
      expect(match.style.background).toBe('var(--ks-primary)');
      expect(training.style.background).toBe('var(--ks-success)');
      expect(match.style.transform).toContain('rotate(45deg)'); // ромб
      expect(training.style.borderRadius).toBe('50%'); // круг
      expect(cell.querySelector('[data-marker]')!.closest('[aria-hidden="true"]')).not.toBeNull();
      expect(cell.innerHTML).not.toMatch(/#2d6cdf|#23845a/i);
    });

    it('легенда: те же маркеры и подписи, без эмодзи', async () => {
      fake.rpc.parent_calendar = () => [];
      await day();
      const legend = screen.getByText('Матчи').parentElement!;
      expect(legend.textContent).toBe('МатчиТренировки');
      expect(legend.querySelector('[data-marker="match"]')).not.toBeNull();
      expect(legend.querySelector('[data-marker="training"]')).not.toBeNull();
      expect(document.body.textContent).not.toMatch(/🔵|🟢/);
    });

    it('контраст маркеров ≥ 3:1 на выбранном и невыбранном дне в обеих темах (по tokens.css)', () => {
      const lum = (hex: string) => {
        const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const ratio = (a: string, b: string) => {
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };
      const light = tokens.slice(tokens.indexOf(':root {'), tokens.indexOf('@media'));
      const dark = tokens.slice(tokens.indexOf(":root[data-theme='dark']"));
      const val = (block: string, name: string) => block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))![1];
      for (const [theme, block] of [['светлая', light], ['тёмная', dark]] as const) {
        for (const marker of ['--ks-primary', '--ks-success']) {
          for (const bg of ['--ks-primary-subtle', '--ks-surface']) {
            expect(ratio(val(block, marker), val(block, bg)), `${theme} ${marker} на ${bg}`).toBeGreaterThanOrEqual(3);
          }
        }
      }
    });
  });
});
