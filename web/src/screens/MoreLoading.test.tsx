import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SECTIONS } from '../lib/adminMenu';
import { fake } from '../test/fakeSupabase';
import AdminSection from './AdminSection';

// Пока данные грузятся, экраны раздела «Ещё» не показывают «пусто» и «ничего не найдено»: иначе при открытии мелькает пустое состояние (20.11.2026)
const EMPTY = /пока нет|нет данных|нет заявок|нет запросов|нет мероприятий|ничего не найдено|никого не найдено|не найден|пусто|нет \S+ за|нет мест|добавьте|создайте/i;
const groups = [{ id: 'g1', name: 'U9-A' }] as any;

describe('«Ещё»: загрузка без мигания пустого состояния', () => {
  for (const s of SECTIONS) {
    it(`${s.id} «${s.title}»: пока запросы не ответили, нет пустого состояния`, async () => {
      fake.hang = true;
      const { container } = render(<AdminSection id={s.id} groups={groups} onMenuChanged={() => {}} />);
      await act(async () => { await new Promise(r => setTimeout(r, 30)); });
      const empties = [...container.querySelectorAll('.ks-empty')].map(e => e.textContent);
      expect(empties).toEqual([]);
      expect(container.querySelector('.ks-splash')).toBeNull(); // полноэкранная заставка только при запуске приложения, не при открытии раздела
      expect(container.textContent ?? '').not.toMatch(EMPTY);
      // заголовок известен заранее: показываем его сразу, чтобы он не появлялся рывком после данных
      expect(container.querySelector('h1'), 'нет заголовка при загрузке').not.toBeNull();
    });
  }
});
