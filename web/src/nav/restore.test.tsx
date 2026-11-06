import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NavProvider, NavRoot, useNav, useNavScope, useNavState } from '.';
import { NavStore } from './store';
import { restorableEntry } from './restore';
import { STORAGE_VERSION, buildSnapshot, loadSnapshot, saveSnapshot, storageKey, validateValue, specKey, type PersistSpec, type Snapshot } from './storage';

const U = '123e4567-e89b-12d3-a456-426614174000';
const opts = (allowed: string[], today = '2026-11-06') => ({ allowRoot: (r: string) => allowed.includes(r), restorable: restorableEntry, today });
const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  v: STORAGE_VERSION,
  active: 'players',
  day: '2026-11-06',
  stacks: { players: [{ screen: 'players', params: {}, ui: { status: 'all' }, scrollY: 300 }] },
  ...over,
});

describe('store.hydrate', () => {
  it('поднимает раздел, фильтры и прокрутку', () => {
    const s = new NavStore();
    s.hydrate(snap(), opts(['players']));
    expect(s.getActive()).toBe('players');
    expect(s.getUi('players', 0, 'status')).toBe('all');
    expect(s.getScroll('players', 0)).toBe(300);
  });

  it('раздел, которого у роли нет, не восстанавливается', () => {
    const s = new NavStore();
    s.hydrate(snap({ stacks: { money: [{ screen: 'money', params: {}, ui: { tab: 'x' }, scrollY: 5 }] }, active: 'money' }), opts(['players']));
    expect(s.getActive()).toBeNull();
    expect(s.getUi('money', 0, 'tab')).toBeUndefined();
  });

  it('«Ещё → раздел» возвращается, а карточка с данными и неизвестный раздел отбрасываются', () => {
    const base = { screen: 'more', params: {}, ui: {}, scrollY: 40 };
    const s = new NavStore();
    s.hydrate(snap({ active: 'more', stacks: { more: [base, { screen: 'section', params: { id: 'equip' }, ui: {}, scrollY: 0 }, { screen: 'order', params: { id: U }, ui: {}, scrollY: 0 }] } }), opts(['more']));
    expect(s.entries('more').map(e => e.screen)).toEqual(['more', 'section']);
    const t = new NavStore();
    t.hydrate(snap({ active: 'more', stacks: { more: [base, { screen: 'section', params: { id: 'нет-такого' }, ui: {}, scrollY: 0 }] } }), opts(['more']));
    expect(t.entries('more').map(e => e.screen)).toEqual(['more']);
  });

  it('значения «только сегодня» из прошлого дня отбрасываются, остальные остаются', () => {
    const stacks = { players: [{ screen: 'players', params: {}, ui: { date: '2026-11-01', tab: 'grp' }, daily: ['date'], scrollY: 0 }] };
    const old = new NavStore();
    old.hydrate(snap({ day: '2026-11-05', stacks }), opts(['players']));
    expect(old.getUi('players', 0, 'date')).toBeUndefined();
    expect(old.getUi('players', 0, 'tab')).toBe('grp');
    const same = new NavStore();
    same.hydrate(snap({ stacks }), opts(['players']));
    expect(same.getUi('players', 0, 'date')).toBe('2026-11-01');
  });

  it('повторное восстановление за запуск не выполняется; выход сбрасывает признак', () => {
    const s = new NavStore();
    expect(s.hasRestored()).toBe(false);
    s.hydrate(null, opts([]));
    expect(s.hasRestored()).toBe(true);
    s.reset();
    expect(s.hasRestored()).toBe(false);
  });
});

describe('снимок', () => {
  it('«day» хранится как ежедневное значение и проверяется по формату', () => {
    const specs = new Map<string, PersistSpec>([[specKey('sessions', 'sessions', 'date'), { kind: 'day' }]]);
    const entry = { id: 1, screen: 'sessions', params: {}, ui: { date: '2026-11-06' }, scrollY: 0 };
    const s = buildSnapshot({ active: 'sessions', stacks: { sessions: [entry] } }, specs, '2026-11-06');
    expect(s.day).toBe('2026-11-06');
    expect(s.stacks.sessions[0].daily).toEqual(['date']);
    expect(validateValue({ kind: 'day' }, '2026-11-06')).toBe(true);
    expect(validateValue({ kind: 'day' }, 'вчера')).toBe(false);
  });

  it('снимок без даты записи считается повреждённым и удаляется', () => {
    localStorage.setItem(storageKey('u1', 'real'), JSON.stringify({ v: STORAGE_VERSION, active: null, stacks: {} }));
    expect(loadSnapshot('u1', 'real')).toBeNull();
    expect(localStorage.getItem(storageKey('u1', 'real'))).toBeNull();
  });
});

function Players({ allowed }: { allowed: string[] }) {
  const ready = useNavScope('u1:real', { allowRoot: r => allowed.includes(r) });
  const nav = useNav();
  const [status, setStatus] = useNavState('status', 'active', { persist: { kind: 'enum', values: ['active', 'all'] } });
  const [q, setQ] = useNavState('q', '');
  if (!ready) return <p>заставка</p>;
  return (
    <div>
      <p>статус: {status}</p>
      <p>роль-экран: {nav.top.screen}</p>
      <button onClick={() => setStatus('all')}>все</button>
      <button onClick={() => setQ('Иванов')}>поиск</button>
    </div>
  );
}
const shell = (allowed: string[]) => (
  <NavProvider initial="players">
    <NavRoot root="players"><Players allowed={allowed} /></NavRoot>
  </NavProvider>
);

describe('восстановление при запуске', () => {
  it('поднимает фильтр из хранилища до первого показа экрана', () => {
    saveSnapshot('u1', 'real', snap({ stacks: { players: [{ screen: 'players', params: {}, ui: { status: 'all' }, scrollY: 0 }] } }));
    render(shell(['players']));
    expect(screen.getByText('статус: all')).toBeInTheDocument();
  });

  it('испорченное значение в хранилище заменяется начальным', () => {
    saveSnapshot('u1', 'real', snap({ stacks: { players: [{ screen: 'players', params: {}, ui: { status: '<script>' }, scrollY: 0 }] } }));
    render(shell(['players']));
    expect(screen.getByText('статус: active')).toBeInTheDocument();
  });

  it('состояние другого пользователя не поднимается', () => {
    saveSnapshot('u2', 'real', snap());
    render(shell(['players']));
    expect(screen.getByText('статус: active')).toBeInTheDocument();
  });

  it('изменения записываются на диск без поиска и текстов', () => {
    vi.useFakeTimers();
    try {
      render(shell(['players']));
      act(() => { screen.getByText('все').click(); screen.getByText('поиск').click(); });
      act(() => { vi.advanceTimersByTime(400); });
      const raw = localStorage.getItem(storageKey('u1', 'real'))!;
      expect(JSON.parse(raw).stacks.players[0].ui).toEqual({ status: 'all' });
      expect(raw).not.toContain('Иванов');
    } finally {
      vi.useRealTimers();
    }
  });
});
