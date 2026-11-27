import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fake } from '../test/fakeSupabase';
import { PlayerSearch } from './PlayerSearch';

// Условия: docs/MATCH_UNIFIED_SCREEN_PR2_ACCEPTANCE.md, Э2.
const players = [
  { id: 'p1', full_name: 'Иванов Пётр' },
  { id: 'p2', full_name: 'Иванов Павел' },
  { id: 'p3', full_name: 'Сидоров Ян' },
];
const setup = (props: Partial<React.ComponentProps<typeof PlayerSearch>> = {}) => {
  fake.db.players = players;
  const onPick = vi.fn();
  render(<PlayerSearch id="t" label="Добавить игрока" placeholder="Фамилия или имя" exclude={() => false} onPick={onPick} {...props} />);
  return { onPick, input: screen.getByLabelText('Добавить игрока') as HTMLInputElement };
};

describe('Общий поиск игрока', () => {
  it('меньше двух символов: запроса нет, ничего не показывается', async () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: 'И' } });
    await new Promise(r => setTimeout(r, 250));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText('Иванов Пётр')).toBeNull();
  });

  it('от двух символов находит игроков, «Добавить» отдаёт игрока и очищает поле', async () => {
    const { input, onPick } = setup();
    fireEvent.change(input, { target: { value: 'Иван' } });
    expect(await screen.findByText('Иванов Пётр')).toBeInTheDocument();
    expect(screen.getByText('Иванов Павел')).toBeInTheDocument();
    expect(screen.queryByText('Сидоров Ян')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Добавить' })[0]);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('');
    expect(screen.queryByText('Иванов Павел')).toBeNull();
  });

  it('уже находящиеся в составе не предлагаются', async () => {
    const { input } = setup({ exclude: id => id === 'p1' });
    fireEvent.change(input, { target: { value: 'Иван' } });
    expect(await screen.findByText('Иванов Павел')).toBeInTheDocument();
    expect(screen.queryByText('Иванов Пётр')).toBeNull();
  });

  it('при новом запросе старый список скрыт до ответа (защита от устаревшего ответа)', async () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: 'Иван' } });
    await screen.findByText('Иванов Пётр');
    fireEvent.change(input, { target: { value: 'Сидор' } });
    expect(screen.queryByText('Иванов Пётр')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Поиск…');
    expect(await screen.findByText('Сидоров Ян')).toBeInTheDocument();
  });

  it('ошибка поиска не выдаётся за «Никого не найдено», «Повторить поиск» повторяет запрос', async () => {
    const { input } = setup();
    fake.errors.players = 'boom';
    fireEvent.change(input, { target: { value: 'Иван' } });
    expect(await screen.findByText('Не удалось выполнить поиск')).toBeInTheDocument();
    expect(screen.queryByText('Никого не найдено')).toBeNull();
    delete fake.errors.players;
    fireEvent.click(screen.getByRole('button', { name: 'Повторить поиск' }));
    expect(await screen.findByText('Иванов Пётр')).toBeInTheDocument();
    expect(screen.queryByText('Не удалось выполнить поиск')).toBeNull();
  });

  it('пустой результат: «Никого не найдено»', async () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: 'Яяя' } });
    await waitFor(() => expect(screen.getByText('Никого не найдено')).toBeInTheDocument());
  });
});
