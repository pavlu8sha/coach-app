import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

// Общие настройки клуба (#339): таблица club_settings, читает и пишет администратор.
// Если записи нет, доступа нет (тренер, родитель) или база не ответила, действует значение по умолчанию из этого файла.

export const CHAMP_FEE_KEY = 'matches.champFee';
export const GUEST_FEE_KEY = 'matches.guestFee';

export interface SettingDef {
  key: string;
  title: string;
  group: string;
  kind: 'number' | 'list';
  /** Значение по умолчанию; пустая строка — «не задано» (для чисел: без ограничения, для списков: утверждённый порядок). */
  def: string;
  /** Как называть пустое значение по умолчанию. */
  emptyLabel?: string;
  hint?: string;
  min?: number;
  max?: number;
  /** Только целое число (места, день месяца). */
  integer?: boolean;
}

// Ключи совпадают с теми, что пришли из листа «НАСТРОЙКИ» старого приложения (stats.lowPct, ind.capIndividual, ind.capGoalkeepers, equip.discNeedOwn/All, matches.champFee),
// чтобы прежние значения подхватывались сами. Остальные названия новые.
export const SETTINGS: SettingDef[] = [
  { key: 'stats.lowPct', title: 'Порог низкой посещаемости, %', group: 'Посещаемость', kind: 'number', def: '50', min: 0, max: 100, hint: 'Ниже этого процента посещаемость в статистике красная.' },
  { key: 'groups.order', title: 'Порядок групп в листе посещаемости и в списке сбора (через запятую)', group: 'Посещаемость', kind: 'list', def: '', emptyLabel: 'U7→U13, Ortachala, Isani, затем новые группы, weekends, индивидуальные', hint: 'Новые группы идут после Isani и не теряются. Свой список полностью заменяет этот порядок.' },
  { key: 'payments.nextMonthDay', title: 'С какого числа в «Оплатах» предлагать следующий месяц', group: 'Оплаты', kind: 'number', def: '22', min: 1, max: 31, integer: true, hint: 'С этого числа экран «Оплаты за месяц» открывается на следующем месяце.' },
  { key: 'ind.capIndividual', title: 'Мест на индивидуальном занятии', group: 'Занятия', kind: 'number', def: '6', min: 1, max: 100, integer: true, hint: 'По умолчанию 6, как в старом приложении. Пустое поле возвращает это значение.' },
  { key: 'ind.capGoalkeepers', title: 'Мест на вратарском занятии', group: 'Занятия', kind: 'number', def: '7', min: 1, max: 100, integer: true, hint: 'По умолчанию 7, как в старом приложении. Пустое поле возвращает это значение.' },
  { key: 'extra.cap', title: 'Мест на дополнительной тренировке', group: 'Занятия', kind: 'number', def: '', emptyLabel: 'без ограничения', min: 1, max: 100, integer: true, hint: 'Пусто — без ограничения. Работает при записи родителями и администратором.' },
  { key: 'equip.fullPrice', title: 'Без скидки, по полной цене (через запятую)', group: 'Экипировка', kind: 'list', def: 'Носки, Гетры' },
  { key: 'equip.discNeedOwn', title: 'Скидка: у игрока в итоге есть каждая из позиций, в этом заказе или в прошлых (через запятую; «или» — любая из)', group: 'Экипировка', kind: 'list', def: 'Игровая форма или Вратарская форма, Тренировочная форма, Спортивный костюм, Дождевик' },
  { key: 'equip.discNeedAll', title: 'Скидка: в этом заказе есть каждая из позиций (через запятую; «или» — любая из)', group: 'Экипировка', kind: 'list', def: 'Игровая форма или Вратарская форма или Тренировочная форма или Спортивный костюм или Дождевик' },
  { key: 'equip.discPct', title: 'Скидка на комплект, % (0 — без скидки)', group: 'Экипировка', kind: 'number', def: '15', min: 0, max: 90 },
  { key: 'equip.discRound', title: 'Сумма со скидкой округляется до, ₾', group: 'Экипировка', kind: 'number', def: '5', min: 1, max: 100, integer: true, hint: 'До ближайшего значения, минимум 1 — как в старом приложении.' },
  { key: CHAMP_FEE_KEY, title: 'Взнос за чемпионат, ₾ — общий', group: 'Матчи', kind: 'number', def: '', emptyLabel: 'не задан', min: 0, max: 100000, hint: 'Подставляется в новый чемпионат, если у команды нет своего значения (ниже). Пусто — взнос вводится вручную.' },
  { key: GUEST_FEE_KEY, title: 'Разовый взнос гостя за матч чемпионата, ₾', group: 'Матчи', kind: 'number', def: '25', min: 0, max: 100000, hint: 'Игроку, отмеченному в матче чемпионата или фестиваля, но не входящему в заявку события, при сохранении матча назначается этот взнос. По умолчанию 25.' },
];

export const settingDef = (key: string) => SETTINGS.find(s => s.key === key);

export type SettingValues = Record<string, string>;

/** Значение настройки или значение по умолчанию. */
export const settingText = (values: SettingValues, key: string) => {
  const v = values[key];
  return v !== undefined && v !== null && v.trim() !== '' ? v.trim() : (settingDef(key)?.def ?? '');
};

export function settingNumber(values: SettingValues, key: string): number {
  const def = settingDef(key);
  const raw = values[key];
  if (raw === undefined || raw === null || raw.trim() === '') return def?.def ? Number(def.def.replace(',', '.')) : NaN;
  if (def && settingError(def, raw) !== null) return NaN;
  const n = Number(raw.trim().replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

/** Ошибка сохранённого числового значения; null — значения нет или оно подходит. */
export function settingNumberError(values: SettingValues, key: string): string | null {
  const def = settingDef(key);
  const raw = values[key];
  if (!def || def.kind !== 'number' || raw === undefined || raw === null || raw.trim() === '') return null;
  return settingError(def, raw);
}

/** Проверка значения перед сохранением; null — значение подходит. */
export function settingError(def: SettingDef, raw: string): string | null {
  const v = raw.trim();
  if (v === '' && def.def === '') return null; // пустое значение допустимо: настройка не задана
  if (def.kind === 'list') return v === '' ? 'Список не может быть пустым.' : null;
  if (v === '') return null; // пустое поле возвращает значение по умолчанию
  const n = Number(v.replace(',', '.'));
  if (!Number.isFinite(n)) return 'Нужно число.';
  if (def.integer && !Number.isInteger(n)) return 'Нужно целое число.';
  if (def.min !== undefined && n < def.min) return `Не меньше ${def.min}.`;
  if (def.max !== undefined && n > def.max) return `Не больше ${def.max}.`;
  return null;
}

/** Значения по командам: ключ → (команда → значение). Сейчас так хранится взнос за чемпионат (matches.champFee). */
export type ScopedValues = Record<string, Record<string, string>>;

export interface ClubSettings { values: SettingValues; scoped: ScopedValues; clubId: string | null; loaded: boolean; reload: () => void }

/** Взнос за чемпионат команды: своё значение команды, иначе общее; null — не задан. */
export function champFeeFor(values: SettingValues, scoped: ScopedValues, team: string): number | null {
  const own = Number((scoped[CHAMP_FEE_KEY]?.[team] ?? '').replace(',', '.'));
  if ((scoped[CHAMP_FEE_KEY]?.[team] ?? '').trim() !== '' && Number.isFinite(own) && own >= 0) return own;
  const all = settingNumber(values, CHAMP_FEE_KEY);
  return Number.isFinite(all) ? all : null;
}

/** Читает все настройки клуба одним запросом. До ответа базы и при ошибке values пуст, и действуют значения по умолчанию. */
export function useClubSettings(): ClubSettings {
  const [state, setState] = useState<{ values: SettingValues; scoped: ScopedValues; clubId: string | null; loaded: boolean }>({ values: {}, scoped: {}, clubId: null, loaded: false });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const c = await supabase.from('clubs').select('id').limit(1);
      const cid = c.error ? null : ((c.data ?? []) as { id: string }[])[0]?.id ?? null;
      const values: SettingValues = {};
      const scoped: ScopedValues = {};
      if (cid) {
        const r = await supabase.from('club_settings').select('key, scope, value').eq('club_id', cid).in('key', SETTINGS.map(s => s.key));
        if (!r.error) {
          for (const x of (r.data ?? []) as { key: string; scope: string | null; value: string | null }[]) {
            if ((x.scope ?? '') === '') values[x.key] = x.value ?? '';
            else (scoped[x.key] ??= {})[x.scope as string] = x.value ?? '';
          }
        }
      }
      if (!alive) return;
      setState({ values, scoped, clubId: cid, loaded: true });
    })();
    return () => { alive = false; };
  }, [tick]);
  const reload = useCallback(() => setTick(t => t + 1), []);
  return { ...state, reload };
}
