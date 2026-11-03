import type { NavIcon } from '../ui/components';

export type CoachTab = 'sessions' | 'attendance' | 'ledger' | 'cmatches' | 'group' | 'content' | 'home';
export interface CoachNavItem { value: CoachTab; label: string; icon: NavIcon }

// Нижняя панель тренера: «Занятия» — отметки, «Посещаемость» — статистика по группам, «Учёт» — кто и сколько проводил.
// «Статьи» — общий редактор материалов клуба (#236); тренер правит только свои материалы.
export const COACH_BAR: CoachNavItem[] = [
  { value: 'sessions', label: 'Занятия', icon: 'calendar' },
  { value: 'cmatches', label: 'Матчи', icon: 'trophy' },
  { value: 'attendance', label: 'Посещаемость', icon: 'chart' },
  { value: 'ledger', label: 'Учёт', icon: 'clock' },
  { value: 'group', label: 'Группа', icon: 'users' },
  { value: 'content', label: 'Статьи', icon: 'inbox' },
];

// Тренер, который ещё и родитель, получает «Ребёнка» вместо «Посещаемости».
export function coachBar(hasKids: boolean): CoachNavItem[] {
  return hasKids ? COACH_BAR.map(it => (it.value === 'attendance' ? { value: 'home', label: 'Ребёнок', icon: 'child' } : it)) : COACH_BAR;
}
