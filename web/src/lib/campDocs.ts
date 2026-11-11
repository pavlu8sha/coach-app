import { SUPABASE_URL, supabase } from './supabase';

// Документы сбора: загрузка и короткоживущая ссылка идут через Edge Function camp-docs (Issue #470, этап 5).
// Права проверяет база от имени пользователя; здесь только проверка файла до отправки и вызовы функции.
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

/** Проверка файла до отправки: только PDF до 10 МБ. Содержимое всё равно проверяет сервер. */
export function checkPdfFile(f: { name: string; type: string; size: number }): string | null {
  const isPdf = f.type === 'application/pdf' || (f.type === '' && /\.pdf$/i.test(f.name));
  if (!isPdf) return 'Нужен файл PDF.';
  if (f.size <= 0) return 'Файл пустой.';
  if (f.size > MAX_PDF_BYTES) return 'Файл больше 10 МБ.';
  return null;
}

async function headers(extra: Record<string, string>): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  return { ...extra, Authorization: `Bearer ${data.session?.access_token ?? ''}`, ...(key ? { apikey: key } : {}) };
}

type Out<T> = { ok: true; data: T } | { ok: false; error: string };

async function read<T>(res: Response): Promise<Out<T>> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  return res.ok ? { ok: true, data: body } : { ok: false, error: body.error ?? `http ${res.status}` };
}

/** Загрузка новой версии (replaces: версия заменяемого документа). */
export async function uploadCampDoc(o: { camp: string; title: string; replaces?: string | null; file: File }): Promise<Out<{ id: string }>> {
  const q = `action=upload&camp=${encodeURIComponent(o.camp)}&title=${encodeURIComponent(o.title.trim())}${o.replaces ? `&replaces=${encodeURIComponent(o.replaces)}` : ''}`;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/camp-docs?${q}`, { method: 'POST', headers: await headers({ 'Content-Type': 'application/pdf' }), body: o.file });
    return await read<{ id: string }>(res);
  } catch {
    return { ok: false, error: 'network' };
  }
}

/** Ссылка на файл, живёт 60 секунд. */
export async function campDocLink(id: string): Promise<Out<{ url: string }>> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/camp-docs`, { method: 'POST', headers: await headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ action: 'link', id }) });
    return await read<{ url: string }>(res);
  } catch {
    return { ok: false, error: 'network' };
  }
}
