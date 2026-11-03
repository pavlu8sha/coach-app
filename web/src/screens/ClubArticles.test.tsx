import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import ClubArticles from './ClubArticles';

const article = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  slug: null,
  title: 'Both',
  body: 'Общий текст.',
  section: 'article',
  audience: 'both',
  status: 'published',
  sort_order: 1,
  author_id: 'coach',
  author_name: 'Coach One',
  editor_id: 'coach',
  editor_name: 'Coach One',
  link_url: null,
  link_label: null,
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-03T10:00:00Z',
  published_at: '2026-11-03T10:00:00Z',
  ...over,
});

describe('Чтение материалов клуба (#236)', () => {
  beforeEach(() => fake.reset());

  it('гость видит общие и гостевые статьи, но не родительские и не черновики', async () => {
    fake.db.club_articles = [
      article({ id: 'g', title: 'Guest only', audience: 'guest' }),
      article({ id: 'b', title: 'Both' }),
      article({ id: 'p', title: 'Parent only', audience: 'parent' }),
      article({ id: 'd', title: 'Draft', status: 'draft', audience: 'both' }),
    ];
    render(<ClubArticles role="guest" onBack={() => undefined} />);
    expect(await screen.findByText('Guest only')).toBeInTheDocument();
    expect(screen.getByText('Both')).toBeInTheDocument();
    expect(screen.queryByText('Parent only')).toBeNull();
    expect(screen.queryByText('Draft')).toBeNull();
  });

  it('родитель видит родительские и общие статьи, но не гостевые', async () => {
    fake.db.club_articles = [
      article({ id: 'g', title: 'Guest only', audience: 'guest' }),
      article({ id: 'b', title: 'Both' }),
      article({ id: 'p', title: 'Parent only', audience: 'parent' }),
    ];
    render(<ClubArticles role="parent" onBack={() => undefined} />);
    expect(await screen.findByText('Parent only')).toBeInTheDocument();
    expect(screen.getByText('Both')).toBeInTheDocument();
    expect(screen.queryByText('Guest only')).toBeNull();
  });

  it('открывает статью, показывает автора, дату и безопасную ссылку', async () => {
    fake.db.club_articles = [article({ link_url: 'https://t.me/fc_kickstart_tbs/1083', link_label: 'Телеграм' })];
    render(<ClubArticles role="guest" onBack={() => undefined} />);
    fireEvent.click(await screen.findByText('Both'));
    expect(await screen.findByRole('heading', { name: 'Both' })).toBeInTheDocument();
    expect(screen.getByText('Общий текст.')).toBeInTheDocument();
    expect(screen.getByText(/Coach One/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Телеграм' })).toHaveAttribute('href', 'https://t.me/fc_kickstart_tbs/1083');
  });

  it('не выполняет HTML из текста и не рисует небезопасную ссылку', async () => {
    fake.db.club_articles = [article({ body: '<img src=x onerror="alert(1)">', link_url: 'javascript:alert(1)' })];
    render(<ClubArticles role="guest" onBack={() => undefined} />);
    fireEvent.click(await screen.findByText('Both'));
    expect(await screen.findByText('<img src=x onerror="alert(1)">')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Открыть ссылку' })).toBeNull();
  });

  it('без опубликованных статей показывает безопасное пустое состояние', async () => {
    fake.db.club_articles = [article({ status: 'draft' })];
    render(<ClubArticles role="guest" onBack={() => undefined} />);
    expect(await screen.findByText('Материалы скоро появятся')).toBeInTheDocument();
  });

  it('новости и турниры читаются отдельно от статей и с той же аудиторией', async () => {
    fake.db.club_articles = [
      article({ id: 's1', title: 'Статья', section: 'article' }),
      article({ id: 'n1', title: 'Новость родителям', section: 'news', audience: 'parent' }),
      article({ id: 'n2', title: 'Новость всем', section: 'news', audience: 'both' }),
      article({ id: 't1', title: 'Про турниры', section: 'tournaments', audience: 'both' }),
    ];
    const { unmount } = render(<ClubArticles role="guest" section="news" onBack={() => undefined} />);
    expect(await screen.findByText('Новость всем')).toBeInTheDocument();
    expect(screen.queryByText('Новость родителям')).toBeNull();
    expect(screen.queryByText('Статья')).toBeNull();
    expect(screen.queryByText('Про турниры')).toBeNull();
    unmount();
    render(<ClubArticles role="parent" section="tournaments" onBack={() => undefined} />);
    expect(await screen.findByText('Про турниры')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Турниры и матчи' })).toBeInTheDocument();
  });
});
