import { useEffect, useState } from 'react';
import { articleDate, AUDIENCE_LABEL, safeHttpUrl, SECTION_LABEL, STATUS_LABEL, type ArticleSection, type ClubArticle } from '../lib/articles';
import { supabase } from '../lib/supabase';
import ArticleEditor, { type ArticleDraft } from '../ui/ArticleEditor';
import { EmptyState, ListRow, Pill, Segmented } from '../ui/components';
import { BackNav } from '../ui/nav';
import { Failure, Loading } from './Message';

const TEMPLATES = ['Цели и принципы клуба', 'Правила клуба', 'Правила посещения', 'Полезная информация'];
const NOT_INSTALLED = 'Раздел ещё не установлен в базе (миграции 0111, 0113 и 0114).';

const errText = (message: string) =>
  message.includes('forbidden') ? 'Нет прав: материалы клуба может изменять только администратор.'
  : message.includes('bad url') ? 'Ссылка должна начинаться с http:// или https:// и не содержать пробелов.'
  : message.includes('bad article') ? 'Чтобы опубликовать материал, добавьте текст.'
  : message.includes('bad title') ? 'Нужен заголовок до 200 символов.'
  : message.includes('bad body') ? 'Текст слишком длинный.'
  : message.includes('bad order') ? 'Порядок должен быть целым числом от −1000 до 10000.'
  : message.includes('bad link label') ? 'Подпись ссылки слишком длинная.'
  : message.includes('slug busy') ? 'Этот код страницы уже занят.'
  : message.includes('Could not find the function') || message.includes('club_article_save') ? NOT_INSTALLED
  : 'Не удалось сохранить.';

const loadErr = (message: string) =>
  message.includes('club_articles') || message.includes('Could not find') ? NOT_INSTALLED : message;

// Управление материалами клуба (#236): редактирует только администратор, тренеры раздел не ведут.
// Права всё равно проверяет база; здесь только не показываем заведомо недоступное редактирование.
export default function AdminArticles() {
  const [rows, setRows] = useState<ClubArticle[] | null>(null);
  const [isAdmin, setAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ClubArticle | 'new' | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [section, setSection] = useState<ArticleSection>('article');

  useEffect(() => {
    let alive = true;
    setRows(null);
    setError(null);
    void (async () => {
      const user = await supabase.auth.getUser();
      const uid = user.data.user?.id ?? null;
      if (!alive) return;
      if (uid) {
        const u = await supabase.from('users').select('is_admin').eq('id', uid).maybeSingle();
        if (!alive) return;
        setAdmin(Boolean((u.data as { is_admin?: boolean } | null)?.is_admin));
      }
      const r = await supabase.from('club_articles').select('*').order('sort_order').order('updated_at', { ascending: false });
      if (!alive) return;
      if (r.error) setError(loadErr(r.error.message));
      else setRows((r.data ?? []) as ClubArticle[]);
    })();
    return () => { alive = false; };
  }, [reload]);

  const startNew = (title = '') => {
    if (!isAdmin) return;
    setNewTitle(title);
    setEditing('new');
    setEditorError(null);
    setMsg(null);
  };
  const startEdit = (article: ClubArticle) => {
    if (!isAdmin) return;
    setEditing(article);
    setEditorError(null);
    setMsg(null);
  };
  const cancel = () => {
    setEditing(null);
    setNewTitle('');
    setEditorError(null);
  };

  const save = async (draft: ArticleDraft) => {
    if (!isAdmin) return;
    const link = safeHttpUrl(draft.linkUrl);
    const current = editing === 'new' ? null : editing;
    setBusy(true);
    setEditorError(null);
    const r = await supabase.rpc('club_article_save', {
      p_id: current?.id ?? null,
      p_title: draft.title,
      p_body: draft.body,
      p_audience: draft.audience,
      p_status: draft.status,
      p_sort_order: draft.sortOrder,
      p_link_url: link,
      p_link_label: link ? draft.linkLabel : null,
      p_slug: current?.slug ?? null,
      p_section: current?.section ?? section,
    });
    setBusy(false);
    if (r.error) {
      setEditorError(errText(r.error.message));
      return;
    }
    setEditing(null);
    setNewTitle('');
    setMsg('Сохранено.');
    setReload(n => n + 1);
  };

  if (editing) {
    const initial = editing === 'new' ? { title: newTitle, status: 'draft' as const } : editing;
    return (
      <main className="page">
        <BackNav onBack={cancel} />
        <h1>{editing === 'new' ? 'Новый материал' : 'Редактирование материала'}</h1>
        <ArticleEditor initial={initial} busy={busy} error={editorError} onSave={d => void save(d)} onCancel={cancel} />
      </main>
    );
  }

  if (rows === null && !error) return <Loading title="Материалы клуба" rows={4} avatar={false} card />;
  if (error) return <Failure title="Не удалось загрузить материалы" text={error} onRetry={() => setReload(n => n + 1)} />;

  const shown = (rows ?? []).filter(a => (a.section ?? 'article') === section);

  return (
    <main className="page">
      <h1>Материалы клуба</h1>
      <p className="muted">Цели, правила и полезная информация. Статью видит выбранная аудитория; черновики — только администратор.</p>
      {msg && <p className="ks-ok" role="status">{msg}</p>}
      <Segmented
        label="Раздел"
        value={section}
        onChange={setSection}
        items={(['article', 'news', 'tournaments'] as ArticleSection[]).map(v => ({ value: v, label: SECTION_LABEL[v] }))}
      />
      {isAdmin && <button type="button" className="ks-btn" onClick={() => startNew()}>{section === 'news' ? 'Создать публикацию' : section === 'tournaments' ? 'Создать текст' : 'Создать статью'}</button>}
      {rows && shown.length === 0 ? (
        <>
          <EmptyState icon="box" title="Пока нет материалов" text={isAdmin ? 'Создайте черновик и заполните текст. Официальные правила и факты публикуйте только после подтверждения владельцем.' : 'Материалов пока нет.'} />
          {isAdmin && section === 'article' && (
            <>
              <p className="ks-label">Пустые шаблоны</p>
              {TEMPLATES.map(t => <ListRow key={t} title={t} sub={['Черновик без текста']} onClick={() => startNew(t)} />)}
            </>
          )}
        </>
      ) : (
        shown.map(a => {
          const editable = isAdmin;
          return (
            <ListRow
              key={a.id}
              title={a.title}
              sub={[
                `${AUDIENCE_LABEL[a.audience]} · ${a.author_name}`,
                editable ? `Обновлено ${articleDate(a.updated_at)}` : 'Изменить может только администратор',
              ]}
              end={<Pill tone={a.status === 'published' ? 'success' : 'neutral'}>{STATUS_LABEL[a.status]}</Pill>}
              onClick={editable ? () => startEdit(a) : undefined}
            />
          );
        })
      )}
    </main>
  );
}
