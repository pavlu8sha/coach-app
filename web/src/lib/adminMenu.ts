import type { NavIcon } from '../ui/components';

export type SectionId =
  | 'sessions' | 'players' | 'money' | 'cmatches' | 'requests' | 'ind' | 'extra' | 'schedule'
  | 'equip' | 'camps' | 'photos' | 'leads' | 'stats' | 'tlog' | 'points' | 'coaches'
  | 'prices' | 'pstart' | 'recalc' | 'menu';

export interface Section { id: SectionId; title: string; sub: string; icon: NavIcon; group: string }

// Все разделы администратора. Порядок здесь — порядок в «Ещё»; на нижнюю панель администратор выносит их в «Ещё → Меню».
export const SECTIONS: Section[] = [
  { id: 'sessions', title: 'Отметки', sub: 'Посещаемость по группам и занятиям', icon: 'calendar', group: 'Основное' },
  { id: 'players', title: 'Игроки', sub: 'Список, карточки, статус оплаты', icon: 'users', group: 'Основное' },
  { id: 'money', title: 'Оплаты', sub: 'Приём оплат, за месяц, платежи, должники', icon: 'wallet', group: 'Основное' },
  { id: 'cmatches', title: 'Матчи', sub: 'События, матчи, составы и взносы', icon: 'trophy', group: 'Основное' },
  { id: 'requests', title: 'Запросы', sub: 'Связи родителей с детьми, согласия, родители по группам', icon: 'inbox', group: 'Основное' },
  { id: 'ind', title: 'Индивидуальные', sub: 'Вратари и индивидуальные: запись, оплата, долги', icon: 'user', group: 'Занятия' },
  { id: 'extra', title: 'Дополнительные', sub: 'Доп. тренировки: запись, оплата, долги', icon: 'calendar', group: 'Занятия' },
  { id: 'schedule', title: 'Расписание', sub: 'Тренировки всех групп, правка слотов', icon: 'calendar', group: 'Занятия' },
  { id: 'equip', title: 'Экипировка', sub: 'Заказы, оплата, выдача, каталог', icon: 'inbox', group: 'Клуб' },
  { id: 'camps', title: 'Сборы', sub: 'Лагеря и сборы: участники, тарифы, платежи', icon: 'trophy', group: 'Клуб' },
  { id: 'photos', title: 'Фото клуба', sub: 'Заменить фото в «О клубе» и экипировке', icon: 'user', group: 'Клуб' },
  { id: 'leads', title: 'Заявки', sub: 'Новые родители из бота «Хочу в KickStart»', icon: 'inbox', group: 'Клуб' },
  { id: 'stats', title: 'Статистика', sub: 'Посещаемость и матчи за период', icon: 'users', group: 'Тренеры и игроки' },
  { id: 'tlog', title: 'Учёт тренеров', sub: 'Проведённые тренировки и часы по месяцам', icon: 'users', group: 'Тренеры и игроки' },
  { id: 'points', title: 'Баллы игроков', sub: 'Ручные баллы, история, контакты родителей', icon: 'trophy', group: 'Тренеры и игроки' },
  { id: 'coaches', title: 'Тренеры', sub: 'Назначение групп тренерам', icon: 'users', group: 'Тренеры и игроки' },
  { id: 'prices', title: 'Цены', sub: 'Абонемент и индивидуальные занятия по месяцам', icon: 'wallet', group: 'Настройки' },
  { id: 'pstart', title: 'Старт подсчёта баллов', sub: 'С какой даты баллы видны родителям и тренерам', icon: 'calendar', group: 'Настройки' },
  { id: 'recalc', title: 'Пересчёт баллов за матчи', sub: 'Привести баллы к новой схеме', icon: 'trophy', group: 'Настройки' },
  { id: 'menu', title: 'Меню', sub: 'Что на нижней панели, а что в «Ещё»', icon: 'more', group: 'Настройки' },
];

export const MENU_KEY = 'admin_menu';
export const MAX_BAR = 4; // плюс «Ещё» — пять пунктов, как помещается в телефон
export const DEFAULT_BAR: SectionId[] = ['sessions', 'players', 'money', 'cmatches'];

export const sectionById = (id: string): Section | undefined => SECTIONS.find(s => s.id === id);
export const isSection = (id: string): id is SectionId => SECTIONS.some(s => s.id === id);

// Нижняя панель из сохранённой настройки; при любой неполадке — панель по умолчанию
export function parseBar(value: string | null | undefined): SectionId[] {
  if (!value) return DEFAULT_BAR;
  try {
    const raw = (JSON.parse(value) as { bar?: unknown }).bar;
    if (!Array.isArray(raw)) return DEFAULT_BAR;
    const bar = [...new Set(raw.filter((x): x is SectionId => typeof x === 'string' && isSection(x) && x !== 'menu'))].slice(0, MAX_BAR);
    return bar.length ? bar : DEFAULT_BAR;
  } catch {
    return DEFAULT_BAR;
  }
}
