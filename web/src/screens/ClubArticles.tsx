import { useEffect, useState } from 'react';
import { allowedAudiences, articleDate, articleExcerpt, safeHttpUrl, SECTION_EMPTY, SECTION_HINT, SECTION_LABEL, type ArticleSection, type ClubArticle } from '../lib/articles';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow } from '../ui/components';
import { BackNav } from '../ui/nav';
import { Failure, Loading } from './Message';

// Чтение статей клуба (#236). Права и аудиторию проверяет база; здесь дополнительно
// выбираются только опубликованные материалы своей аудитории, чтобы экран не зависел от RLS.
export default function ClubArticles({ role, onBack, section = 'article' }: { role: 'guest' | 'parent'; onBack: () => void; section?: ArticleSection }) {
  const [rows, setRows] = useState<ClubArticle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ClubArticle | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setRows(null);
    setError(null);
    void (async () => {
      const r = await supabase
        .from('club_articles')
        .select('*')
        .eq('status', 'published')
        .eq('section', section)
        .in('audience', allowedAudiences(role))
        .order('sort_order')
        .order('published_at', { ascending: false });
      if (!alive) return;
      if (r.error) setError(r.error.message);
      else setRows((r.data ?? []) as ClubArticle[]);
    })();
    return () => { alive = false; };
  }, [role, section, reload]);

  if (open) {
    const link = safeHttpUrl(open.link_url);
    return (
      <main className="page">
        <BackNav onBack={() => setOpen(null)} />
        <article className="ks-card">
          <h1>{open.title}</h1>
          <p className="muted">
            {open.author_name}
            {open.editor_name && open.editor_name !== open.author_name ? ` · редактор: ${open.editor_name}` : ''}
            {' · '}
            {articleDate(open.published_at ?? open.updated_at)}
          </p>
          <p style={{ whiteSpace: 'pre-wrap' }}>{open.body}</p>
          {link && (
            <a className="ks-btn secondary" href={link} target="_blank" rel="noreferrer noopener">
              {open.link_label?.trim() || 'Открыть ссылку'}
            </a>
          )}
        </article>
      </main>
    );
  }

  return (
    <main className="page">
      <BackNav onBack={onBack} />
      <h1>{section === 'article' ? 'Материалы клуба' : SECTION_LABEL[section]}</h1>
      <p className="muted">{SECTION_HINT[section]}</p>
      {rows === null && !error ? (
        <Loading rows={4} card />
      ) : error ? (
        <Failure embedded title="Не удалось загрузить материалы" text={error} onRetry={() => setReload(n => n + 1)} />
      ) : rows && rows.length === 0 ? (
        <EmptyState icon="box" title={section === 'article' ? 'Материалы скоро появятся' : 'Пока пусто'} text={SECTION_EMPTY[section]} />
      ) : (
        rows?.map(a => {
          const excerpt = articleExcerpt(a.body);
          return (
            <ListRow
              key={a.id}
              title={a.title}
              sub={excerpt ? [excerpt] : undefined}
              end={<span className="muted" style={{ fontSize: 12 }}>{articleDate(a.published_at ?? a.updated_at)}</span>}
              onClick={() => setOpen(a)}
            />
          );
        })
      )}
    </main>
  );
}
