import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import About from './About';

describe('«О клубе» для гостя', () => {
  it('показывает филиалы, чемпионаты, индивидуальные, вратарские, экипировку и сборы', () => {
    render(<About role="guest" onChangeRole={() => undefined} />);
    for (const t of ['Филиалы', 'Чемпионаты сезона 2026/27', 'Индивидуальные тренировки', 'Вратарские тренировки', 'Экипировка 2026/27', 'Winter Camp 2027', 'Наш канал']) {
      expect(screen.getByRole('heading', { name: t })).toBeInTheDocument();
    }
    expect(screen.getByText('Red Garden')).toBeInTheDocument();
    const maps = screen.getAllByRole('link', { name: 'Открыть на карте' });
    expect(maps).toHaveLength(3);
    expect(maps[0]).toHaveAttribute('href', 'https://www.google.com/maps?q=41.724328,44.755409');
    expect(screen.getByText('U9-A, U9-B, U10, U11')).toBeInTheDocument();
    expect(screen.getByText(/525 GEL вместо 620/)).toBeInTheDocument();
  });

  it('кнопки «Записаться» ведут в чат администратора', () => {
    render(<About role="guest" onChangeRole={() => undefined} />);
    const sign = screen.getAllByRole('link', { name: /Записаться$|Заказать|Забронировать место/ });
    expect(sign.length).toBeGreaterThanOrEqual(4);
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
