import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fake, supabase } from '../test/fakeSupabase';
import ClubArticles, { resetArticlesCache } from './ClubArticles';

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
  beforeEach(() => { fake.reset(); resetArticlesCache(); });

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

  describe('ошибка фонового обновления (#736)', () => {
    const open = async (role: 'guest' | 'parent' = 'guest', section: 'article' | 'news' = 'article') => {
      const view = render(<ClubArticles role={role} section={section} onBack={() => undefined} />);
      return view;
    };
    // первое открытие раздела наполняет кэш, затем экран закрывается
    const prime = async (rows: ReturnType<typeof article>[], section: 'article' | 'news' = 'article') => {
      fake.db.club_articles = rows;
      const v = await open('guest', section);
      await screen.findByText(rows[0].title as string);
      v.unmount();
    };

    it('кэш и успешное обновление: список сразу из кэша, затем свежий, без предупреждения', async () => {
      await prime([article({ id: 'a1', title: 'Старая' })]);
      fake.db.club_articles = [article({ id: 'a1', title: 'Старая' }), article({ id: 'a2', title: 'Новая' })];
      await open();
      expect(screen.getByText('Старая')).toBeInTheDocument(); // сразу, до ответа
      expect(await screen.findByText('Новая')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('кэш и ошибка обновления: статьи остаются, неблокирующее предупреждение без техтекста, не «пусто»', async () => {
      await prime([article({ id: 'a1', title: 'Из кэша' })]);
      fake.errors.club_articles = 'JWT expired relation club_articles 42P01';
      await open();
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Не удалось обновить материалы');
      expect(alert).toHaveTextContent(/сохранённый список/);
      expect(screen.getByText('Из кэша')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/JWT|42P01|club_articles/);
      expect(screen.queryByText('Материалы скоро появятся')).toBeNull();
      expect(screen.queryByText('Не удалось загрузить материалы')).toBeNull();
    });

    it('кэш и ошибка: статья из кэша открывается', async () => {
      await prime([article({ id: 'a1', title: 'Из кэша', body: 'Текст из кэша.' })]);
      fake.errors.club_articles = 'сбой';
      await open();
      await screen.findByRole('alert');
      fireEvent.click(screen.getByText('Из кэша'));
      expect(await screen.findByText('Текст из кэша.')).toBeInTheDocument();
    });

    it('повтор: один запрос, кнопка отключена на время запроса, успех убирает предупреждение и обновляет список', async () => {
      await prime([article({ id: 'a1', title: 'Из кэша' })]);
      fake.errors.club_articles = 'сбой';
      await open();
      await screen.findByRole('alert');
      // следующий запрос «зависает»: тест решает, когда база ответит
      let release!: () => void;
      const gate = new Promise<void>(r => { release = r; });
      const realFrom = supabase.from;
      let requests = 0;
      supabase.from = (t: string) => {
        const q = realFrom(t);
        if (t !== 'club_articles') return q;
        requests++;
        const then = q.then.bind(q);
        q.then = (res: any, rej: any) => gate.then(() => then(res, rej));
        return q;
      };
      delete fake.errors.club_articles;
      fake.db.club_articles = [article({ id: 'a1', title: 'Из кэша' }), article({ id: 'a2', title: 'Свежая' })];
      try {
        fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
        const busy = screen.getByRole('button', { name: 'Обновляю…' });
        expect(busy).toBeDisabled();
        fireEvent.click(busy); // повторное нажатие во время запроса
        expect(screen.getByRole('alert')).toBeInTheDocument(); // предупреждение остаётся до результата
        expect(requests).toBe(1);
        release();
        expect(await screen.findByText('Свежая')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(requests).toBe(1);
      } finally {
        supabase.from = realFrom;
      }
    });

    it('повтор и снова ошибка: предупреждение остаётся, кнопка снова активна', async () => {
      await prime([article({ id: 'a1', title: 'Из кэша' })]);
      fake.errors.club_articles = 'сбой';
      await open();
      fireEvent.click(await screen.findByRole('button', { name: 'Повторить' }));
      expect(await screen.findByRole('button', { name: 'Повторить' })).toBeEnabled();
      expect(screen.getByRole('alert')).toHaveTextContent('Не удалось обновить материалы');
      expect(screen.getByText('Из кэша')).toBeInTheDocument();
    });

    it('в кэше пустой список и обновление не удалось: пустое состояние вместе с предупреждением, ошибка не скрыта', async () => {
      fake.db.club_articles = [];
      const v = await open();
      await screen.findByText('Материалы скоро появятся');
      v.unmount();
      fake.errors.club_articles = 'сбой';
      await open();
      expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось обновить материалы');
      expect(screen.getByText('Материалы скоро появятся')).toBeInTheDocument();
    });

    it('кэша нет и ошибка: полноценное состояние ошибки, повтор показывает список', async () => {
      fake.errors.club_articles = 'сбой сети';
      await open();
      expect(await screen.findByText('Не удалось загрузить материалы')).toBeInTheDocument();
      expect(screen.queryByText('Материалы скоро появятся')).toBeNull();
      delete fake.errors.club_articles;
      fake.db.club_articles = [article({ id: 'a1', title: 'После повтора' })];
      fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
      expect(await screen.findByText('После повтора')).toBeInTheDocument();
      expect(screen.queryByText('Не удалось загрузить материалы')).toBeNull();
    });

    it('ошибка раздела не показывается в другом разделе с кэшем', async () => {
      await prime([article({ id: 'n1', title: 'Новость', section: 'news' })], 'news');
      fake.errors.club_articles = 'сбой';
      const v = await open('guest', 'article'); // у статей кэша нет: полноценная ошибка
      expect(await screen.findByText('Не удалось загрузить материалы')).toBeInTheDocument();
      v.unmount();
      delete fake.errors.club_articles;
      fake.db.club_articles = [article({ id: 'n1', title: 'Новость', section: 'news' })];
      await open('guest', 'news');
      expect(await screen.findByText('Новость')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
});
