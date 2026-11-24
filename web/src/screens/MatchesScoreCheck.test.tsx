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

describe('«Матчи» родителя: проверка счёта матчей с подтверждением (#770, #804)', () => {
  it('первая загрузка: пока score-query удерживается, прошедший матч не получает статус «результат не внесён»', async () => {
    seed({ scored: true });
    const gate = fake.hold('matches');
    render(<Matches />);
    await waitFor(() => expect(fake.holds.matches).toHaveLength(0));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_my_matches')).toHaveLength(1));
    expect(screen.queryByText(STALE)).toBeNull();
    gate.release();
    expect(await screen.findByText('Победа')).toBeInTheDocument();
    expect(screen.queryByText(STALE)).toBeNull();
  });

  it('RSVP загружен, score-query удерживается: прошедшие карточки скрыты, предстоящая и отменённая остаются', async () => {
    seed({ scored: false });
    const when = new Date(Date.now() - 3 * day).toLocaleDateString('en-CA');
    const upcoming = row({ match_id: 'r3', opponent: 'Будущий', starts_at: new Date(Date.now() + 5 * day).toISOString(), response: null, can_answer: true });
    const cancelled = row({ match_id: 'r4', opponent: 'Отменён', lifecycle_status: 'cancelled' });
    let rows = [row(), upcoming, cancelled];
    fake.rpc.match_rsvp_my_matches = () => rows;
    fake.db.matches.push(
      { id: 'r3', team: 'U9', played_on: when, opponent: 'Будущий', goals_for: null, goals_against: null },
      { id: 'r4', team: 'U9', played_on: when, opponent: 'Отменён', goals_for: null, goals_against: null },
    );
    render(<Matches />);
    expect(await screen.findByText(STALE)).toBeInTheDocument();
    expect(screen.getByLabelText('Матч Будущий')).toBeInTheDocument();
    expect(screen.getByLabelText('Матч Отменён')).toBeInTheDocument();

    // новая прошедшая RSVP-карточка уже со счётом; ответ на предстоящий матч запускает перезагрузку, score-query зависает
    fake.db.matches.push({ id: 'r2', team: 'U9', played_on: when, opponent: 'Динамо', goals_for: 3, goals_against: 0 });
    rows = [row(), row({ match_id: 'r2', opponent: 'Динамо' }), upcoming, cancelled];
    const gate = fake.hold('matches');
    fireEvent.click(screen.getByRole('button', { name: 'Иванов Пётр: Будет' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_my_matches')).toHaveLength(2));
    await waitFor(() => expect(fake.holds.matches).toHaveLength(0));
    await new Promise(r => setTimeout(r, 20));

    expect(screen.queryByLabelText('Матч Динамо')).toBeNull();
    expect(screen.queryByLabelText('Матч Олимп')).toBeNull();
    expect(screen.queryByText(STALE)).toBeNull();
    expect(screen.queryByText(ALERT)).toBeNull();
    expect(screen.getByLabelText('Матч Будущий')).toBeInTheDocument();
    expect(screen.getByLabelText('Матч Отменён')).toBeInTheDocument();

    gate.release();
    expect(await screen.findByText('Победа')).toBeInTheDocument();
    expect(await screen.findByLabelText('Матч Олимп')).toBeInTheDocument();
    expect(screen.getByText(STALE)).toBeInTheDocument();
    expect(screen.queryByLabelText('Матч Динамо')).toBeNull();
  });

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

  it('отклонённый запрос счёта (сбой сети): ложного статуса нет, есть сообщение, повтор работает', async () => {
    seed({ scored: true });
    fake.rejectsNext.matches = 'network down secret';
    render(<Matches />);
    expect(await screen.findByText(ALERT)).toBeInTheDocument();
    expect(screen.queryByText(STALE)).toBeNull();
    expect(screen.queryByText(/network down|secret/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.queryByText(ALERT)).toBeNull());
    expect(await screen.findByText('Победа')).toBeInTheDocument();
    expect(screen.queryByText(STALE)).toBeNull();
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
