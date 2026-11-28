import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import { errMsg } from '../lib/coach';
import PointsLedger, { loadLedger, pointsAuthEvent, prefetchPoints, resetPointsCache } from './PointsLedger';

const seed = () => {
  fake.db.points_ledger = [
    { id: 'a', player_id: 'p1', status: 'active', event_date: '2026-12-10', points: 6, source_type: 'match', reason_code: 'match', components: { model: 'rating', rating: 5, best: true, best_bonus: 1, before_cap: 6, cap: 6, technical: false } },
    { id: 'b', player_id: 'p1', status: 'active', event_date: '2026-12-03', points: 1, source_type: 'group_session', reason_code: 'attended', components: { class: 'regular' } },
    { id: 'c', player_id: 'p1', status: 'active', event_date: '2026-11-28', points: 2, source_type: 'manual', reason_code: 'manual', components: { note: 'Старание' } },
    { id: 'd', player_id: 'p1', status: 'cancelled', event_date: '2026-12-05', points: 3, source_type: 'manual', reason_code: 'manual', components: { note: 'Ошибка' } },
    { id: 'e', player_id: 'p2', status: 'active', event_date: '2026-12-05', points: 9, source_type: 'extra', reason_code: 'attended', components: {} },
  ];
  fake.rpc.points_series_info = () => ({ current: 4, record: 6, current_from: '2026-12-03', last_break: null, next_threshold: '6', next_bonus: '1', remaining: 2, finished_runs: [{ length: 6, from: '2026-11-01', to: '2026-11-20' }] });
};

describe('баллы по новым правилам', () => {
  it('ориентиры группы: свои баллы, среднее и максимум без имён', async () => {
    seed();
    fake.rpc.points_group_benchmark = () => ({ groups: [{ group_id: 'g1', group_name: 'U9', personal: 6, status: 'ok', avg: 2.3, max: 10, place: 4 }] });
    render(<PointsLedger playerId="p1" />);
    expect(await screen.findByText('Среднее по группе')).toBeInTheDocument();
    expect(screen.getByText('У вас')).toBeInTheDocument();
    expect(screen.getByText('2,3')).toBeInTheDocument();
    expect(screen.getByText('Максимум в группе')).toBeInTheDocument();
    expect(screen.getByText('Место в группе')).toBeInTheDocument();
    expect(fake.rpcCalls('points_group_benchmark')[0]).toEqual({ p: 'p1', ym: '2026-12-01' });
  });

  it('малая группа: недостаточно данных; нет начислений в месяце: нет данных; две группы: разбивка', async () => {
    seed();
    fake.rpc.points_group_benchmark = () => ({ groups: [
      { group_id: 'g1', group_name: 'U9', personal: 4, status: 'insufficient', avg: null, max: null },
      { group_id: 'g2', group_name: 'U11', personal: 2, status: 'ok', avg: 1.5, max: 3 },
    ] });
    render(<PointsLedger playerId="p1" />);
    expect(await screen.findByText(/Недостаточно данных для анонимного сравнения/)).toBeInTheDocument();
    expect(screen.getByText('Ваши баллы по группам')).toBeInTheDocument();
    fake.rpc.points_group_benchmark = () => ({ groups: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    expect(await screen.findByText('Нет данных')).toBeInTheDocument();
  });

  it('без начислений в новом журнале блока нет', async () => {
    fake.db.points_ledger = [];
    const { container } = render(<PointsLedger playerId="p1" />);
    await new Promise(r => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });

  it('последний месяц: итог, всего накоплено, пояснения; отменённых и чужих нет', async () => {
    seed();
    render(<PointsLedger playerId="p1" />);
    expect(await screen.findByText('Декабрь 2026')).toBeInTheDocument();
    expect(screen.getByText(/За месяц:/).textContent).toContain('7');
    expect(screen.getByText(/Всего накоплено: 9/)).toBeInTheDocument();
    expect(screen.getByText('Матч — оценка тренера 5')).toBeInTheDocument();
    expect(screen.getByText(/лучший игрок \+1/)).toBeInTheDocument();
    expect(screen.queryByText(/победа|ничья|поражение|голы/)).toBeNull();
    expect(screen.queryByText(/Ошибка/)).toBeNull();
  });

  it('переключение на прошлый месяц показывает его начисления', async () => {
    seed();
    render(<PointsLedger playerId="p1" />);
    await screen.findByText('Декабрь 2026');
    fireEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    expect(await screen.findByText('Ноябрь 2026')).toBeInTheDocument();
    expect(screen.getByText('От тренера: Старание')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Предыдущий месяц' })).toBeDisabled();
  });

  it('серия: прогресс до бонуса, рекорд и завершённые серии', async () => {
    seed();
    render(<PointsLedger playerId="p1" />);
    expect(await screen.findByText('До бонуса за 6 тренировок (+1)')).toBeInTheDocument();
    expect(screen.getByText('осталось 2')).toBeInTheDocument();
    expect(screen.getByText('Личный рекорд')).toBeInTheDocument();
    expect(screen.getByText('6 подряд', { selector: 'b' })).toBeInTheDocument();
    expect(screen.getAllByText('6 подряд').length).toBeGreaterThan(0);
  });

  it('прерванная серия показана нейтрально, с датой', async () => {
    seed();
    fake.rpc.points_series_info = () => ({ current: 0, record: 6, current_from: null, last_break: '2026-12-12', next_threshold: '6', next_bonus: '1', remaining: 6, finished_runs: [] });
    render(<PointsLedger playerId="p1" />);
    expect(await screen.findByText(/Серия прервана после пропуска тренировки 12\.12\.2026/)).toBeInTheDocument();
  });

  it('ошибка загрузки показана, а не превращается в пустой список; повтор загружает данные', async () => {
    seed();
    fake.errors.points_ledger = 'сбой связи';
    const { container } = render(<PointsLedger playerId="p1" showEmpty />);
    expect(await screen.findByText('Не удалось загрузить баллы')).toBeInTheDocument();
    expect(screen.getByText(errMsg({ message: 'сбой связи' }))).toBeInTheDocument();
    expect(screen.queryByText('Баллов пока нет')).toBeNull();
    expect(container.querySelector('main')).toBeNull();
    delete fake.errors.points_ledger;
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Декабрь 2026')).toBeInTheDocument();
  });

  it('история длиннее 1000 строк читается страницами, итог считается по всем', async () => {
    seed();
    const many = Array.from({ length: 2500 }, (_, i) => ({ id: `x${String(i).padStart(4, '0')}`, player_id: 'p9', status: 'active', event_date: '2026-12-03', points: 1, source_type: 'group_session', reason_code: 'attended', components: { class: 'regular' } }));
    fake.db.points_ledger = [...(fake.db.points_ledger as object[]), ...many];
    fake.db.points_ledger = (fake.db.points_ledger as { player_id: string }[]).map(r => (r.player_id === 'p9' ? { ...r, player_id: 'p1' } : r));
    render(<PointsLedger playerId="p1" />);
    expect(await screen.findByText(/Всего накоплено: 2509/)).toBeInTheDocument();
  });

  it('мигание вкладки: первая загрузка показывает заглушку, повторное открытие сразу показывает сохранённые баллы', async () => {
    seed();
    fake.rpc.points_group_benchmark = () => ({ groups: [] });
    const first = render(<PointsLedger playerId="p1" />);
    expect(screen.getByLabelText('Баллы по новым правилам')).toHaveAttribute('aria-busy', 'true');
    expect(await screen.findByText('Серия посещений')).toBeInTheDocument();
    first.unmount();
    render(<PointsLedger playerId="p1" />);
    // без await: данные уже на экране в первом же кадре, заглушки нет
    expect(screen.getByText('Серия посещений')).toBeInTheDocument();
    expect(screen.getByLabelText('Баллы по новым правилам')).not.toHaveAttribute('aria-busy');
  });

  it('предзагрузка при открытии карточки: вкладка открывается сразу; ошибка предзагрузки не ломает экран', async () => {
    seed();
    fake.rpc.points_group_benchmark = () => ({ groups: [] });
    prefetchPoints('p1');
    await waitFor(() => expect(fake.rpcCalls('points_series_info')).toHaveLength(1));
    render(<PointsLedger playerId="p1" />);
    expect(screen.getByText('Серия посещений')).toBeInTheDocument();
    resetPointsCache();
    fake.errors.points_ledger = 'сбой сети';
    expect(() => prefetchPoints('p1')).not.toThrow();
  });

  it('сохранённые баллы остаются, если фоновое обновление упало; без сохранённых ошибка показывается', async () => {
    seed();
    fake.rpc.points_group_benchmark = () => ({ groups: [] });
    const first = render(<PointsLedger playerId="p1" />);
    await screen.findByText('Серия посещений');
    first.unmount();
    fake.errors.points_ledger = 'сбой сети';
    render(<PointsLedger playerId="p1" />);
    await new Promise(r => setTimeout(r, 30));
    expect(screen.getByText('Серия посещений')).toBeInTheDocument();
    expect(screen.queryByText('Не удалось загрузить баллы')).toBeNull();
    resetPointsCache();
    cleanup();
    render(<PointsLedger playerId="p1" />);
    expect(await screen.findByText('Не удалось загрузить баллы')).toBeInTheDocument();
  });

  it('предзагрузка и вкладка делят один запрос', async () => {
    seed();
    fake.rpc.points_group_benchmark = () => ({ groups: [] });
    prefetchPoints('p1');
    render(<PointsLedger playerId="p1" />);
    await screen.findByText('Серия посещений');
    expect(fake.rpcCalls('points_series_info')).toHaveLength(1);
  });

  it('запоздавший ответ старого запроса не затирает свежие баллы', async () => {
    seed();
    fake.rpc.points_group_benchmark = () => ({ groups: [] });
    const base = { current: 99, record: 99, current_from: null, last_break: null, next_threshold: null, next_bonus: null, remaining: null, finished_runs: [] };
    let n = 0;
    let slow!: (v: unknown) => void;
    fake.rpc.points_series_info = () => (++n === 1 ? new Promise(r => { slow = r; }) : { ...base, current: 4, record: 7 });
    const p1 = loadLedger('p1', true); // зависает со «старым» ответом
    await waitFor(() => expect(n).toBe(1));
    const p2 = loadLedger('p1', true); // свежий
    const fresh = await p2;
    expect(fresh.series?.record).toBe(7);
    slow(base); // запоздавший ответ первого запроса
    await p1;
    render(<PointsLedger playerId="p1" />);
    expect(screen.getByText('7 подряд')).toBeInTheDocument();
    expect(screen.queryByText('99 подряд')).toBeNull();
  });

  it('при падении обновления сохранённые баллы остаются, есть пометка и повтор; без сохранённых показывается ошибка', async () => {
    seed();
    fake.rpc.points_group_benchmark = () => ({ groups: [] });
    const first = render(<PointsLedger playerId="p1" />);
    await screen.findByText('Серия посещений');
    first.unmount();
    fake.errors.points_ledger = 'сбой сети';
    render(<PointsLedger playerId="p1" />);
    expect(await screen.findByText(/данные могли устареть/, undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText('Серия посещений')).toBeInTheDocument();
    delete fake.errors.points_ledger;
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    await waitFor(() => expect(screen.queryByText(/данные могли устареть/)).toBeNull());
  }, 15000);

  it('выход из аккаунта и смена пользователя забывают запомненные баллы', async () => {
    seed();
    fake.rpc.points_group_benchmark = () => ({ groups: [] });
    for (const change of [() => pointsAuthEvent('SIGNED_OUT', null), () => { pointsAuthEvent('SIGNED_IN', { user: { id: 'u1' } }); pointsAuthEvent('SIGNED_IN', { user: { id: 'u2' } }); }]) {
      const r = render(<PointsLedger playerId="p1" />);
      await screen.findByText('Серия посещений');
      r.unmount();
      change();
      render(<PointsLedger playerId="p1" />);
      expect(screen.getByLabelText('Баллы по новым правилам')).toHaveAttribute('aria-busy', 'true'); // памяти нет: заглушка, а не чужие данные
      await screen.findByText('Серия посещений');
      cleanup();
    }
  });

  it('память ограничена: самые старые игроки вытесняются', async () => {
    seed();
    fake.rpc.points_group_benchmark = () => ({ groups: [] });
    for (let i = 0; i < 52; i++) { const r = render(<PointsLedger playerId={`x${i}`} />); await waitFor(() => expect(fake.rpcCalls('points_group_benchmark').length).toBeGreaterThanOrEqual(0)); r.unmount(); }
    await new Promise(r => setTimeout(r, 50));
    const r0 = render(<PointsLedger playerId="x0" />);
    // у игроков без начислений в журнале карточки нет, но память для них тоже держится в пределах 50: самый старый вытеснен
    expect(r0.container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  // --- #763: четыре состояния и устойчивость к сбоям ---
  it('исключение при запросе (сбой сети) показывает ошибку с повтором, а не «Баллов пока нет»', async () => {
    seed();
    fake.rejects.points_ledger = 'Failed to fetch';
    render(<PointsLedger playerId="p1" showEmpty />);
    expect(await screen.findByText('Не удалось загрузить баллы')).toBeInTheDocument();
    expect(screen.queryByText('Баллов пока нет')).toBeNull();
    delete fake.rejects.points_ledger;
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Декабрь 2026')).toBeInTheDocument();
  });

  it('ошибка доступа (RLS) показывается как ошибка, не как пустой журнал', async () => {
    seed();
    fake.errors.points_ledger = 'permission denied for table points_ledger';
    render(<PointsLedger playerId="p1" showEmpty />);
    expect(await screen.findByText('Не удалось загрузить баллы')).toBeInTheDocument();
    expect(screen.queryByText('Баллов пока нет')).toBeNull();
  });

  it('успешный пустой ответ — это «Баллов пока нет», не ошибка', async () => {
    seed();
    fake.db.points_ledger = [];
    render(<PointsLedger playerId="p1" showEmpty />);
    expect(await screen.findByText('Баллов пока нет')).toBeInTheDocument();
    expect(screen.queryByText('Не удалось загрузить баллы')).toBeNull();
  });

  it('ошибка серии (points_series_info) не маскирует журнал и не даёт пустого экрана', async () => {
    seed();
    fake.rpc.points_group_benchmark = () => ({ groups: [] });
    fake.rpc.points_series_info = () => ({ error: { message: 'boom' } });
    render(<PointsLedger playerId="p1" showEmpty />);
    expect(await screen.findByText('Декабрь 2026')).toBeInTheDocument();
    expect(screen.getByText(/Всего накоплено: 9/)).toBeInTheDocument();
    expect(screen.queryByText('Не удалось загрузить баллы')).toBeNull();
    expect(screen.queryByText('Баллов пока нет')).toBeNull();
    expect(screen.queryByText('Серия посещений')).toBeNull();
  });

  it('смена ребёнка во время загрузки: ответ предыдущего не показывается', async () => {
    seed();
    fake.rpc.points_group_benchmark = () => ({ groups: [] });
    fake.db.points_ledger = [...(fake.db.points_ledger as object[]), { id: 'f', player_id: 'p2', status: 'active', event_date: '2026-12-02', points: 4, source_type: 'extra', reason_code: 'attended', components: {} }];
    const slow = fake.hold('points_ledger'); // первый запрос (p1) ждёт
    const view = render(<PointsLedger playerId="p1" showEmpty />);
    await waitFor(() => expect(fake.holds.points_ledger).toHaveLength(0));
    view.rerender(<PointsLedger playerId="p2" showEmpty />);
    expect(await screen.findByText(/Всего накоплено: 13/)).toBeInTheDocument(); // p2: 9 + 4
    slow.release(); // запоздавший ответ p1
    await new Promise(r => setTimeout(r, 30));
    expect(screen.queryByText(/Всего накоплено: 9\b/)).toBeNull();
    expect(screen.getByText(/Всего накоплено: 13/)).toBeInTheDocument();
  });

  // --- #764: история любой длины, стабильная пагинация, один итог ---
  const bulk = (n: number, player = 'p1') => Array.from({ length: n }, (_, i) => ({ id: `y${String(i).padStart(5, '0')}`, player_id: player, status: 'active', event_date: '2026-12-03', points: 1, source_type: 'group_session', reason_code: 'attended', components: { class: 'regular' } }));

  it.each([999, 1000, 1001, 2001])('история из %i записей читается целиком: итог совпадает, дублей нет', async n => {
    fake.rpc.points_group_benchmark = () => ({ groups: [] });
    fake.rpc.points_series_info = () => null;
    fake.db.points_ledger = bulk(n);
    const v = await loadLedger('p1', true);
    expect(v.rows).toHaveLength(n);
    expect(new Set(v.rows.map(r => r.id)).size).toBe(n);
    render(<PointsLedger playerId="p1" />);
    expect(await screen.findByText(new RegExp(`Всего накоплено: ${n} `))).toBeInTheDocument();
  });

  it('старые месяцы за пределами первых 1000 строк доступны', async () => {
    fake.rpc.points_group_benchmark = () => ({ groups: [] });
    fake.rpc.points_series_info = () => null;
    fake.db.points_ledger = [...bulk(1200), { id: 'old', player_id: 'p1', status: 'active', event_date: '2026-01-15', points: 7, source_type: 'manual', reason_code: 'manual', components: { note: 'Старое' } }];
    render(<PointsLedger playerId="p1" />);
    await screen.findByText(/Всего накоплено: 1207 /);
    for (let i = 0; i < 11; i++) fireEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    expect(await screen.findByText('Январь 2026')).toBeInTheDocument();
    expect(screen.getByText(/От тренера: Старое/)).toBeInTheDocument();
  });

  it('запись добавлена между страницами: ни дублей, ни пропусков уже существовавших строк', async () => {
    fake.rpc.points_series_info = () => null;
    fake.db.points_ledger = bulk(1500).map((r, i) => ({ ...r, id: `m${String(i + 100).padStart(5, '0')}` }));
    const first = fake.hold('points_ledger');
    const second = fake.hold('points_ledger');
    const run = loadLedger('p1', true);
    await waitFor(() => expect(fake.holds.points_ledger).toHaveLength(1));
    first.release();
    await waitFor(() => expect(fake.holds.points_ledger).toHaveLength(0));
    // пока читается следующая страница, появляется новая запись (и по дате, и по id она «раньше» уже прочитанных)
    fake.db.points_ledger = [...(fake.db.points_ledger as object[]), { id: 'm00001', player_id: 'p1', status: 'active', event_date: '2026-12-09', points: 1, source_type: 'manual', reason_code: 'manual', components: { note: 'Новая' } }];
    second.release();
    const v = await run;
    const ids = v.rows.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length); // дублей нет
    for (let i = 0; i < 1500; i++) expect(ids).toContain(`m${String(i + 100).padStart(5, '0')}`); // ничего из прежнего не потеряно
  });

  it('сортировка: новые сверху, при одинаковой дате по id (стабильно)', async () => {
    fake.rpc.points_series_info = () => null;
    fake.db.points_ledger = [
      { id: 'b', player_id: 'p1', status: 'active', event_date: '2026-12-03', points: 1, source_type: 'manual', reason_code: 'manual', components: {} },
      { id: 'a', player_id: 'p1', status: 'active', event_date: '2026-12-03', points: 1, source_type: 'manual', reason_code: 'manual', components: {} },
      { id: 'c', player_id: 'p1', status: 'active', event_date: '2026-12-09', points: 1, source_type: 'manual', reason_code: 'manual', components: {} },
    ];
    const v = await loadLedger('p1', true);
    expect(v.rows.map(r => r.id)).toEqual(['c', 'b', 'a']);
  });
});
