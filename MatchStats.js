/** Статистика матчей: считает по листам МАТЧИ и УЧАСТИЕ, ничего не записывает. Доступна тренерам и администратору. */

function appMatchStats(pin) {
  checkAny_(pin);
  var d = matchesData_();
  if (!d.events.length) return { games: [], parts: [] };
  var byId = {};
  d.events.forEach(function (e) { byId[e.id] = e; });
  var games = [], isG = {};
  Object.keys(byId).forEach(function (id) {
    var e = byId[id];
    if (e.gf === null || e.ga === null) return;
    var par = e.parent ? byId[e.parent] : null;
    var kind = par ? (par.type === 'Чемпионат' ? 'Чемпионат' : 'Турниры и кубки')
      : (e.type === 'Товарищеская' ? 'Товарищеские' : (e.type === 'Чемпионат' ? 'Чемпионат' : 'Турниры и кубки'));
    var opp = String(e.opp || '').trim();
    var base = e.team.replace(/\s*-\s*[A-Za-z0-9]+$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var internal = !!opp && new RegExp('^' + base + '\\s*-\\s*[A-Za-z0-9]+$', 'i').test(opp);
    games.push({ id: id, team: e.team, kind: kind, title: par ? par.name : e.name, date: e.date, opp: opp,
      gf: e.gf, ga: e.ga, internal: internal });
    isG[id] = true;
  });
  var parts = [];
  d.parts.forEach(function (p) {
    if (!isG[p.e]) return;
    if (p.played !== 1 && !p.goals) return;
    parts.push({ g: p.e, id: p.p, name: p.n, played: p.played === 1, goals: p.goals });
  });
  return { games: games, parts: parts };
}