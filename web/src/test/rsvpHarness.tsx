import { useState } from 'react';
import { fake } from './fakeSupabase';
import { RsvpCreate, RsvpDetail, type Note } from '../screens/CoachRsvp';
import type { CoachGroup } from '../lib/coach';

// Форма создания матча с подтверждением и следующий за ней экран «Состав и ответы», как в CoachMatches после PR 3 (без отдельного списка)
export function CreateFlow({ groups, all = false, admin = false, onBack = () => {} }: { groups: CoachGroup[]; all?: boolean; admin?: boolean; onBack?: () => void }) {
  const [created, setCreated] = useState<{ id: string; note: Note } | null>(null);
  if (created) return <RsvpDetail id={created.id} groups={groups} admin={admin} note={created.note} onBack={onBack} />;
  return <RsvpCreate groups={groups} all={all} onBack={onBack} onCreated={(id, note) => setCreated({ id, note })} />;
}

// id матча из заголовка прежней строки списка «U9 · Олимп»
export function idOf(title: string): string {
  const m = (fake.db.matches as { id: string; team: string; opponent: string | null }[]).find(x => (x.opponent ? `${x.team} · ${x.opponent}` : `${x.team} · соперник не указан`) === title);
  if (!m) throw new Error(`нет матча «${title}»`);
  return m.id;
}
