import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fake, supabase } from '../test/fakeSupabase';
import CoachRsvp from './CoachRsvp';

// Условия приёмки: docs/acceptance/coach-rsvp-load-errors-768-769-2026-11-20.md
window.scrollTo = (() => {}) as typeof window.scrollTo;
const future = new Date(Date.now() + 5 * 86400000).toISOString();
const groups = [{ id: 'g1', name: 'U9' }] as any;
const matchRow = (o: Record<string, unknown> = {}) => ({ id: 'm1', team: 'U9', opponent: 'Олимп', starts_at: future, lifecycle_status: 'published', kind: 'friendly', venue: 'Стадион', address: null, notes: null, tournament_id: null, ...o });
const player = (id: string, name: string, o: Record<string, unknown> = {}) => ({ player_id: id, full_name: name, group_name: 'U9', status: 'invited', response: null, responded_by_name: null, responded_by_coach: false, responded_at: null, answer_until: future, ...o });
const SUMMARY = { invited: 2, yes: 1, no: 0, unanswered: 1, reminders: 0, last_reminder_at: null };
const SECRET = 'boom: secret technical text';
const failing = () => ({ error: { message: SECRET } });
const rejecting = () => Promise.reject(new Error(SECRET));

function seed(o: { summary?: () => unknown; roster?: () => unknown; match?: Record<string, unknown> } = {}) {
  fake.db.matches = [matchRow(o.match)];
  fake.rpc.match_rsvp_summary = o.summary ?? (() => [SUMMARY]);
  fake.rpc.match_rsvp_roster = o.roster ?? (() => [player('p1', 'Иванов Пётр', { response: 'yes' }), player('p2', 'Сидоров Иван')]);
}
const open = async (title = 'U9 · Олимп') => {
  const view = render(<CoachRsvp groups={groups} onBack={() => {}} />);
  fireEvent.click(await screen.findByText(title));
  return view;
};
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const noSecret = () => expect(document.body).not.toHaveTextContent('secret technical text');

describe('Карточка матча тренера: ошибки загрузки (#768)', () => {
  it('успех: сводка и состав показываются, ошибок нет', async () => {
    seed();
    await open();
    expect(within(await screen.findByLabelText('Сводка ответов')).getByText(/Приглашено: 2/)).toBeInTheDocument();
    expect(await screen.findByText('Иванов Пётр')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ошибка состава: не «Состав пока пуст», есть ошибка и «Повторить», сводка не заблокирована, публикации нет', async () => {
    seed({ roster: failing, match: { lifecycle_status: 'draft' } });
    await open();
    expect(await screen.findByText('Не удалось загрузить состав')).toBeInTheDocument();
    expect(screen.queryByText('Состав пока пуст.')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Фильтр по ответам' })).toBeNull();
    expect(screen.getByLabelText('Сводка ответов')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Опубликовать' })).toBeDisabled();
    noSecret();
  });

  it('ошибка сводки: нет карточки с нулями и кнопки напоминания, состав и история не затронуты', async () => {
    seed({ summary: failing });
    await open();
    expect(await screen.findByText('Не удалось загрузить сводку ответов')).toBeInTheDocument();
    expect(screen.queryByLabelText('Сводка ответов')).toBeNull();
    expect(await screen.findByText('Иванов Пётр')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Напомнить не ответившим' })).toBeDisabled();
    expect(screen.queryByText('Состав пока пуст.')).toBeNull();
    noSecret();
  });

  it('ошибка истории: не «Записей пока нет», есть «Повторить», остальные блоки на месте', async () => {
    seed();
    fake.errors.match_activity = SECRET;
    await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Показать историю действий' }));
    expect(await screen.findByText('Не удалось загрузить историю')).toBeInTheDocument();
    expect(screen.queryByText('Записей пока нет.')).toBeNull();
    expect(screen.getByText('Иванов Пётр')).toBeInTheDocument();
    expect(screen.getByLabelText('Сводка ответов')).toBeInTheDocument();
    noSecret();
  });

  it('успешный пустой состав и пустая история: пустые состояния без ошибки', async () => {
    seed({ roster: () => [], summary: () => [] });
    fake.db.match_activity = [];
    await open();
    expect(await screen.findByText('Состав пока пуст.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Показать историю действий' }));
    expect(await screen.findByText('Записей пока нет.')).toBeInTheDocument();
    expect(screen.queryByText(/Не удалось загрузить/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull();
  });

  it('отклонённый Promise состава и сводки: ошибка, а не пустой состав', async () => {
    seed({ roster: rejecting, summary: rejecting });
    await open();
    expect(await screen.findByText('Не удалось загрузить состав')).toBeInTheDocument();
    expect(screen.getByText('Не удалось загрузить сводку ответов')).toBeInTheDocument();
    expect(screen.queryByText('Состав пока пуст.')).toBeNull();
    noSecret();
  });

  it('отклонённый Promise истории (сбой сети): ошибка, а не «Записей пока нет»', async () => {
    seed();
    fake.rejects.match_activity = SECRET;
    await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Показать историю действий' }));
    expect(await screen.findByText('Не удалось загрузить историю')).toBeInTheDocument();
    expect(screen.queryByText('Записей пока нет.')).toBeNull();
    noSecret();
  });

  it('повтор состава после ошибки: второй вызов, данные показаны, ошибка ушла, сводку не перезапрашивали', async () => {
    let fail = true;
    seed({ roster: () => (fail ? failing() : [player('p1', 'Иванов Пётр')]) });
    await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Повторить' }));
    fail = false;
    expect(await screen.findByText('Иванов Пётр')).toBeInTheDocument();
    expect(screen.queryByText('Не удалось загрузить состав')).toBeNull();
    expect(fake.rpcCalls('match_rsvp_roster')).toHaveLength(2);
    expect(fake.rpcCalls('match_rsvp_summary')).toHaveLength(1);
  });

  it('повтор сводки после ошибки и повтор истории после ошибки восстанавливают данные', async () => {
    let fail = true;
    seed({ summary: () => (fail ? rejecting() : [SUMMARY]) });
    fake.errors.match_activity = SECRET;
    await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Показать историю действий' }));
    await screen.findByText('Не удалось загрузить историю');
    fail = true;
    const retries = await screen.findAllByRole('button', { name: 'Повторить' });
    expect(retries).toHaveLength(2);
    fail = false;
    delete fake.errors.match_activity;
    fake.db.match_activity = [{ id: 1, match_id: 'm1', action: 'published', created_at: future }];
    for (const b of retries) fireEvent.click(b);
    expect(await screen.findByLabelText('Сводка ответов')).toBeInTheDocument();
    expect(await screen.findByText(/Матч опубликован/)).toBeInTheDocument();
    expect(screen.queryByText(/Не удалось загрузить/)).toBeNull();
  });

  it('устаревший ответ при повторной загрузке не перезаписывает актуальный', async () => {
    const first = deferred<unknown>();
    let n = 0;
    seed({ roster: () => (++n === 1 ? first.promise : [player('p2', 'Сидоров Иван')]) });
    await open();
    // тренер делает действие, экран перезагружается; ответ первой загрузки приходит последним
    fake.rpc.match_rsvp_remind_unanswered = () => [{ queued: 1, skipped: 0 }];
    fireEvent.click(await screen.findByRole('button', { name: 'Напомнить не ответившим' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Напомнить' }));
    expect(await screen.findByText('Сидоров Иван')).toBeInTheDocument();
    first.resolve([player('p1', 'Иванов Пётр')]);
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByText('Иванов Пётр')).toBeNull();
    expect(screen.getByText('Сидоров Иван')).toBeInTheDocument();
  });

  it('устаревшая ошибка не перекрывает актуальные данные', async () => {
    const first = deferred<unknown>();
    let n = 0;
    seed({ roster: () => (++n === 1 ? first.promise : [player('p2', 'Сидоров Иван')]) });
    await open();
    fake.rpc.match_rsvp_remind_unanswered = () => [{ queued: 1, skipped: 0 }];
    fireEvent.click(await screen.findByRole('button', { name: 'Напомнить не ответившим' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Напомнить' }));
    expect(await screen.findByText('Сидоров Иван')).toBeInTheDocument();
    first.reject(new Error(SECRET));
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByText('Не удалось загрузить состав')).toBeNull();
    expect(screen.getByText('Сидоров Иван')).toBeInTheDocument();
  });

  it('смена матча: поздний ответ первого матча не попадает в карточку второго', async () => {
    const slow = deferred<unknown>();
    fake.db.matches = [matchRow({ id: 'm1', opponent: 'Олимп' }), matchRow({ id: 'm2', opponent: 'Динамо', starts_at: new Date(Date.now() + 6 * 86400000).toISOString() })];
    fake.rpc.match_rsvp_summary = () => [SUMMARY];
    fake.rpc.match_rsvp_roster = (a: { m: string }) => (a.m === 'm1' ? slow.promise : [player('p2', 'Сидоров Иван')]);
    render(<CoachRsvp groups={groups} onBack={() => {}} />);
    fireEvent.click(await screen.findByText('U9 · Олимп'));
    fireEvent.click(await screen.findByRole('button', { name: /Назад/ }));
    fireEvent.click(await screen.findByText('U9 · Динамо'));
    expect(await screen.findByText('Сидоров Иван')).toBeInTheDocument();
    slow.resolve([player('p1', 'Иванов Пётр')]);
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByText('Иванов Пётр')).toBeNull();
  });

  it('обновление после действия не показывает старый состав, если новая загрузка не удалась', async () => {
    let fail = false;
    seed({ roster: () => (fail ? failing() : [player('p1', 'Иванов Пётр'), player('p2', 'Сидоров Иван')]) });
    fake.rpc.match_rsvp_coach_set = () => null;
    await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Сидоров Иван: Не будет' }));
    fail = true;
    expect(await screen.findByText('Не удалось загрузить состав')).toBeInTheDocument();
    expect(screen.queryByText('Сидоров Иван')).toBeNull();
    expect(screen.queryByText('Состав пока пуст.')).toBeNull();
  });
});

describe('Поиск игроков в составе: ошибки и гонки (#769)', () => {
  /** Запросы поиска по players: каждый ждёт, пока тест его завершит. */
  function manualSearch() {
    const reqs: { pattern: string; resolve: (rows: { id: string; full_name: string }[]) => void; reject: (e: unknown) => void }[] = [];
    const orig = supabase.from;
    vi.spyOn(supabase, 'from').mockImplementation(((t: string) => {
      if (t !== 'players') return orig(t);
      const d = deferred<{ data: unknown; error: unknown }>();
      const req = { pattern: '', resolve: (rows: { id: string; full_name: string }[]) => d.resolve({ data: rows, error: null }), reject: d.reject };
      reqs.push(req);
      const chain: any = { select: () => chain, order: () => chain, limit: () => chain, ilike: (_c: string, p: string) => ((req.pattern = p), chain), then: (a: any, b: any) => d.promise.then(a, b) };
      return chain;
    }) as any);
    return reqs;
  }
  const type = async (text: string) => {
    fireEvent.change(await screen.findByLabelText('Добавить игрока в состав'), { target: { value: text } });
  };
  const openDraft = async () => {
    seed({ match: { lifecycle_status: 'draft' }, roster: () => [player('p1', 'Иванов Пётр')] });
    await open();
    await screen.findByText('Иванов Пётр');
  };

  it('успех: найденные показываются с кнопкой «Добавить»', async () => {
    fake.db.players = [{ id: 'p5', full_name: 'Петров Олег' }];
    await openDraft();
    await type('Петр');
    expect(await screen.findByText('Петров Олег')).toBeInTheDocument();
    expect(screen.queryByText('Не удалось выполнить поиск')).toBeNull();
  });

  it('успешный пустой результат: «Никого не найдено», без ошибки', async () => {
    fake.db.players = [];
    await openDraft();
    await type('Петр');
    expect(await screen.findByText('Никого не найдено')).toBeInTheDocument();
    expect(screen.queryByText('Не удалось выполнить поиск')).toBeNull();
  });

  it('ошибка поиска: ошибка и «Повторить поиск», а не «Никого не найдено»', async () => {
    fake.errors.players = SECRET;
    await openDraft();
    await type('Петр');
    expect(await screen.findByText('Не удалось выполнить поиск')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить поиск' })).toBeInTheDocument();
    expect(screen.queryByText('Никого не найдено')).toBeNull();
    noSecret();
  });

  it('отклонённый Promise поиска: ошибка, а не «Никого не найдено»', async () => {
    fake.rejects.players = SECRET;
    await openDraft();
    await type('Петр');
    expect(await screen.findByText('Не удалось выполнить поиск')).toBeInTheDocument();
    expect(screen.queryByText('Никого не найдено')).toBeNull();
    noSecret();
  });

  it('повтор поиска после ошибки показывает результаты', async () => {
    fake.errors.players = SECRET;
    fake.db.players = [{ id: 'p5', full_name: 'Петров Олег' }];
    await openDraft();
    await type('Петр');
    fireEvent.click(await screen.findByRole('button', { name: 'Повторить поиск' }));
    delete fake.errors.players;
    expect(await screen.findByText('Петров Олег')).toBeInTheDocument();
    expect(screen.queryByText('Не удалось выполнить поиск')).toBeNull();
  });

  it('новый запрос: результаты прежнего не выдаются за актуальные («Поиск…»)', async () => {
    fake.db.players = [{ id: 'p5', full_name: 'Петров Олег' }, { id: 'p6', full_name: 'Сидорчук Илья' }];
    await openDraft();
    await type('Петр');
    expect(await screen.findByText('Петров Олег')).toBeInTheDocument();
    const reqs = manualSearch();
    await type('Сидор');
    expect(screen.queryByText('Петров Олег')).toBeNull();
    expect(await screen.findByText('Поиск…')).toBeInTheDocument();
    await waitFor(() => expect(reqs).toHaveLength(1));
    reqs[0].resolve([{ id: 'p6', full_name: 'Сидорчук Илья' }]);
    expect(await screen.findByText('Сидорчук Илья')).toBeInTheDocument();
  });

  it('ошибка нового запроса: результаты прежнего запроса не остаются на экране', async () => {
    fake.db.players = [{ id: 'p5', full_name: 'Петров Олег' }];
    await openDraft();
    await type('Петр');
    expect(await screen.findByText('Петров Олег')).toBeInTheDocument();
    fake.errors.players = SECRET;
    await type('Петро');
    expect(await screen.findByText('Не удалось выполнить поиск')).toBeInTheDocument();
    expect(screen.queryByText('Петров Олег')).toBeNull();
    expect(screen.queryByText('Никого не найдено')).toBeNull();
  });

  it('ответы в обратном порядке: показаны результаты только последнего запроса', async () => {
    await openDraft();
    const reqs = manualSearch();
    await type('Пет');
    await waitFor(() => expect(reqs).toHaveLength(1));
    await type('Петр');
    await waitFor(() => expect(reqs).toHaveLength(2));
    expect(reqs.map(r => r.pattern)).toEqual(['%Пет%', '%Петр%']);
    // сначала отвечает новый запрос, потом запоздавший старый
    reqs[1].resolve([{ id: 'p5', full_name: 'Петров Олег' }]);
    expect(await screen.findByText('Петров Олег')).toBeInTheDocument();
    reqs[0].resolve([{ id: 'p7', full_name: 'Петухов Иван' }]);
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByText('Петухов Иван')).toBeNull();
    expect(screen.getByText('Петров Олег')).toBeInTheDocument();
  });

  it('запоздавшая ошибка старого запроса не затирает результаты нового', async () => {
    await openDraft();
    const reqs = manualSearch();
    await type('Пет');
    await waitFor(() => expect(reqs).toHaveLength(1));
    await type('Петр');
    await waitFor(() => expect(reqs).toHaveLength(2));
    reqs[1].resolve([{ id: 'p5', full_name: 'Петров Олег' }]);
    expect(await screen.findByText('Петров Олег')).toBeInTheDocument();
    reqs[0].reject(new Error(SECRET));
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByText('Не удалось выполнить поиск')).toBeNull();
    expect(screen.getByText('Петров Олег')).toBeInTheDocument();
  });

  it('короче двух символов: запрос не уходит, результатов и ошибки нет', async () => {
    fake.db.players = [{ id: 'p5', full_name: 'Петров Олег' }];
    await openDraft();
    await type('П');
    await new Promise(r => setTimeout(r, 350));
    expect(screen.queryByText('Петров Олег')).toBeNull();
    expect(screen.queryByText('Никого не найдено')).toBeNull();
    expect(screen.queryByText('Поиск…')).toBeNull();
  });
});
