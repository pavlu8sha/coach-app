import type { NavIcon } from '../ui/components';

export type CoachTab = 'sessions' | 'attendance' | 'ledger' | 'cmatches' | 'group' | 'home';
export interface CoachNavItem { value: CoachTab; label: string; icon: NavIcon }

// Нижняя панель тренера: «Занятия» — отметки, «Посещаемость» — статистика по группам, «Учёт» — кто и сколько проводил.
// Не больше пяти пунктов, как у администратора (MAX_BAR в adminMenu.ts плюс «Ещё»).
export const COACH_BAR: CoachNavItem[] = [
  { value: 'sessions', label: 'Занятия', icon: 'calendar' },
  { value: 'attendance', label: 'Посещаемость', icon: 'chart' },
  { value: 'ledger', label: 'Учёт', icon: 'clock' },
  { value: 'cmatches', label: 'Матчи', icon: 'trophy' },
  { value: 'group', label: 'Группа', icon: 'users' },
];

// Тренер, который ещё и родитель, получает «Ребёнка» вместо «Посещаемости»: оба раздела остаются во вкладке «Группа».
export function coachBar(hasKids: boolean): CoachNavItem[] {
  return hasKids ? COACH_BAR.map(it => (it.value === 'attendance' ? { value: 'home', label: 'Ребёнок', icon: 'child' } : it)) : COACH_BAR;
}
