import { afterEach, describe, expect, it } from 'vitest';
import { campSlugFromStart, peekCampSlug, resetStartParam, takeCampSlug } from './startParam';

// Параметр запуска Mini App (Issue #470, docs/CAMP_SELF_SIGNUP_ACCEPTANCE.md, условие 62)
const setTg = (start?: string) => {
  (window as any).Telegram = { WebApp: { initData: 'x', initDataUnsafe: { start_param: start } } };
};
afterEach(() => {
  delete (window as any).Telegram;
  window.history.replaceState(null, '', '/');
  resetStartParam();
});

describe('campSlugFromStart', () => {
  it('camp_<имя>: имя в нижнем регистре', () => {
    expect(campSlugFromStart('camp_zima')).toBe('zima');
    expect(campSlugFromStart('camp_Zima-2027')).toBe('zima-2027');
  });
  it('чужие и неверные значения игнорируются', () => {
    for (const v of [undefined, null, '', 'zima', 'camp_', 'camp_ab', 'camp_zima/x', 'camp_<b>', 'camp_-zima', 'camp_zi--ma', 'camp_зима', `camp_${'a'.repeat(61)}`, 'link_zima', ' camp_zima']) {
      expect(campSlugFromStart(v as string | null | undefined), String(v)).toBeNull();
    }
  });
});

describe('параметр запуска', () => {
  it('из Telegram.WebApp.initDataUnsafe.start_param', () => {
    setTg('camp_zima');
    expect(peekCampSlug()).toBe('zima');
  });
  it('из tgWebAppStartParam в адресе (хэш и строка запроса)', () => {
    window.history.replaceState(null, '', '/#tgWebAppData=abc&tgWebAppStartParam=camp_zima&tgWebAppVersion=8');
    expect(peekCampSlug()).toBe('zima');
    resetStartParam();
    window.history.replaceState(null, '', '/?tgWebAppStartParam=camp_kubok');
    expect(peekCampSlug()).toBe('kubok');
  });
  it('нет параметра или чужой: null без ошибок', () => {
    expect(peekCampSlug()).toBeNull();
    setTg('something_else');
    resetStartParam();
    expect(peekCampSlug()).toBeNull();
  });
  it('применяется один раз за запуск', () => {
    setTg('camp_zima');
    expect(takeCampSlug()).toBe('zima');
    expect(takeCampSlug()).toBeNull();
    expect(peekCampSlug()).toBeNull();
  });
});
