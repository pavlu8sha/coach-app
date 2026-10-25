import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetPhotoCache } from '../lib/photos';
import { fake } from '../test/fakeSupabase';
import AdminPhotos from './AdminPhotos';
import About from './About';

describe('Фото клуба', () => {
  beforeEach(() => {
    fake.reset();
    resetPhotoCache();
  });

  it('показывает исходные фото и список слотов', () => {
    render(<AdminPhotos />);
    expect(screen.getByRole('heading', { name: 'Фото клуба' })).toBeInTheDocument();
    expect(screen.getByAltText('Вратарский комплект')).toHaveAttribute('src', '/img/kit-gk.jpg');
    expect(screen.getAllByRole('button', { name: 'Заменить' }).length).toBeGreaterThan(10);
  });

  it('подставляет замену администратора из базы', async () => {
    fake.db.club_photos = [{ key: 'kit-gk', data: 'data:image/jpeg;base64,AAAA' }];
    render(<AdminPhotos />);
    await waitFor(() => expect(screen.getByAltText('Вратарский комплект')).toHaveAttribute('src', 'data:image/jpeg;base64,AAAA'));
    expect(screen.getByAltText('Игровой комплект')).toHaveAttribute('src', '/img/kit-game.jpg');
  });

  it('заменяет фото через функцию базы', async () => {
    vi.stubGlobal('createImageBitmap', async () => ({ width: 2400, height: 1200 }));
    const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,NEW');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: () => undefined } as unknown as CanvasRenderingContext2D);
    fake.rpc.club_photo_set = () => null;
    render(<AdminPhotos />);
    const file = new File(['x'], 'p.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Файл фото: Вратарский комплект'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText('Фото заменено.')).toBeInTheDocument());
    expect(fake.rpcCalls('club_photo_set')).toEqual([{ k: 'kit-gk', d: 'data:image/jpeg;base64,NEW' }]);
    expect(screen.getByAltText('Вратарский комплект')).toHaveAttribute('src', 'data:image/jpeg;base64,NEW');
    toDataURL.mockRestore();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('не принимает не фото и показывает отказ базы', async () => {
    render(<AdminPhotos />);
    fireEvent.change(screen.getByLabelText('Файл фото: Игровой комплект'), { target: { files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Выберите файл с фото'));
    expect(fake.rpcCalls('club_photo_set')).toEqual([]);
  });

  it('возвращает исходное фото', async () => {
    fake.db.club_photos = [{ key: 'kit-gk', data: 'data:image/jpeg;base64,AAAA' }];
    fake.rpc.club_photo_clear = () => null;
    render(<AdminPhotos />);
    await waitFor(() => expect(screen.getByAltText('Вратарский комплект')).toHaveAttribute('src', 'data:image/jpeg;base64,AAAA'));
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть исходное: Вратарский комплект' }));
    await waitFor(() => expect(screen.getByAltText('Вратарский комплект')).toHaveAttribute('src', '/img/kit-gk.jpg'));
    expect(fake.rpcCalls('club_photo_clear')).toEqual([{ k: 'kit-gk' }]);
  });

  it('замена видна в «О клубе»', async () => {
    fake.db.club_photos = [{ key: 'kit-gk', data: 'data:image/jpeg;base64,GK' }];
    const { container } = render(<About role="guest" onChangeRole={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /^Экипировка/ }));
    await waitFor(() => expect(container.innerHTML).toContain('data:image/jpeg;base64,GK'));
  });
});
