import { beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_VERSION, buildSnapshot, clearNavStorage, loadSnapshot, saveSnapshot, specKey, storageKey, type PersistSpec } from './storage';
import type { NavEntry } from './store';

const U = '11111111-2222-3333-4444-555555555555';
const entry = (o: Partial<NavEntry>): NavEntry => ({ id: 1, screen: 'players', params: {}, ui: {}, scrollY: 0, ...o });
const specs = new Map<string, PersistSpec>([
  [specKey('players', 'players', 'status'), { kind: 'enum', values: ['active', 'paused', 'all'] }],
  [specKey('players', 'players', 'onlyUnpaid'), { kind: 'bool' }],
  [specKey('players', 'players', 'gid'), { kind: 'uuid' }],
]);

describe('белый список хранилища', () => {
  beforeEach(() => localStorage.clear());

  it('записываются только объявленные поля с допустимыми значениями', () => {
    const snap = buildSnapshot({ active: 'players', stacks: { players: [entry({ ui: { status: 'paused', onlyUnpaid: true, gid: U }, scrollY: 412.6 })] } }, specs);
    expect(snap.stacks.players[0].ui).toEqual({ status: 'paused', onlyUnpaid: true, gid: U });
    expect(snap.stacks.players[0].scrollY).toBe(413);
  });

  it('поиск, имена, суммы и любой недекларированный текст не попадают в снимок', () => {
    const snap = buildSnapshot(
      { active: 'players', stacks: { players: [entry({ ui: { q: 'Иванов Пётр', note: 'долг 5000', status: 'paused', draft: { name: 'Пётр' } } })] } },
      specs,
    );
    const json = JSON.stringify(snap);
    expect(json).not.toContain('Иванов');
    expect(json).not.toContain('5000');
    expect(json).not.toContain('Пётр');
    expect(snap.stacks.players[0].ui).toEqual({ status: 'paused' });
  });

  it('объявленное поле с недопустимым значением отбрасывается', () => {
    const snap = buildSnapshot({ active: 'players', stacks: { players: [entry({ ui: { status: 'Иванов', gid: 'не uuid', onlyUnpaid: 'да' } })] } }, specs);
    expect(snap.stacks.players[0].ui).toEqual({});
  });

  it('params допускают только UUID или короткие slug', () => {
    const snap = buildSnapshot({ active: 'players', stacks: { players: [entry({ params: { id: U, section: 'camps', name: 'Иванов Пётр', long: 'x'.repeat(80) } })] } }, specs);
    expect(snap.stacks.players[0].params).toEqual({ id: U, section: 'camps' });
  });

  it('сохранение и чтение: ключ включает пользователя и режим', () => {
    const snap = buildSnapshot({ active: 'players', stacks: { players: [entry({ ui: { status: 'all' } })] } }, specs);
    saveSnapshot('u1', 'real', snap);
    expect(localStorage.getItem(storageKey('u1', 'real'))).not.toBeNull();
    expect(loadSnapshot('u1', 'real')?.stacks.players[0].ui).toEqual({ status: 'all' });
    expect(loadSnapshot('u1', 'parent')).toBeNull();
    expect(loadSnapshot('u2', 'real')).toBeNull();
  });

  it('чужая версия формата и повреждённые данные сбрасываются', () => {
    localStorage.setItem(storageKey('u1', 'real'), JSON.stringify({ v: STORAGE_VERSION + 1, active: null, day: '2026-11-06', stacks: {} }));
    expect(loadSnapshot('u1', 'real')).toBeNull();
    expect(localStorage.getItem(storageKey('u1', 'real'))).toBeNull();
    localStorage.setItem(storageKey('u1', 'real'), '{не json');
    expect(loadSnapshot('u1', 'real')).toBeNull();
    expect(localStorage.getItem(storageKey('u1', 'real'))).toBeNull();
  });

  it('выход из аккаунта удаляет всё состояние навигации и не трогает остальное', () => {
    saveSnapshot('u1', 'real', { v: 1, active: null, day: '2026-11-06', stacks: {} });
    saveSnapshot('u2', 'parent', { v: 1, active: null, day: '2026-11-06', stacks: {} });
    localStorage.setItem('ks.parentMode', '1');
    clearNavStorage();
    expect(localStorage.getItem(storageKey('u1', 'real'))).toBeNull();
    expect(localStorage.getItem(storageKey('u2', 'parent'))).toBeNull();
    expect(localStorage.getItem('ks.parentMode')).toBe('1');
  });

  it('смена пользователя удаляет состояние чужих пользователей', () => {
    saveSnapshot('u1', 'real', { v: 1, active: null, day: '2026-11-06', stacks: {} });
    saveSnapshot('u2', 'real', { v: 1, active: null, day: '2026-11-06', stacks: {} });
    clearNavStorage('u2');
    expect(localStorage.getItem(storageKey('u1', 'real'))).toBeNull();
    expect(localStorage.getItem(storageKey('u2', 'real'))).not.toBeNull();
  });

  it('недоступное хранилище не ломает приложение', () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('quota'); };
    expect(() => saveSnapshot('u1', 'real', { v: 1, active: null, day: '2026-11-06', stacks: {} })).not.toThrow();
    Storage.prototype.setItem = orig;
  });
});
