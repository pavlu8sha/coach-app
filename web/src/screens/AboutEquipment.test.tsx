// @ts-expect-error в проекте нет типов node; vitest читает файл напрямую (CSS через ?raw в тестах пустой)
import { readFileSync } from 'node:fs';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import About from './About';
import { PRODUCTS } from '../lib/clubInfo';
import { PHOTO_SLOTS } from '../lib/photos';

const imgs = import.meta.glob('../../public/img/*.jpg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const kitCss: string = readFileSync('src/ui/kit.css', 'utf8');

// Условия приёмки: docs/EQUIPMENT_CATALOG_ACCEPTANCE.md (каталог FC_Kickstart_Uniform.pdf)
const openEquipment = () => {
  render(<About role="parent" onChangeRole={() => undefined} />);
  fireEvent.click(screen.getByRole('button', { name: /^Экипировка/ }));
};
const openProduct = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));

describe('экипировка по каталогу KAIRA', () => {
  it('п.1–2: заголовок, общее фото и пять карточек по порядку PDF', () => {
    openEquipment();
    expect(screen.getByRole('heading', { name: 'Экипировка 2026/27 и 2027/28' })).toBeInTheDocument();
    expect(screen.getByText('Коллекция KAIRA для FC Kickstart Tbilisi')).toBeInTheDocument();
    expect(screen.getByAltText('Пять позиций для тренировок, матчей и поездок')).toHaveAttribute('src', '/img/kit-lineup.jpg');
    const rows = screen.getAllByRole('button').filter(b => b.classList.contains('ks-prod'));
    expect(rows.map(r => r.textContent)).toEqual([
      expect.stringContaining('Тренировочный комплект'),
      expect.stringContaining('Игровой комплект'),
      expect.stringContaining('Вратарский комплект'),
      expect.stringContaining('Спортивный костюм'),
      expect.stringContaining('Дождевик'),
    ]);
    expect(rows.map(r => /(\d+) GEL/.exec(r.textContent ?? '')?.[1])).toEqual(['100', '200', '200', '170', '150']);
    for (const t of ['Для каждой тренировки', 'Для матчей и турниров', 'Для тех, кто защищает ворота', 'Для тренировок, поездок и прогулок', 'Для дождливой и ветреной погоды']) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
  });

  it('п.3–4: тренировочный комплект: состав, правило клуба, размеры', () => {
    openEquipment();
    openProduct(/Тренировочный комплект/);
    expect(screen.getByText('Футболка, шорты и белые длинные тренировочные носки.')).toBeInTheDocument();
    expect(screen.getByText('Правило клуба')).toBeInTheDocument();
    expect(screen.getByText(/На тренировках используется только клубная экипировка/)).toBeInTheDocument();
    expect(screen.getByText('116 / 128 / 140 / 152 / 164 / S / M / L / XL')).toBeInTheDocument();
  });

  it('п.3, 5: игровой комплект: персонализация, материалы, без опечатки, два фото', () => {
    openEquipment();
    openProduct(/Игровой комплект/);
    expect(screen.getByText('Игровая футболка, синие шорты и белые гетры.')).toBeInTheDocument();
    for (const l of ['Персонализация', 'Материалы', 'Кому нужен']) expect(screen.getByText(l)).toBeInTheDocument();
    expect(screen.getByText(/флаг в контуре карты Грузии/)).toBeInTheDocument();
    expect(screen.getByText(/Лёгкий жаккард 115 г\/м²/)).toBeInTheDocument();
    expect(screen.getByText(/для всех желающих персонализации/)).toBeInTheDocument();
    expect(screen.queryByText(/желающтх/)).toBeNull();
    const srcs = screen.getAllByRole('img').map(i => i.getAttribute('src'));
    expect(srcs).toEqual(expect.arrayContaining(['/img/kit-game.jpg', '/img/kit-game-back.jpg']));
  });

  it('п.3: вратарский комплект', () => {
    openEquipment();
    openProduct(/Вратарский комплект/);
    expect(screen.getByText('Оранжевая вратарская футболка, синие шорты и гетры.')).toBeInTheDocument();
    expect(screen.getByText('Клубные цвета')).toBeInTheDocument();
    expect(screen.getByText(/Фамилия и номер наносятся так же, как на игровой форме/)).toBeInTheDocument();
  });

  it('п.3–4: костюм: секции, размеры, таблица по росту сохранена', () => {
    openEquipment();
    openProduct(/Спортивный костюм/);
    for (const l of ['В комплекте', 'Детали', 'Нанесение']) expect(screen.getByText(l)).toBeInTheDocument();
    expect(screen.getByText('128 / 134 / 140 / 146 / 152 / 158 / 164 / 170 / S / M / L / XL')).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: '128' })).toBeInTheDocument();
  });

  it('п.3–4: дождевик: конструкция, нанесение, примерка', () => {
    openEquipment();
    openProduct(/Дождевик/);
    for (const l of ['Конструкция', 'Нанесение', 'Примерка']) expect(screen.getByText(l)).toBeInTheDocument();
    expect(screen.getByText(/с учётом одежды, которую ребёнок будет носить под дождевиком/)).toBeInTheDocument();
    expect(screen.getByText('128 / 134 / 140 / 146 / 152 / 158 / 164 / 170 / S / M / L / XL')).toBeInTheDocument();
  });

  it('старых свойств, которых нет в PDF, на экране нет', () => {
    openEquipment();
    for (const n of [/Тренировочный комплект/, /Игровой комплект/]) {
      openProduct(n);
      expect(screen.queryByText(/ионами серебра|Антибактериальн/i)).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    }
  });

  it('п.6–7: полный комплект 525 вместо 620, рассрочка, без «15%»', () => {
    openEquipment();
    const box = screen.getByRole('heading', { name: 'Полный комплект' }).closest('section') as HTMLElement;
    const q = within(box);
    for (const t of ['Игровой комплект', 'Тренировочный комплект', 'Спортивный костюм', 'Дождевик']) expect(q.getByText(t)).toBeInTheDocument();
    expect(q.getByText('По отдельности: 620 GEL')).toBeInTheDocument();
    expect(q.getByText('525 GEL')).toBeInTheDocument();
    expect(q.getByText('Выгода 95 GEL')).toBeInTheDocument();
    expect(q.getByText(/при заказе четырёх позиций одновременно и полной оплате/)).toBeInTheDocument();
    expect(q.getByText('Рассрочка на 3 месяца без процентов и участия банка')).toBeInTheDocument();
    expect(q.getByText(/При рассрочке полный комплект стоит 620 GEL, скидка не действует/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/15\s?%/);
  });

  it('п.8–9: размеры и заказ, кнопки ведут в чаты', () => {
    openEquipment();
    expect(screen.getByText('Изготовление от 2 до 4 недель после заказа')).toBeInTheDocument();
    for (const s of ['Примерка на тренировке', 'Оформление заказа', 'Изготовление и выдача']) expect(screen.getByText(s)).toBeInTheDocument();
    expect(screen.getByText(/Дату выдачи сообщит администратор/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Заказать' })).toHaveAttribute('href', 'https://t.me/fc_kickstart_tbs_admin');
    expect(screen.getByRole('link', { name: 'Вопросы по рассрочке' })).toHaveAttribute('href', 'https://t.me/coach_siordia');
  });

  it('п.5: каждое фото товара есть в редакторе админа и в web/public/img', () => {
    const keys = [...PRODUCTS.flatMap(p => p.photos), 'kit-lineup', 'kit-game-back'];
    const slots = new Set(PHOTO_SLOTS.map(s => s.key));
    for (const k of keys) {
      expect(slots.has(k), `слот ${k}`).toBe(true);
      const f = imgs[`../../public/img/${k}.jpg`];
      expect(f, `файл ${k}.jpg`).toBeDefined();
      expect(f.length, `размер ${k}.jpg`).toBeGreaterThan(5000);
    }
  });

  it('п.10: стили нового блока без жёстких цветов', () => {
    const block = kitCss.split('\n').filter(l => /^\.ks-eq-/.test(l)).join('\n');
    expect(block.length).toBeGreaterThan(50);
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(/);
  });
});
