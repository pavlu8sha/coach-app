import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import Home from './Home';

const kid = (id: string, name: string, group: string | null) => ({ player_id: id, user_id: 'u', consent_revoked_at: null, players: { id, full_name: name, groups: group ? { name: group } : null } });
const ev = (player_id: string, points: number, explanation: string, day: number) => ({ player_id, points, explanation, occurred_on: `2026-10-${String(day).padStart(2, '0')}` });

describe('главная родителя', () => {
  it('карточка ребёнка: баллы, история со знаками, свои матчи и голы; без рейтингов', async () => {
    fake.db.player_guardians = [kid('p1', 'Алексей Петров', 'U10-A')];
    fake.db.point_events = [ev('p1', 2, 'Победа', 3), ev('p1', 1, 'Тренировка', 2), ev('p1', -1, 'Пропуск', 1)];
    fake.db.match_players = [{ player_id: 'p1', played: true, goals: 2 }, { player_id: 'p1', played: true, goals: 1 }, { player_id: 'p1', played: false, goals: 0 }];
    render(<Home />);
    expect(await screen.findByText('Алексей Петров')).toBeInTheDocument();
    expect(screen.getByText('U10-A')).toBeInTheDocument();
    expect(screen.getByLabelText('2 балла')).toBeInTheDocument();
    expect(screen.getByText('История начислений')).toBeInTheDocument();
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.getByText('−1')).toBeInTheDocument();
    expect(screen.getByText('Матчей сыграно: 2 · голов: 3')).toBeInTheDocument();
  });

  it('длинная история сворачивается и раскрывается', async () => {
    fake.db.player_guardians = [kid('p1', 'Алексей Петров', null)];
    fake.db.point_events = Array.from({ length: 8 }, (_, i) => ev('p1', 1, `Событие ${i + 1}`, i + 1));
    render(<Home />);
    await screen.findByText('Алексей Петров');
    expect(screen.getAllByText(/^Событие/)).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё (3)' }));
    expect(screen.getAllByText(/^Событие/)).toHaveLength(8);
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть' }));
    expect(screen.getAllByText(/^Событие/)).toHaveLength(5);
  });

  it('нет баллов: пустое состояние в карточке', async () => {
    fake.db.player_guardians = [kid('p1', 'Алексей Петров', 'U10-A')];
    render(<Home />);
    expect(await screen.findByText('Баллов пока нет')).toBeInTheDocument();
    expect(screen.getByLabelText('0 баллов')).toBeInTheDocument();
  });

  it('несколько детей: заголовок во множественном числе, у каждого свои баллы', async () => {
    fake.db.player_guardians = [kid('p1', 'Алексей Петров', null), kid('p2', 'Мария Петрова', null)];
    fake.db.point_events = [ev('p1', 2, 'Победа', 3), ev('p2', 1, 'Тренировка', 2)];
    render(<Home />);
    expect(await screen.findByRole('heading', { name: 'Мои дети' })).toBeInTheDocument();
    expect(screen.getByLabelText('2 балла')).toBeInTheDocument();
    expect(screen.getByLabelText('1 балл')).toBeInTheDocument();
  });

  it('нет детей, запрос ждёт подтверждения: поясняет и ведёт к статусу', async () => {
    fake.db.link_requests = [{ id: 'r1', user_id: 'u', status: 'pending', players: { full_name: 'Алексей Петров' } }];
    render(<Home />);
    expect(await screen.findByText(/Запрос отправлен/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /Статус запросов/ }));
    expect(await screen.findByText('Статус привязки')).toBeInTheDocument();
  });

  it('нет детей и запросов: форма поиска', async () => {
    render(<Home />);
    expect(await screen.findByText('Добавить ребёнка')).toBeInTheDocument();
  });

  it('ошибка загрузки: «Повторить»', async () => {
    fake.errors.player_guardians = 'нет связи';
    render(<Home />);
    expect(await screen.findByText('нет связи')).toBeInTheDocument();
    delete fake.errors.player_guardians;
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.getByText('Добавить ребёнка')).toBeInTheDocument());
  });
});
