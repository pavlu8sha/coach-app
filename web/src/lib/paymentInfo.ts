import { useEffect, useState } from 'react';
import { PAYMENT_DETAILS, PAYMENT_INFO_UPDATED, PAYMENT_RULES } from './clubInfo';
import { supabase } from './supabase';

// Реквизиты и правила оплаты (#239, миграция 0099): значения хранятся в таблице payment_info, правит администратор.
// Пока записи нет или база недоступна, показываются утверждённые значения из lib/clubInfo.

export interface PayDetail { label: string; value: string }
export interface PayRule { title: string; items: string[] }
export interface PaymentInfoData { details: PayDetail[]; rules: PayRule[]; updatedAt: string }

// Названия реквизитов фиксированы; копируются IBAN и имя получателя.
export const DETAIL_LABELS = PAYMENT_DETAILS.map(d => d.label);
export const COPY_LABELS = new Set(PAYMENT_DETAILS.filter(d => d.copy).map(d => d.label));

export const FALLBACK_PAYMENT_INFO: PaymentInfoData = {
  details: PAYMENT_DETAILS.map(({ label, value }) => ({ label, value })),
  rules: PAYMENT_RULES.map(r => ({ title: r.title, items: [...r.items] })),
  updatedAt: PAYMENT_INFO_UPDATED,
};

const isStr = (x: unknown): x is string => typeof x === 'string' && x.trim() !== '';

/** Проверяет строку из базы; при любой неполадке возвращает null, и показывается запасной вариант. */
export function parsePaymentInfo(row: { details?: unknown; rules?: unknown; updated_at?: unknown } | null | undefined): PaymentInfoData | null {
  if (!row || !Array.isArray(row.details) || !Array.isArray(row.rules)) return null;
  const details = row.details as { label?: unknown; value?: unknown }[];
  if (details.length !== DETAIL_LABELS.length || details.some((d, i) => !d || d.label !== DETAIL_LABELS[i] || !isStr(d.value))) return null;
  const rules = row.rules as { title?: unknown; items?: unknown }[];
  if (rules.length === 0 || rules.some(r => !r || !isStr(r.title) || !Array.isArray(r.items) || r.items.length === 0 || r.items.some(t => !isStr(t)))) return null;
  return {
    details: details.map(d => ({ label: d.label as string, value: d.value as string })),
    rules: rules.map(r => ({ title: r.title as string, items: [...(r.items as string[])] })),
    updatedAt: typeof row.updated_at === 'string' && row.updated_at ? row.updated_at : PAYMENT_INFO_UPDATED,
  };
}

/** Дата обновления для подписи: «2 ноября 2026» (время Тбилиси). */
export const updatedLabel = (stamp: string) => {
  const d = stamp.length > 10 ? new Date(stamp) : new Date(`${stamp}T12:00:00`);
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Tbilisi' });
};

export function usePaymentInfo(): PaymentInfoData & { loaded: boolean } {
  const [info, setInfo] = useState<PaymentInfoData>(FALLBACK_PAYMENT_INFO);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await supabase.from('payment_info').select('details, rules, updated_at').limit(1).maybeSingle();
      const parsed = r.error ? null : parsePaymentInfo(r.data as { details?: unknown; rules?: unknown; updated_at?: unknown } | null);
      if (!alive) return;
      if (parsed) setInfo(parsed);
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, []);
  return { ...info, loaded };
}
