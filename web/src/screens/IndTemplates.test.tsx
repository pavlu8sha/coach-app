import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import IndTemplates from './IndTemplates';

const active = { id: 't1', club_id: 'c1', isodow: 6, start_time: '19:00:00', end_time: '20:00:00', goalkeepers: false, active: true };
const inactive = { id: 't2', club_id: 'c1', isodow: 7, start_time: '18:00:00', end_time: null, goalkeepers: true, active: false };

function seed(rows = [active, inactive]) {
  fake.db.individual_templates = rows;
  fake.db.clubs = [{ id: 'c1' }];
}

describe('Шаблоны индивидуальных тренировок', () => {
  it('показывает активные и отключённые шаблоны', async () => {
    seed();
    render(<IndTemplates />);
    expect(await screen.findByText('Суббота 19:00–20:00 · Индивидуальные')).toBeInTheDocument();
    expect(screen.getByText('Воскресенье 18:00 · Вратари')).toBeInTheDocument();
    expect(screen.getByText('Активен')).toBeInTheDocument();
    expect(screen.getByText('Отключён')).toBeInTheDocument();
  });

  it('создаёт шаблон с днём, временем, типом и клубом', async () => {
    seed([]);
    render(<IndTemplates />);
    fireEvent.click(await screen.findByRole('button', { name: 'Новый шаблон' }));
    fireEvent.change(screen.getByLabelText('День недели'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Начало'), { target: { value: '10:00' } });
    fireEvent.change(screen.getByLabelText('Окончание (необязательно)'), { target: { value: '11:00' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Вратари' }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    await waitFor(() => expect(fake.writes('individual_templates', 'insert')).toEqual([{ club_id: 'c1', isodow: 7, start_time: '10:00', end_time: '11:00', goalkeepers: true, active: true }]));
    expect(await screen.findByText('Шаблон создан.')).toBeInTheDocument();
  });

  it('не сохраняет окончание раньше начала', async () => {
    seed([]);
    render(<IndTemplates />);
    fireEvent.click(await screen.findByRole('button', { name: 'Новый шаблон' }));
    fireEvent.change(screen.getByLabelText('Начало'), { target: { value: '20:00' } });
    fireEvent.change(screen.getByLabelText('Окончание (необязательно)'), { target: { value: '19:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect(await screen.findByText('Окончание должно быть позже начала.')).toBeInTheDocument();
    expect(fake.writes('individual_templates')).toEqual([]);
  });

  it('не сохраняет пустое время начала', async () => {
    seed([]);
    render(<IndTemplates />);
    fireEvent.click(await screen.findByRole('button', { name: 'Новый шаблон' }));
    fireEvent.change(screen.getByLabelText('Начало'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect(await screen.findByText('Укажите время начала.')).toBeInTheDocument();
    expect(fake.writes('individual_templates')).toEqual([]);
  });

  it('меняет день, время, окончание и тип шаблона', async () => {
    seed([active]);
    render(<IndTemplates />);
    fireEvent.click(await screen.findByRole('button', { name: 'Изменить' }));
    fireEvent.change(screen.getByLabelText('День недели'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Начало'), { target: { value: '20:00' } });
    fireEvent.change(screen.getByLabelText('Окончание (необязательно)'), { target: { value: '21:00' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Вратари' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(fake.writes('individual_templates', 'update')).toEqual([{ isodow: 7, start_time: '20:00', end_time: '21:00', goalkeepers: true, active: true }]));
    expect(await screen.findByText('Шаблон сохранён.')).toBeInTheDocument();
    expect(screen.getByText('Воскресенье 20:00–21:00 · Вратари')).toBeInTheDocument();
  });

  it('отключает шаблон только после подтверждения', async () => {
    seed([active]);
    render(<IndTemplates />);
    fireEvent.click(await screen.findByRole('button', { name: 'Отключить' }));
    const dialog = await screen.findByRole('dialog');
    expect(fake.writes('individual_templates')).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отключить' }));
    await waitFor(() => expect(fake.writes('individual_templates', 'update')).toEqual([{ active: false }]));
    expect(await screen.findByText('Шаблон отключён. История и постоянные сохранены.')).toBeInTheDocument();
    expect(screen.getByText('Отключён')).toBeInTheDocument();
  });

  it('включает отключённый шаблон', async () => {
    seed([inactive]);
    render(<IndTemplates />);
    fireEvent.click(await screen.findByRole('button', { name: 'Включить' }));
    await waitFor(() => expect(fake.writes('individual_templates', 'update')).toEqual([{ active: true }]));
    expect(await screen.findByText('Шаблон включён.')).toBeInTheDocument();
    expect(screen.getByText('Активен')).toBeInTheDocument();
  });

  it('показывает понятную ошибку дубликата', async () => {
    seed([active]);
    render(<IndTemplates />);
    await screen.findByText('Суббота 19:00–20:00 · Индивидуальные');
    fireEvent.click(screen.getByRole('button', { name: 'Новый шаблон' }));
    fireEvent.change(screen.getByLabelText('Окончание (необязательно)'), { target: { value: '20:00' } });
    fake.errors.individual_templates = 'duplicate key value violates unique constraint "individual_templates_club_id_isodow_start_time_goalkeepers_key"';
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect(await screen.findByText(/Шаблон с таким днём, временем и типом уже есть/)).toBeInTheDocument();
    expect(fake.writes('individual_templates')).toEqual([]);
  });

  it('показывает понятную ошибку прав', async () => {
    seed([active]);
    render(<IndTemplates />);
    await screen.findByText('Суббота 19:00–20:00 · Индивидуальные');
    fireEvent.click(screen.getByRole('button', { name: 'Новый шаблон' }));
    fake.errors.individual_templates = 'new row violates row-level security policy for table "individual_templates"';
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect(await screen.findByText('Недостаточно прав: изменять шаблоны может только администратор.')).toBeInTheDocument();
    expect(fake.writes('individual_templates')).toEqual([]);
  });
});
