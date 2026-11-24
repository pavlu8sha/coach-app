// Пробная правка: родное оформление поля даты только в «Отметках» (docs/DATE_PICKER_SMOOTH_ACCEPTANCE.md).
// @ts-expect-error в проекте нет типов node; vitest читает файл напрямую
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const kit: string = readFileSync('src/ui/kit.css', 'utf8');
const sessions: string = readFileSync('src/screens/Sessions.tsx', 'utf8');

describe('поле даты в «Отметках»', () => {
  it('п.1: класс есть у поля даты в Sessions и правило снимает appearance: none', () => {
    expect(sessions).toMatch(/className="ks-input ks-date-native" type="date" aria-label="Дата"/);
    expect(kit).toMatch(/input\[type='date'\]\.ks-date-native \{ -webkit-appearance: auto; appearance: auto; \}/);
  });
  it('п.1: другие поля даты класс не получают', () => {
    expect(sessions.match(/ks-date-native/g)).toHaveLength(1);
  });
});
