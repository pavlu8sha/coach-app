import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/telegram', () => ({ inTelegram: () => true, tgApp: () => ({ BackButton: { onClick: vi.fn(), offClick: vi.fn(), show: vi.fn(), hide: vi.fn() } }) }));
import { BackNav } from './nav';

describe('BackNav', () => {
  it('внутри Telegram кнопка «Назад» есть и на экране', () => {
    const onBack = vi.fn();
    render(<BackNav onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: /Назад/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
