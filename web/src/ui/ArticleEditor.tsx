import { useState } from 'react';
import { useDirtyGuard } from '../nav';
import { articleDate, safeHttpUrl, type ArticleAudience, type ArticleStatus } from '../lib/articles';
import { Segmented } from './components';

export interface ArticleDraft {
  title: string;
  body: string;
  audience: ArticleAudience;
  status: ArticleStatus;
  sortOrder: number;
  linkUrl: string | null;
  linkLabel: string | null;
}

interface InitialArticle {
  title?: string;
  body?: string;
  audience?: ArticleAudience;
  status?: ArticleStatus;
  sort_order?: number;
  link_url?: string | null;
  link_label?: string | null;
  author_name?: string | null;
  editor_name?: string | null;
  updated_at?: string | null;
}

// Общий редактор материалов для статей #236, публикаций #237 и текста о турнирах #234.
// Текст хранится и выводится как обычный текст: HTML не поддерживается, поэтому XSS невозможен.
export default function ArticleEditor(props: {
  initial?: InitialArticle;
  busy?: boolean;
  error?: string | null;
  onSave: (draft: ArticleDraft) => void;
  onCancel: () => void;
}) {
  const { initial } = props;
  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [audience, setAudience] = useState<ArticleAudience>(initial?.audience ?? 'both');
  const [status, setStatus] = useState<ArticleStatus>(initial?.status ?? 'draft');
  const [order, setOrder] = useState(String(initial?.sort_order ?? 100));
  const [linkUrl, setLinkUrl] = useState(initial?.link_url ?? '');
  const [linkLabel, setLinkLabel] = useState(initial?.link_label ?? '');

  useDirtyGuard(
    title !== (initial?.title ?? '') || body !== (initial?.body ?? '') || audience !== (initial?.audience ?? 'both') || status !== (initial?.status ?? 'draft') ||
    order !== String(initial?.sort_order ?? 100) || linkUrl !== (initial?.link_url ?? '') || linkLabel !== (initial?.link_label ?? ''),
  );
  const orderNumber = Number(order);
  const safeLink = safeHttpUrl(linkUrl);
  const linkInvalid = linkUrl.trim() !== '' && !safeLink;
  const labelInvalid = linkLabel.trim() !== '' && !safeLink;
  const orderInvalid = !Number.isInteger(orderNumber) || orderNumber < -1000 || orderNumber > 10000;
  const invalid = !title.trim() || (status === 'published' && !body.trim()) || linkInvalid || labelInvalid || orderInvalid;

  const author = initial?.author_name?.trim();
  const editor = initial?.editor_name?.trim();
  const save = () => {
    if (invalid || props.busy) return;
    props.onSave({
      title: title.trim(),
      body,
      audience,
      status,
      sortOrder: orderNumber,
      linkUrl: safeLink,
      linkLabel: safeLink && linkLabel.trim() ? linkLabel.trim() : null,
    });
  };

  return (
    <>
      <p className="muted" style={{ marginBottom: 12 }}>
        Текст выводится как обычный текст: HTML не поддерживается. Ссылка — только http:// или https://. Официальные правила и факты публикуйте только после подтверждения владельцем.
      </p>
      {author && (
        <p className="muted">
          Автор: {author}
          {editor && editor !== author ? ` · Редактор: ${editor}` : ''}
          {initial?.updated_at ? ` · Обновлено: ${articleDate(initial.updated_at)}` : ''}
        </p>
      )}
      <label className="field">
        Заголовок
        <input value={title} maxLength={200} onChange={e => setTitle(e.target.value)} />
      </label>
      <label className="field">
        Текст
        <textarea rows={10} maxLength={20000} value={body} onChange={e => setBody(e.target.value)} />
      </label>
      <p className="ks-label">Аудитория</p>
      <Segmented
        label="Аудитория материала"
        value={audience}
        onChange={setAudience}
        items={[
          { value: 'guest', label: 'Гостям' },
          { value: 'parent', label: 'Родителям' },
          { value: 'both', label: 'Всем' },
        ]}
      />
      <p className="ks-label">Статус</p>
      <Segmented
        label="Статус публикации"
        value={status}
        onChange={setStatus}
        items={[
          { value: 'draft', label: 'Черновик' },
          { value: 'published', label: 'Опубликовано' },
        ]}
      />
      {status === 'published' && !body.trim() && <p className="error">Чтобы опубликовать материал, добавьте текст.</p>}
      <label className="field">
        Порядок показа
        <input type="number" min={-1000} max={10000} step={10} value={order} onChange={e => setOrder(e.target.value)} />
      </label>
      {orderInvalid && <p className="error">Порядок должен быть целым числом от −1000 до 10000.</p>}
      <label className="field">
        Ссылка (необязательно)
        <input type="text" inputMode="url" maxLength={1000} placeholder="https://t.me/fc_kickstart_tbs" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} />
      </label>
      {linkInvalid && <p className="error">Ссылка должна начинаться с http:// или https:// и не содержать пробелов.</p>}
      <label className="field">
        Подпись ссылки
        <input maxLength={120} value={linkLabel} onChange={e => setLinkLabel(e.target.value)} placeholder="Открыть в Telegram" />
      </label>
      {labelInvalid && <p className="error">Подпись нужна только вместе с безопасной ссылкой.</p>}
      {props.error && <p className="error" role="alert">{props.error}</p>}
      <button type="button" className="ks-btn" disabled={props.busy || invalid} onClick={save}>
        {props.busy ? 'Сохраняю…' : 'Сохранить'}
      </button>
      <div style={{ height: 8 }} />
      <button type="button" className="ks-btn secondary" disabled={props.busy} onClick={props.onCancel}>
        Отмена
      </button>
    </>
  );
}
