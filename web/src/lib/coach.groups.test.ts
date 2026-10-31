import { describe, expect, it } from 'vitest';
import { compareGroups, groupByGroupName, sortGroups } from './coach';

describe('единый порядок групп', () => {
  it('возрастные по возрасту и букве, затем площадки, weekends, индивидуальные, без группы', () => {
    const names = ['Индивидуальные / вратарские', 'weekends', 'U13-C', 'Isani', 'U10-A', 'U7-B', 'Ortachala U12', 'U9-A', 'U7-A', 'U11', 'Ortachala U9', 'U13-A', 'U10-B', 'U9-B', 'U13-B', 'без группы'];
    expect(sortGroups(names.map(name => ({ name }))).map(g => g.name)).toEqual([
      'U7-A', 'U7-B', 'U9-A', 'U9-B', 'U10-A', 'U10-B', 'U11', 'U13-A', 'U13-B', 'U13-C',
      'Isani', 'Ortachala U9', 'Ortachala U12', 'weekends', 'Индивидуальные / вратарские', 'без группы',
    ]);
  });
  it('groupByGroupName выдаёт группы в том же порядке', () => {
    const r = groupByGroupName([{ g: 'U10-A' }, { g: 'U7-A' }, { g: 'Без группы' }, { g: 'U7-A' }], x => x.g);
    expect(r.map(([k]) => k)).toEqual(['U7-A', 'U10-A', 'Без группы']);
    expect(compareGroups('U9-B', 'U10-A')).toBeLessThan(0);
  });
});
