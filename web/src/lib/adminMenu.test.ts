import { describe, expect, it } from 'vitest';
import { DEFAULT_BAR, parseBar } from './adminMenu';

describe('нижняя панель администратора', () => {
  it('без настройки или с испорченной — панель по умолчанию', () => {
    expect(parseBar(null)).toEqual(DEFAULT_BAR);
    expect(parseBar('не json')).toEqual(DEFAULT_BAR);
    expect(parseBar('{"bar":[]}')).toEqual(DEFAULT_BAR);
  });

  it('берёт сохранённый порядок, отбрасывает неизвестные, повторы и «Меню», не больше четырёх', () => {
    expect(parseBar('{"bar":["money","sessions","money","x","menu","players","cmatches","stats"]}')).toEqual(['money', 'sessions', 'players', 'cmatches']);
  });
});
