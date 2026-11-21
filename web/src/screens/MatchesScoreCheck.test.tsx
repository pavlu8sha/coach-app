import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import Matches from './Matches';

// Issue #770: ошибка проверки счёта матчей с подтверждением не должна выдаваться за «счёта нет».
window.scrollTo = (() => {}) as typeof window.scrollTo;
const day = 86400000;
const row = (o: Record<string, unknown> = {}) => ({
  match_id: 'r1', lifecycle_status: 'published', kind: 'friendly', team: 'U9', opponent: 'Олимп', starts_at: new Date(Date.now() - 3 * day).toISOString(), venue: 'Стадион', address: null, notes: null,
  rescheduled: false, player_id: 'p1', player_name: 'Иванов Пётр', response: 'yes', responded_by_name: null, responded_at: null, answer_until: null, can_answer: false, ...o,
});
const STALE = 'Прошёл, результат не внесён';
const ALERT = 'Не удалось проверить результаты матчей';

function seed(opts: { scored: boolean; extra?: unknown[] }) {
  fake.user = { id: 'u1' } as any;
  fake.db.player_guardians = [{ user_id: 'u1', consent_revoked_at: null, players: { id: 'p1', full_name: 'Иванов Пётр', groups: { name: 'U9' } } }];
  fake.db.match_players = [];
  const when = new Date(Date.now() - 3 * day).toLocaleDateString('en-CA');
  fake.db.matches = [{ id: 'r1', team: 'U9', played_on: when, opponent: 'Олимп', goals_for: opts.scored ? 2 : null, goals_against: opts.scored ? 1 : null }];
  fake.rpc.match_tournaments = () => [];
  fake.rpc.my_tournaments = () => [];
  fake.rpc.match_rsvp_my_matches = () => [row(), ...(opts.extra ?? [])];
}

describe('«Матчи» родителя: проверка счёта матчей с подтверждением (#770)', () => {
  it('матч со счётом и ошибка проверки: ложного статуса «результат не внесён» нет, есть сообщение и повтор', async () => {
    seed({ scored: true });
    fake.errorsNext.matches = 'boom: secret technical text';
    render(<Matches />);
    expect(await screen.findByText(ALERT)).toBeInTheDocument();
    expect(screen.queryByText(STALE)).toBeNull();
    expect(screen.queryByText(/boom|secret/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeEnabled();
    expect(screen.queryByText('Нет результатов')).toBeNull();
  });

  it('матч без счёта и успешный запрос: прежнее поведение, сообщения нет', async () => {
    seed({ scored: false });
    render(<Matches />);
    expect(await screen.findByText(STALE)).toBeInTheDocument();
    expect(screen.queryByText(ALERT)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('повтор: пока идёт загрузка, кнопка отключена; после успеха счёт исключает матч из подтверждений', async () => {
    seed({ scored: true });
    fake.errorsNext.matches = 'boom';
    render(<Matches />);
    fireEvent.click(await screen.findByRole('button', { name: 'Повторить' }));
    // повторная проверка ещё идёт: ложного статуса нет, кнопка занята
    expect(screen.queryByText(STALE)).toBeNull();
    await waitFor(() => expect(screen.queryByText(ALERT)).toBeNull());
    expect(screen.queryByText(STALE)).toBeNull();
    expect(await screen.findByText('Победа')).toBeInTheDocument();
  });

  it('пока повтор выполняется, кнопка «Загружаю…» отключена', async () => {
    seed({ scored: true });
    fake.errorsNext.matches = 'boom';
    render(<Matches />);
    const retry = await screen.findByRole('button', { name: 'Повторить' });
    const gate = fake.hold('matches');
    fireEvent.click(retry);
    const busy = await screen.findByRole('button', { name: 'Загружаю…' });
    expect(busy).toBeDisabled();
    expect(screen.queryByText(STALE)).toBeNull();
    gate.release();
    expect(await screen.findByText('Победа')).toBeInTheDocument();
  });

  it('устаревший ответ не перезаписывает результат более новой загрузки', async () => {
    seed({ scored: true, extra: [row({ match_id: 'r2', opponent: 'Динамо', starts_at: new Date(Date.now() + 5 * day).toISOString(), can_answer: true, response: null })] });
    render(<Matches />);
    const yes = await screen.findByRole('button', { name: 'Иванов Пётр: Будет' });
    expect(await screen.findByText('Победа')).toBeInTheDocument();
    // загрузка B (после первого ответа) зависает на проверке счёта; загрузка C (после второго) завершается успешно
    const gate = fake.hold('matches');
    fireEvent.click(yes);
    await waitFor(() => expect(fake.holds.matches).toHaveLength(0));
    fireEvent.click(screen.getByRole('button', { name: 'Иванов Пётр: Не будет' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_answer')).toHaveLength(2));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_my_matches').length).toBeGreaterThanOrEqual(3));
    // старая загрузка B отвечает ошибкой позже новой: её ответ не применяется
    gate.release({ error: { message: 'late boom' } });
    await new Promise(r => setTimeout(r, 50));
    expect(screen.queryByText(ALERT)).toBeNull();
    expect(screen.queryByText(STALE)).toBeNull();
    expect(screen.getByText('Победа')).toBeInTheDocument();
  });
});
