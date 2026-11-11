import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import About from './About';

describe('«О клубе» для гостя', () => {
  const open = (name: RegExp | string) => fireEvent.click(screen.getByRole('button', { name }));

  it('главный экран: плитки разделов, запись на пробную и канал', () => {
    render(<About role="guest" onChangeRole={() => undefined} />);
    expect(screen.getByText('2–9 января · Hotel Surami')).toBeInTheDocument();
    for (const t of [/Winter Camp 2027/, /^Филиалы/, /^Чемпионаты/, /^Индивидуальные/, /^Вратарские/]) {
      expect(screen.getByRole('button', { name: t })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Записаться на пробную' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Наш канал/ })).toHaveAttribute('href', 'https://t.me/fc_kickstart_tbs');
    // подробности спрятаны в разделах, а не на главном экране
    expect(screen.queryByText(/525 GEL вместо 620/)).toBeNull();
  });

  it('гость не видит экипировку, родитель видит все плитки гостя (#234)', () => {
    const { unmount } = render(<About role="guest" onChangeRole={() => undefined} />);
    expect(screen.queryByRole('button', { name: /^Экипировка/ })).toBeNull();
    unmount();
    render(<About role="parent" onChangeRole={() => undefined} onBack={() => undefined} />);
    expect(screen.getByRole('button', { name: /^Экипировка/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Филиалы/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Сменить роль' })).toBeNull();
  });

  it('гостю открываются материалы клуба и возвращаются назад', async () => {
    fake.db.club_articles = [];
    render(<About role="guest" onChangeRole={() => undefined} />);
    open(/^Материалы клуба/);
    expect(await screen.findByRole('heading', { name: 'Материалы клуба' })).toBeInTheDocument();
    expect(await screen.findByText('Материалы скоро появятся')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.getByRole('button', { name: /^Материалы клуба/ })).toBeInTheDocument();
  });

  it('раздел «Филиалы» и возврат назад', () => {
    render(<About role="guest" onChangeRole={() => undefined} />);
    open(/^Филиалы/);
    expect(screen.getByRole('heading', { name: 'Филиалы' })).toBeInTheDocument();
    expect(screen.getByText('Red Garden')).toBeInTheDocument();
    const maps = screen.getAllByRole('link', { name: 'Открыть на карте' });
    expect(maps).toHaveLength(3);
    expect(maps[0]).toHaveAttribute('href', 'https://www.google.com/maps?q=41.724328,44.755409');
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.getByRole('button', { name: /^Филиалы/ })).toBeInTheDocument();
  });

  it('чемпионаты, индивидуальные, вратарские, экипировка и сборы открываются отдельно', () => {
    render(<About role="guest" onChangeRole={() => undefined} />);
    const back = () => fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    open(/^Чемпионаты/);
    expect(screen.getByRole('heading', { name: 'Чемпионаты сезона 2026/27' })).toBeInTheDocument();
    expect(screen.getByText('Tbilisi Challenge Cup')).toBeInTheDocument();
    back();
    open(/^Индивидуальные/);
    expect(screen.getByRole('heading', { name: 'Индивидуальные тренировки' })).toBeInTheDocument();
    expect(screen.getByText('Суббота — 19:00')).toBeInTheDocument();
    back();
    open(/^Вратарские/);
    expect(screen.getByRole('heading', { name: 'Вратарские тренировки' })).toBeInTheDocument();
    back();
    open(/Winter Camp 2027/);
    // одна лента секций без вкладок, содержание из презентации Surami (docs/CAMP_GUEST_SECTION_ACCEPTANCE.md, условия 2-8)
    expect(screen.queryByRole('tab')).toBeNull();
    for (const h of ['Новый год в Сурами', 'Тренировочная программа', 'Hotel Surami', 'Программа по возрастам', 'Жизнь команды', 'Для всей семьи', 'Результат и опыт', 'Участие и стоимость']) {
      expect(screen.getAllByText(h).length).toBeGreaterThan(0);
    }
    for (const h of ['Зимняя атмосфера. Футбольный характер.', '7 дней в режиме футболиста', 'Всё для тренировок и восстановления', 'Каждому возрасту — свои задачи', 'Не только тренировки', 'Ребёнок — в команде. Родители — рядом.', 'Больше, чем неделя футбола', 'Выберите свой формат поездки']) {
      expect(screen.getByRole('heading', { name: h })).toBeInTheDocument();
    }
    for (const g of ['U6–7', 'U8–U9', 'U10–U11', 'U12–U13']) expect(screen.getByText(g)).toBeInTheDocument();
    expect(screen.getByText('U6–U13', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('1 350 GEL')).toBeInTheDocument();
    expect(screen.getByText('3 100 GEL')).toBeInTheDocument();
    expect(screen.getByText(/Бронь — 500 GEL до 5 декабря/)).toBeInTheDocument();
    expect(screen.getByText(/Полная оплата — до 20 декабря/)).toBeInTheDocument();
    expect(screen.getByText('проведённых сборов')).toBeInTheDocument();
    expect(screen.getByText('участников')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Запись открыта/ })).toHaveAttribute('href', expect.stringContaining('fc_kickstart_tbs_admin'));
    // старых сборов нет нигде на странице
    const text = document.body.textContent ?? '';
    for (const bad of ['Уреки', 'Kolkhida', '3–10 января', '1 500 GEL', '2 500 GEL', 'футболка', 'Сауна']) expect(text).not.toContain(bad);
    for (const img of Array.from(document.querySelectorAll('img'))) expect(img.getAttribute('src') ?? '').not.toMatch(/camp-(resort|garden|sunset|play|room[123]|class|fields|shirt)\b/);
  });

  it('родитель: из карточки Winter Camp кнопка «Записаться / мои сборы» открывает сборы родителя', async () => {
    fake.db.player_guardians = [{ player_id: 'p1', user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Алексей Петров', club_id: 'club1', status: 'active', groups: { name: 'U10-A' } } }];
    fake.db.camps = [{ id: 'c1', club_id: 'club1', name: 'Зимний лагерь', location: null, starts_on: '2027-01-02', ends_on: '2027-01-09', booking_fee: 0, booking_deadline: null, full_payment_deadline: null, active: true }];
    render(<About role="parent" cabinet onChangeRole={() => undefined} />);
    open(/Winter Camp 2027/);
    fireEvent.click(screen.getByRole('button', { name: 'Записаться / мои сборы' }));
    expect(await screen.findByText('Зимний лагерь')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Сборы' })).toBeInTheDocument();
  });

  it('гость: в карточке Winter Camp кнопки «мои сборы» нет, запись через чат администратора', () => {
    render(<About role="guest" onChangeRole={() => undefined} />);
    open(/Winter Camp 2027/);
    expect(screen.queryByRole('button', { name: 'Записаться / мои сборы' })).toBeNull();
  });

  it('экипировка: карточки товаров, размерная таблица костюма и возврат к списку', () => {
    render(<About role="parent" onChangeRole={() => undefined} />);
    open(/^Экипировка/);
    for (const n of ['Тренировочный комплект', 'Игровой комплект', 'Вратарский комплект', 'Спортивный костюм', 'Дождевик']) expect(screen.getByRole('button', { name: new RegExp(n) })).toBeInTheDocument();
    open(/Спортивный костюм/);
    expect(screen.getByRole('heading', { name: 'Спортивный костюм' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: '128' })).toBeInTheDocument();
    expect(screen.getByText(/Допуск ±1 см/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.getByRole('button', { name: /Дождевик/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.getByRole('button', { name: /^Экипировка/ })).toBeInTheDocument();
  });

  it('кнопки «Записаться» ведут в чат администратора', () => {
    render(<About role="guest" onChangeRole={() => undefined} />);
    open(/^Индивидуальные/);
    const sign = screen.getAllByRole('link', { name: /Записаться$/ });
    expect(sign.length).toBeGreaterThanOrEqual(1);
    sign.forEach(a => expect(a).toHaveAttribute('href', 'https://t.me/fc_kickstart_tbs_admin'));
  });

  it('заявка на пробную: отправка только с согласием, данные уходят в базу', async () => {
    fake.rpc.lead_submit_app = () => 'lead-1';
    render(<About role="guest" onChangeRole={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Записаться на пробную' }));
    fireEvent.change(screen.getByLabelText('Ваше имя'), { target: { value: 'Мама' } });
    fireEvent.change(screen.getByLabelText('Имя и фамилия ребёнка'), { target: { value: 'Иван Петров' } });
    fireEvent.change(screen.getByLabelText('Год рождения ребёнка'), { target: { value: String(new Date().getFullYear() - 8) } });
    fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '+995 555 12 34 56' } });
    fireEvent.change(screen.getByLabelText('Удобный филиал'), { target: { value: 'Isani' } });
    const send = screen.getByRole('button', { name: 'Отправить заявку' });
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(send).toBeEnabled();
    fireEvent.click(send);
    expect(await screen.findByText('Заявка отправлена')).toBeInTheDocument();
    expect(fake.rpcCalls('lead_submit_app')).toEqual([{ parent: 'Мама', child: 'Иван Петров', byear: new Date().getFullYear() - 8, phone: '+995 555 12 34 56', wish: 'Филиал: Isani', consent: true }]);
  });

  it('ребёнок кнопки записи на пробную не видит (#235)', () => {
    render(<About role="child" onChangeRole={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Записаться на пробную' })).toBeNull();
    expect(screen.getByRole('button', { name: /^Филиалы/ })).toBeInTheDocument();
  });

  it('лимит заявок: понятное сообщение', async () => {
    fake.rpc.lead_submit_app = () => ({ error: { message: 'too many leads' } });
    render(<About role="guest" onChangeRole={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Записаться на пробную' }));
    fireEvent.change(screen.getByLabelText('Ваше имя'), { target: { value: 'Мама' } });
    fireEvent.change(screen.getByLabelText('Имя и фамилия ребёнка'), { target: { value: 'Иван Петров' } });
    fireEvent.change(screen.getByLabelText('Год рождения ребёнка'), { target: { value: String(new Date().getFullYear() - 8) } });
    fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '+995 555 12 34 56' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Сегодня уже отправлено три заявки'));
  });
});
