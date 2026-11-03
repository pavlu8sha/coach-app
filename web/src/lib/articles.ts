export type ArticleAudience = 'guest' | 'parent' | 'both';
export type ArticleStatus = 'draft' | 'published';
export type ArticleSection = 'article' | 'news' | 'tournaments';

export interface ClubArticle {
  id: string;
  slug: string | null;
  section: ArticleSection;
  title: string;
  body: string;
  audience: ArticleAudience;
  status: ArticleStatus;
  sort_order: number;
  author_id: string | null;
  author_name: string;
  editor_id: string | null;
  editor_name: string | null;
  link_url: string | null;
  link_label: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export const AUDIENCE_LABEL: Record<ArticleAudience, string> = {
  guest: 'Гостям',
  parent: 'Родителям',
  both: 'Всем',
};

export const STATUS_LABEL: Record<ArticleStatus, string> = {
  draft: 'Черновик',
  published: 'Опубликовано',
};

/** Аудитории, которые видит читатель. Общие статьи видят все. */
export function allowedAudiences(role: 'guest' | 'parent'): ArticleAudience[] {
  return role === 'parent' ? ['parent', 'both'] : ['guest', 'both'];
}

/** Ссылка выводится только если это абсолютный http(s)-адрес без пробелов и управляющих символов. */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function articleExcerpt(body: string, max = 140): string {
  const text = body.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

export function articleDate(value: string | null | undefined): string {
  if (!value) return '';
  const date = value.length > 10 ? new Date(value) : new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Tbilisi' });
}

export const SECTION_LABEL: Record<ArticleSection, string> = {
  article: 'Статьи',
  news: 'Новости',
  tournaments: 'Турниры и матчи',
};

export const SECTION_HINT: Record<ArticleSection, string> = {
  article: 'Цели, правила и полезная информация',
  news: 'Публикации клуба с указанием автора',
  tournaments: 'Турниры, товарищеские матчи и как участвовать',
};

export const SECTION_EMPTY: Record<ArticleSection, string> = {
  article: 'Администратор клуба ещё не опубликовал материалы.',
  news: 'Новостей пока нет.',
  tournaments: 'Информация о турнирах и матчах появится позже.',
};
