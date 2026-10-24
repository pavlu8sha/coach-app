import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import Leads from './Leads';

const lead = (id: string, name: string, status: string, extra = {}) => ({
  id, full_name: name, phone: '+995 555 12 34 56', parent_name: 'Анна', username: 'anna', birth_year: 2017, status, note: null, created_at: '2026-10-20T10:00:00Z', source: 'bot', ...extra,
});

describe('«Заявки»', () => {
  it('«В работе» скрывает вступивших и отказавшихся; «Все» показывает всех', async () => {
    fake.db.trials = [lead('a', 'Иван Петров', 'new'), lead('b', 'Вступил Ребёнок', 'joined'), lead('c', 'Отказ Ребёнок', 'declined')];
    render(<Leads />);
    expect(await screen.findByText('Иван Петров, 2017 г.р.')).toBeInTheDocument();
    expect(screen.queryByText(/Вступил/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Все' }));
    expect(screen.getByText(/Вступил Ребёнок/)).toBeInTheDocument();
    expect(screen.getByText(/Отказ Ребёнок/)).toBeInTheDocument();
  });

  it('ссылки на Telegram и телефон безопасно собраны из данных', async () => {
    fake.db.trials = [lead('a', 'Иван Петров', 'new', { username: 'a b"><x', phone: '+995 (555) 12-34-56' })];
    render(<Leads />);
    await screen.findByText('Иван Петров, 2017 г.р.');
    const tg = screen.getByText(/@a b/).closest('a') as HTMLAnchorElement;
    expect(tg.getAttribute('href')).toBe('https://t.me/a%20b%22%3E%3Cx');
    expect((screen.getByText('+995 (555) 12-34-56') as HTMLAnchorElement).getAttribute('href')).toBe('tel:+995555123456');
    expect(document.querySelector('x')).toBeNull();
  });

  it('смена статуса уходит в lead_set_status вместе с заметкой', async () => {
    fake.db.trials = [lead('a', 'Иван Петров', 'new')];
    fake.rpc.lead_set_status = () => null;
    render(<Leads />);
    const card = (await screen.findByText('Иван Петров, 2017 г.р.')).closest('.ks-card') as HTMLElement;
    fireEvent.change(within(card).getByLabelText('Заметка'), { target: { value: 'Позвонили' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Связались' }));
    await waitFor(() => expect(fake.rpcCalls('lead_set_status')).toEqual([{ i: 'a', st: 'contacted', nt: 'Позвонили' }]));
  });

  it('пока миграция не применена, экран объясняет причину', async () => {
    fake.errors.trials = 'column trials.birth_year does not exist';
    render(<Leads />);
    expect(await screen.findByText(/миграция 0039/)).toBeInTheDocument();
  });
});
