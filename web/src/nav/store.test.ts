import { describe, expect, it } from 'vitest';
import { NavStore } from './store';

const mk = (y = { v: 0 }) => ({ s: new NavStore({ readScroll: () => y.v }), y });

describe('NavStore: разделы и стеки', () => {
  it('каждый раздел имеет свой независимый стек', () => {
    const { s } = mk();
    s.selectRoot('players');
    s.push('players', { screen: 'card', params: { id: 'p1' } });
    s.selectRoot('money');
    expect(s.depth('money')).toBe(1);
    expect(s.depth('players')).toBe(2);
    s.selectRoot('players');
    expect(s.top('players').params.id).toBe('p1');
  });

  it('push и back; на корне back возвращает false', () => {
    const { s } = mk();
    s.selectRoot('more');
    s.push('more', { screen: 'section', params: { id: 'camps' } });
    expect(s.back('more')).toBe(true);
    expect(s.depth('more')).toBe(1);
    expect(s.back('more')).toBe(false);
  });

  it('повторный выбор активного раздела ничего не меняет, версия не растёт', () => {
    const { s, y } = mk();
    s.selectRoot('more');
    s.push('more', { screen: 'section', params: { id: 'camps' } });
    y.v = 300;
    const v = s.getVersion();
    s.selectRoot('more');
    expect(s.getVersion()).toBe(v);
    expect(s.depth('more')).toBe(2);
    expect(s.getScroll('more', 1)).toBe(0); // повторное нажатие не записывает и не сбрасывает позицию
    expect(s.getScroll('more', 0)).toBe(0);
  });

  it('позиция прокрутки запоминается при push и при смене раздела', () => {
    const { s, y } = mk();
    s.selectRoot('players');
    y.v = 840;
    s.push('players', { screen: 'card' });
    expect(s.getScroll('players', 0)).toBe(840);
    expect(s.getScroll('players', 1)).toBe(0); // новый экран открывается сверху
    y.v = 120;
    s.selectRoot('money');
    expect(s.getScroll('players', 1)).toBe(120);
    s.back('players');
    expect(s.getScroll('players', 0)).toBe(840);
  });

  it('прокрутка пишется только активному разделу', () => {
    const { s, y } = mk();
    s.selectRoot('a');
    s.selectRoot('b');
    y.v = 50;
    s.captureScroll();
    expect(s.getScroll('a', 0)).toBe(0);
    expect(s.getScroll('b', 0)).toBe(50);
  });

  it('состояние экрана живёт в записи и возвращается после back', () => {
    const { s } = mk();
    s.selectRoot('players');
    s.setUi('players', 0, 'q', 'иван');
    s.setUi('players', 0, 'status', 'paused');
    s.push('players', { screen: 'card' });
    s.setUi('players', 1, 'tab', 'info');
    s.back('players');
    expect(s.getUi('players', 0, 'q')).toBe('иван');
    expect(s.getUi('players', 0, 'status')).toBe('paused');
    expect(s.getUi('players', 1, 'tab')).toBeUndefined();
  });

  it('запись того же значения не вызывает перерисовку', () => {
    const { s } = mk();
    s.selectRoot('a');
    s.setUi('a', 0, 'k', 1);
    const v = s.getVersion();
    s.setUi('a', 0, 'k', 1);
    expect(s.getVersion()).toBe(v);
  });

  it('смена области (другой пользователь или режим) очищает стеки, но не выбранный раздел', () => {
    const { s } = mk();
    s.setScope('u1:real');
    s.selectRoot('players');
    s.push('players', { screen: 'card', params: { id: 'p1' } });
    s.setScope('u2:real');
    expect(s.depth('players')).toBe(1);
    expect(s.getActive()).toBe('players');
  });

  it('та же область ничего не очищает', () => {
    const { s } = mk();
    s.setScope('u1:real');
    s.selectRoot('players');
    s.push('players', { screen: 'card' });
    s.setScope('u1:real');
    expect(s.depth('players')).toBe(2);
  });

  it('сброс при выходе очищает всё', () => {
    const { s } = mk();
    s.setScope('u1:real');
    s.selectRoot('players');
    s.push('players', { screen: 'card' });
    s.reset();
    expect(s.getActive()).toBeNull();
    expect(s.depth('players')).toBe(1);
  });

  it('подписчики получают уведомление об изменениях', () => {
    const { s } = mk();
    let n = 0;
    const off = s.subscribe(() => n++);
    s.selectRoot('a');
    s.push('a', { screen: 'x' });
    off();
    s.back('a');
    expect(n).toBe(2);
  });
});
