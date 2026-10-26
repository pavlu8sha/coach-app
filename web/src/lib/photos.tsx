import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// Фото клуба: по умолчанию файл из /img/<ключ>.jpg, администратор может заменить его в приложении (таблица club_photos, миграция 0046).
export const PHOTO_SLOTS: { key: string; label: string; group: string }[] = [
  { key: 'camp-hero', label: 'Главное фото сборов', group: 'Сборы' },
  { key: 'camp-resort', label: 'Территория отеля', group: 'Сборы' },
  { key: 'camp-team', label: 'Команда', group: 'Сборы' },
  { key: 'camp-garden', label: 'Сад отеля', group: 'Сборы' },
  { key: 'camp-play', label: 'Игра', group: 'Сборы' },
  { key: 'camp-sunset', label: 'Закат', group: 'Сборы' },
  { key: 'camp-room1', label: 'Номер 1', group: 'Сборы' },
  { key: 'camp-room2', label: 'Номер 2', group: 'Сборы' },
  { key: 'camp-room3', label: 'Санузел в номере', group: 'Сборы' },
  { key: 'camp-fields', label: 'Футбольные поля', group: 'Сборы' },
  { key: 'camp-class', label: 'Теория и обучение', group: 'Сборы' },
  { key: 'camp-shirt', label: 'Футболка участника', group: 'Сборы' },
  { key: 'kit-train', label: 'Тренировочный комплект', group: 'Экипировка' },
  { key: 'kit-game', label: 'Игровой комплект', group: 'Экипировка' },
  { key: 'kit-gk', label: 'Вратарский комплект', group: 'Экипировка' },
  { key: 'kit-gk-detail', label: 'Вратарский комплект: детали', group: 'Экипировка' },
  { key: 'suit', label: 'Спортивный костюм', group: 'Экипировка' },
  { key: 'suit-fabric', label: 'Костюм: ткань', group: 'Экипировка' },
  { key: 'rain-front', label: 'Дождевик: спереди', group: 'Экипировка' },
  { key: 'rain-back', label: 'Дождевик: сзади', group: 'Экипировка' },
  { key: 'rain-fabric', label: 'Дождевик: ткань', group: 'Экипировка' },
  { key: 'rain-vent', label: 'Дождевик: вентиляция', group: 'Экипировка' },
];

export const defaultPhoto = (key: string) => `/img/${key}.jpg`;

const urls = new Map<string, string>(); // ключ → загруженная замена (data URL)
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());
let known: Promise<Set<string>> | null = null; // ключи, у которых есть замена
const inflight = new Set<string>();

const loadKnown = () =>
  (known ??= (async () => {
    const r = await supabase.from('club_photos').select('key');
    if (r.error) {
      known = null; // нет входа или сети: повторим при следующем показе
      return new Set<string>();
    }
    return new Set(((r.data ?? []) as { key: string }[]).map(x => x.key));
  })());

async function fetchOne(key: string) {
  if (urls.has(key) || inflight.has(key)) return;
  inflight.add(key);
  const r = await supabase.from('club_photos').select('data').eq('key', key).limit(1);
  inflight.delete(key);
  const d = ((r.data ?? []) as { data: string }[])[0]?.data;
  if (d) {
    urls.set(key, d);
    emit();
  }
}

/** Адрес фото: замена администратора, иначе файл из приложения. Без ключа возвращает undefined. */
export function usePhoto(key?: string): string | undefined {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick(n => n + 1);
    subs.add(f);
    if (key) void loadKnown().then(s => (s.has(key) ? fetchOne(key) : undefined));
    return () => void subs.delete(f);
  }, [key]);
  return key ? urls.get(key) ?? defaultPhoto(key) : undefined;
}

export function Photo({ name, alt, className }: { name: string; alt: string; className?: string }) {
  return <img className={className} src={usePhoto(name)} alt={alt} loading="lazy" />;
}

const errText = (m: string) =>
  m.includes('42501') || m.includes('forbidden') ? 'Менять фото может только администратор.'
  : m.includes('too large') ? 'Файл слишком большой. Выберите другое фото.'
  : m.includes('Could not find the function') || m.includes('schema cache') ? 'Редактор фото ещё не включён в базе (нужна миграция 0046).'
  : m;

/** Сохраняет замену фото; возвращает текст ошибки или null. */
export async function savePhoto(key: string, dataUrl: string): Promise<string | null> {
  const r = await supabase.rpc('club_photo_set', { k: key, d: dataUrl });
  if (r.error) return errText(r.error.message);
  urls.set(key, dataUrl);
  known = loadKnown().then(s => new Set(s).add(key));
  emit();
  return null;
}

/** Возвращает исходное фото из приложения. */
export async function resetPhoto(key: string): Promise<string | null> {
  const r = await supabase.rpc('club_photo_clear', { k: key });
  if (r.error) return errText(r.error.message);
  urls.delete(key);
  known = loadKnown().then(s => {
    const n = new Set(s);
    n.delete(key);
    return n;
  });
  emit();
  return null;
}

/** Только для тестов: сброс кэша. */
export function resetPhotoCache() {
  urls.clear();
  known = null;
  inflight.clear();
}

/** Уменьшает выбранный файл до JPEG не шире 1200 px; ошибка — текст для администратора. */
export async function shrinkImage(file: File, max = 1200): Promise<{ dataUrl: string } | { error: string }> {
  if (!file.type.startsWith('image/')) return { error: 'Выберите файл с фото (JPG или PNG).' };
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    for (const q of [0.82, 0.7, 0.55]) {
      const d = c.toDataURL('image/jpeg', q);
      if (d.length <= 880000) return { dataUrl: d };
    }
    return { error: 'Фото слишком тяжёлое. Выберите другое.' };
  } catch {
    return { error: 'Не удалось открыть файл. Попробуйте другое фото.' };
  }
}
