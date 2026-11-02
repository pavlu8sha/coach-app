import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

// Общие настройки клуба (#339): таблица club_settings, читает и пишет администратор.
// Если записи нет, доступа нет (тренер, родитель) или база не ответила, действует значение по умолчанию из этого файла.

export interface SettingDef {
  key: string;
  title: string;
  group: string;
  kind: 'number' | 'list';
  def: string;
  hint?: string;
  min?: number;
  max?: number;
}

export const SETTINGS: SettingDef[] = [
  { key: 'stats.low_pct', title: 'Порог низкой посещаемости, %', group: 'Посещаемость', kind: 'number', def: '50', min: 0, max: 100, hint: 'Ниже этого процента посещаемость в статистике красная.' },
  { key: 'payments.next_month_day', title: 'С какого числа в «Оплатах» предлагать следующий месяц', group: 'Оплаты', kind: 'number', def: '22', min: 1, max: 31, hint: 'С этого числа экран «Оплаты за месяц» открывается на следующем месяце.' },
  { key: 'equipment.full_price_kits', title: 'Без скидки, по полной цене (через запятую)', group: 'Экипировка', kind: 'list', def: 'Носки, Гетры' },
  { key: 'equipment.discount_in_order', title: 'Скидка: в этом заказе есть каждая из позиций (через запятую; «или» — любая из)', group: 'Экипировка', kind: 'list', def: 'Игровая форма или Вратарская форма или Тренировочная форма или Спортивный костюм или Дождевик' },
  { key: 'equipment.discount_player_has', title: 'Скидка: у игрока в итоге есть каждая из позиций, в этом заказе или в прошлых (через запятую; «или» — любая из)', group: 'Экипировка', kind: 'list', def: 'Игровая форма или Вратарская форма, Тренировочная форма, Спортивный костюм, Дождевик' },
  { key: 'equipment.discount_pct', title: 'Скидка на комплект, % (0 — без скидки)', group: 'Экипировка', kind: 'number', def: '15', min: 0, max: 90 },
  { key: 'equipment.discount_round', title: 'Сумма со скидкой округляется до, ₾', group: 'Экипировка', kind: 'number', def: '5', min: 0, max: 100, hint: 'До ближайшего значения. 0 — без округления.' },
];

export const settingDef = (key: string) => SETTINGS.find(s => s.key === key);

export type SettingValues = Record<string, string>;

/** Значение настройки или значение по умолчанию. */
export const settingText = (values: SettingValues, key: string) => {
  const v = values[key];
  return v !== undefined && v.trim() !== '' ? v.trim() : (settingDef(key)?.def ?? '');
};

export function settingNumber(values: SettingValues, key: string): number {
  const def = settingDef(key);
  const n = Number(settingText(values, key).replace(',', '.'));
  if (!Number.isFinite(n) || (def?.min !== undefined && n < def.min) || (def?.max !== undefined && n > def.max)) return Number(def?.def ?? 0);
  return n;
}

/** Проверка значения перед сохранением; null — значение подходит. */
export function settingError(def: SettingDef, raw: string): string | null {
  const v = raw.trim();
  if (def.kind === 'list') return v === '' ? 'Список не может быть пустым.' : null;
  const n = Number(v.replace(',', '.'));
  if (v === '' || !Number.isFinite(n)) return 'Нужно число.';
  if (def.min !== undefined && n < def.min) return `Не меньше ${def.min}.`;
  if (def.max !== undefined && n > def.max) return `Не больше ${def.max}.`;
  return null;
}

export interface ClubSettings { values: SettingValues; clubId: string | null; loaded: boolean; reload: () => void }

/** Читает все настройки клуба одним запросом. До ответа базы и при ошибке values пуст, и действуют значения по умолчанию. */
export function useClubSettings(): ClubSettings {
  const [values, setValues] = useState<SettingValues>({});
  const [clubId, setClubId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const c = await supabase.from('clubs').select('id').limit(1);
      const cid = c.error ? null : ((c.data ?? []) as { id: string }[])[0]?.id ?? null;
      let out: SettingValues = {};
      if (cid) {
        const r = await supabase.from('club_settings').select('key, value').eq('club_id', cid).eq('scope', '').in('key', SETTINGS.map(s => s.key));
        if (!r.error) out = Object.fromEntries(((r.data ?? []) as { key: string; value: string | null }[]).map(x => [x.key, x.value ?? '']));
      }
      if (!alive) return;
      setClubId(cid);
      setValues(out);
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, [tick]);
  const reload = useCallback(() => setTick(t => t + 1), []);
  return { values, clubId, loaded, reload };
}
