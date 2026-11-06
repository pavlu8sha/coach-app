import { describe, expect, it } from 'vitest';
import { matchPlayers, parseLines } from './firstWaveImport';

const players = [
  { id: 'p1', full_name: 'Иванов Пётр' },
  { id: 'p2', full_name: 'Chebotarev Andrey' },
  { id: 'p3', full_name: 'Сидоров Ян' },
  { id: 'p4', full_name: 'Сидоров Ян' },
];

describe('Импорт первой волны', () => {
  it('разбирает строки, заголовок и направление во второй колонке', () => {
    const lines = parseLines('Фамилия;Направление\nИванов Пётр;суббота\n\n"Chebotarev Andrey";Воскресенье\nСидоров Ян, вратарская\nПросто Имя');
    expect(lines.map(l => [l.name, l.dir])).toEqual([['Иванов Пётр', 'ind_sat'], ['Chebotarev Andrey', 'ind_sun'], ['Сидоров Ян', 'goalkeeper'], ['Просто Имя', null]]);
  });

  it('сопоставляет без учёта регистра, ё и порядка слов; дубли и ненайденные отдельно', () => {
    const r = matchPlayers(parseLines('иванов петр\nAndrey Chebotarev\nСидоров Ян\nНеизвестный Игрок'), players);
    expect(r.ok.map(x => x.player.id)).toEqual(['p1', 'p2']);
    expect(r.ambiguous.map(x => x.players.length)).toEqual([2]);
    expect(r.missing.map(x => x.name)).toEqual(['Неизвестный Игрок']);
  });
});
