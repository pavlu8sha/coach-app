import { describe, expect, it } from 'vitest';
import { BRANCHES, branchOf, canonicalLocation, locationOptions } from './branches';

// L8 (docs/acceptance/cash-locations-2026-11-21.md)
describe('справочник филиалов', () => {
  it('три филиала', () => expect([...BRANCHES]).toEqual(['Red Garden', 'Isani', 'Ortachala']));
  it('разные написания приводятся к названию справочника', () => {
    for (const t of ['Исани', 'isani', 'ISANI', ' Isani ', 'ისანი']) expect(branchOf(t)).toBe('Isani');
    for (const t of ['Ортачала', 'ortachala', 'Ortachala', 'ორთაჭალა']) expect(branchOf(t)).toBe('Ortachala');
    for (const t of ['Red Garden', 'red  garden', 'RedGarden', 'Ред Гарден']) expect(branchOf(t)).toBe('Red Garden');
  });
  it('разовые площадки и пустые значения — не филиал', () => {
    for (const t of ['35-я школа', 'Surami Hotel', 'Vake', '', '  ', null, undefined]) expect(branchOf(t)).toBeNull();
  });
  it('L3: сохранённая локация не из справочника остаётся отдельной строкой, филиал не дублируется', () => {
    expect(locationOptions('')).toEqual(['Red Garden', 'Isani', 'Ortachala']);
    expect(locationOptions('Isani')).toEqual(['Red Garden', 'Isani', 'Ortachala']);
    // старое написание из сохранённого состояния приводится к филиалу, отдельной строкой не показывается
    expect(locationOptions('Исани')).toEqual(['Red Garden', 'Isani', 'Ortachala']);
    expect(locationOptions(' ortachala ')).toEqual(['Red Garden', 'Isani', 'Ortachala']);
    expect(canonicalLocation('Исани')).toBe('Isani');
    expect(canonicalLocation(' Vake ')).toBe('Vake');
    expect(locationOptions('Vake')).toEqual(['Vake', 'Red Garden', 'Isani', 'Ortachala']);
  });
});
