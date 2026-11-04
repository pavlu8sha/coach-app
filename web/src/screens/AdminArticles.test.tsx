import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import AdminArticles from './AdminArticles';

const article = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  slug: null,
  title: 'My article',
  body: 'Text',
  audience: 'both',
  status: 'draft',
  sort_order: 100,
  author_id: 'u',
  author_name: 'Coach',
  editor_id: 'u',
  editor_name: 'Coach',
  link_url: null,
  link_label: null,
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-03T10:00:00Z',
  published_at: null,
  section: 'article',
  ...over,
});

describe('Редактор материалов клуба (#236)', () => {
  beforeEach(() => {
    fake.reset();
    fake.db.users = [{ id: 'u', is_admin: true }];
    fake.db.club_articles = [article()];
    fake.rpc.club_article_save = () => 'a1';
  });

  it('без прав материалы доступны только для чтения', async () => {
    fake.db.users = [{ id: 'u', is_admin: false }];
    fake.db.club_articles = [
      article({ id: 'mine', title: 'My article', author_id: 'u' }),
      article({ id: 'other', title: 'Other article', author_id: 'someone' }),
    ];
    render(<AdminArticles />);
    expect(await screen.findByText('My article')).toBeInTheDocument();
    expect(screen.getByText('Other article')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /My article/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Other article/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Создать статью' })).toBeNull();
    expect(screen.getAllByText('Изменить может только администратор')).toHaveLength(2);
  });

  it('администратор редактирует любую статью', async () => {
    fake.db.users = [{ id: 'u', is_admin: true }];
    fake.db.club_articles = [article({ id: 'other', title: 'Other article', author_id: 'someone' })];
    render(<AdminArticles />);
    expect(await screen.findByRole('button', { name: /Other article/ })).toBeInTheDocument();
  });

  it('создаёт новый черновик через общий редактор', async () => {
    render(<AdminArticles />);
    await screen.findByRole('button', { name: /My article/ });
    fireEvent.click(screen.getByRole('button', { name: 'Создать статью' }));
    fireEvent.change(screen.getByLabelText('Заголовок'), { target: { value: 'Новая статья' } });
    fireEvent.change(screen.getByLabelText('Текст'), { target: { value: 'Новый текст.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(fake.rpcCalls('club_article_save')).toHaveLength(1));
    expect(fake.rpcCalls('club_article_save')[0]).toMatchObject({
      p_id: null,
      p_title: 'Новая статья',
      p_body: 'Новый текст.',
      p_audience: 'both',
      p_status: 'draft',
      p_sort_order: 100,
      p_link_url: null,
      p_link_label: null,
      p_slug: null,
      p_section: 'article',
    });
    expect(await screen.findByText('Сохранено.')).toBeInTheDocument();
  });

  it('новость создаётся в своём разделе и не смешивается со статьями', async () => {
    fake.db.club_articles = [article({ id: 'a', title: 'Статья клуба' }), article({ id: 'n', title: 'Новость дня', section: 'news' })];
    render(<AdminArticles />);
    await screen.findByRole('button', { name: /Статья клуба/ });
    expect(screen.queryByText('Новость дня')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Новости' }));
    expect(await screen.findByRole('button', { name: /Новость дня/ })).toBeInTheDocument();
    expect(screen.queryByText('Статья клуба')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Создать публикацию' }));
    fireEvent.change(screen.getByLabelText('Заголовок'), { target: { value: 'Свежая новость' } });
    fireEvent.change(screen.getByLabelText('Текст'), { target: { value: 'Текст.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(fake.rpcCalls('club_article_save')).toHaveLength(1));
    expect(fake.rpcCalls('club_article_save')[0]).toMatchObject({ p_title: 'Свежая новость', p_section: 'news' });
  });

  it('публикация требует текст, а опасная ссылка не отправляется', async () => {
    render(<AdminArticles />);
    await screen.findByRole('button', { name: /My article/ });
    fireEvent.click(screen.getByRole('button', { name: 'Создать статью' }));
    fireEvent.change(screen.getByLabelText('Заголовок'), { target: { value: 'Публикация' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Опубликовано' }));
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Текст'), { target: { value: 'Текст статьи.' } });
    fireEvent.change(screen.getByLabelText('Ссылка (необязательно)'), { target: { value: 'javascript:alert(1)' } });
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Ссылка (необязательно)'), { target: { value: 'https://t.me/fc_kickstart_tbs' } });
    expect(screen.getByRole('button', { name: 'Сохранить' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(fake.rpcCalls('club_article_save')).toHaveLength(1));
    expect(fake.rpcCalls('club_article_save')[0]).toMatchObject({
      p_status: 'published',
      p_link_url: 'https://t.me/fc_kickstart_tbs',
    });
  });

  it('пустой шаблон подставляет только название, без выдуманных правил', async () => {
    fake.db.club_articles = [];
    render(<AdminArticles />);
    fireEvent.click(await screen.findByRole('button', { name: /Цели и принципы клуба/ }));
    expect(screen.getByLabelText('Заголовок')).toHaveValue('Цели и принципы клуба');
    expect(screen.getByLabelText('Текст')).toHaveValue('');
  });

  it('ошибка прав объясняется понятным текстом', async () => {
    fake.rpc.club_article_save = () => ({ error: { message: 'forbidden' } });
    render(<AdminArticles />);
    await screen.findByRole('button', { name: /My article/ });
    fireEvent.click(screen.getByRole('button', { name: /My article/ }));
    fireEvent.change(screen.getByLabelText('Заголовок'), { target: { value: 'Чужая' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText(/материалы клуба может изменять только администратор/)).toBeInTheDocument();
  });

  it('ошибка загрузки подсказывает актуальные миграции', async () => {
    fake.errors.club_articles = 'Could not find the table public.club_articles';
    render(<AdminArticles />);
    expect(await screen.findByText(/миграции 0111, 0113 и 0114/)).toBeInTheDocument();
  });
});
