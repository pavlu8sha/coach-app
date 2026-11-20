// Заглушка Supabase для тестов экранов: данные в памяти, запись вызовов. Подставляется вместо lib/supabase (vite.config.ts → test.alias).
// Вложенные выборки вида players(id, full_name, groups(name)) не разворачиваются: вложенные объекты кладутся в строки данных готовыми.
type Row = Record<string, any>;
export interface Call { kind: 'rpc' | 'insert' | 'upsert' | 'update' | 'delete'; name: string; args?: any }

export const fake = {
  db: {} as Record<string, Row[]>,
  calls: [] as Call[],
  rpc: {} as Record<string, (args: any) => any>, // имя функции → ответ (значение, либо { data, error })
  errors: {} as Record<string, string>,         // таблица → текст ошибки выборки
  rejects: {} as Record<string, string>,        // таблица → запрос отклоняется исключением (сбой сети)
  user: { id: 'u' } as { id: string } | null,
  hang: false, // запросы не отвечают: проверка экранов в состоянии загрузки
  reset() {
    this.db = {};
    this.calls = [];
    this.rpc = {};
    this.errors = {};
    this.rejects = {};
    this.user = { id: 'u' };
    this.hang = false;
  },
  /** Вызовы функций базы по имени (аргументы). */
  rpcCalls(name: string) {
    return this.calls.filter(c => c.kind === 'rpc' && c.name === name).map(c => c.args);
  },
  /** Платежи абонемента, записанные через payment_add (0214), в виде строки payments (без ключа); ключи: paymentKeys(). */
  paymentAdds() {
    return this.rpcCalls('payment_add').map((a: any) => ({ player_id: a.pid, amount: a.amt, paid_on: a.d, method: a.mth, ...(a.fm ? { for_month: a.fm } : {}) }));
  },
  paymentKeys() {
    return this.rpcCalls('payment_add').map((a: any) => a.req);
  },
  /** Записи в таблицу: insert/upsert/update/delete. */
  writes(table: string, kind?: Call['kind']) {
    return this.calls.filter(c => c.kind !== 'rpc' && c.name === table && (!kind || c.kind === kind)).map(c => c.args);
  },
};

export const SUPABASE_URL = 'http://fake.supabase';
export const configured = true;

function query(table: string): any {
  const filters: ((r: Row) => boolean)[] = [];
  const orders: { c: string; asc: boolean }[] = [];
  let op: Call['kind'] | 'select' = 'select';
  let payload: any;
  let returning = false;
  let lim = Infinity, from = 0, to = Infinity, single = false;

  const run = () => {
    if (fake.rejects[table]) throw new Error(fake.rejects[table]);
    if (fake.errors[table]) return { data: null, error: { message: fake.errors[table] } };
    // как в базе: pay_month — вычисляемый месяц платежа (for_month или месяц paid_on)
    const rows = op === 'select' && table === 'payments'
      ? (fake.db[table] ?? []).map((r: any) => ({ pay_month: r.for_month ?? (r.paid_on ? String(r.paid_on).slice(0, 7) + '-01' : undefined), ...r }))
      : fake.db[table] ?? [];
    const rowsOf = (p: any) => (Array.isArray(p) ? p : [p]);
    if (op === 'insert') {
      fake.calls.push({ kind: 'insert', name: table, args: payload });
      const inserted = rowsOf(payload).map((r: any) => ({ id: r.id ?? `fake-${Math.random().toString(36).slice(2)}`, ...r }));
      fake.db[table] = [...rows, ...inserted];
      return { data: returning ? (single ? inserted[0] ?? null : inserted) : null, error: null };
    }
    if (op === 'upsert') {
      fake.calls.push({ kind: 'upsert', name: table, args: payload });
      return { data: null, error: null };
    }
    if (op === 'update') {
      fake.calls.push({ kind: 'update', name: table, args: payload });
      // как PostgREST: применяет значения к строкам под фильтром; с .select() возвращает их (пусто = ни одной строки не обновлено)
      const hit = rows.filter(r => filters.every(f => f(r)));
      // без мутации исходных объектов: тесты делят константы-фикстуры между собой
      const changed = hit.map(r => ({ ...r, ...payload }));
      fake.db[table] = rows.map(r => { const i = hit.indexOf(r); return i < 0 ? r : changed[i]; });
      return { data: returning ? changed : null, error: null };
    }
    if (op === 'delete') {
      fake.calls.push({ kind: 'delete', name: table, args: undefined });
      fake.db[table] = rows.filter(r => !filters.every(f => f(r)));
      return { data: null, error: null };
    }
    let out = rows.filter(r => filters.every(f => f(r)));
    for (const o of [...orders].reverse()) out = [...out].sort((a, b) => (a[o.c] < b[o.c] ? -1 : a[o.c] > b[o.c] ? 1 : 0) * (o.asc ? 1 : -1));
    out = out.slice(from, Math.min(to + 1, from + lim));
    return { data: single ? out[0] ?? null : out, error: null, count: out.length };
  };

  const q: any = { then: (res: any, rej: any) => (fake.hang ? new Promise(() => {}) : new Promise(ok => ok(run()))).then(res, rej) };
  q.select = () => { if (op === 'insert' || op === 'update' || op === 'upsert') returning = true; return q; };
  q.insert = (p: any) => ((op = 'insert'), (payload = p), q);
  q.upsert = (p: any) => ((op = 'upsert'), (payload = p), q);
  q.update = (p: any) => ((op = 'update'), (payload = p), q);
  q.delete = () => ((op = 'delete'), q);
  // Значение колонки; «таблица.колонка» читает вложенный объект (фильтр по связанной таблице)
  const val = (r: Row, c: string) => c.split('.').reduce((o: any, k) => (o == null ? undefined : o[k]), r);
  q.eq = (c: string, v: any) => (filters.push(r => val(r, c) === v), q);
  q.neq = (c: string, v: any) => (filters.push(r => val(r, c) !== v), q);
  q.gt = (c: string, v: any) => (filters.push(r => val(r, c) > v), q);
  q.gte = (c: string, v: any) => (filters.push(r => val(r, c) >= v), q);
  q.lt = (c: string, v: any) => (filters.push(r => val(r, c) < v), q);
  q.lte = (c: string, v: any) => (filters.push(r => val(r, c) <= v), q);
  q.is = (c: string, v: any) => (filters.push(r => (r[c] ?? null) === v), q);
  q.in = (c: string, vs: any[]) => (filters.push(r => vs.includes(r[c])), q);
  q.ilike = (c: string, p: string) => {
    const needle = p.replace(/%/g, '').toLowerCase();
    filters.push(r => String(r[c] ?? '').toLowerCase().includes(needle));
    return q;
  };
  q.order = (c: string, o?: { ascending?: boolean }) => (orders.push({ c, asc: o?.ascending !== false }), q);
  q.limit = (n: number) => ((lim = n), q);
  q.range = (a: number, b: number) => ((from = a), (to = b), q);
  q.maybeSingle = () => ((single = true), q);
  q.single = q.maybeSingle;
  return q;
}

export const supabase: any = {
  from: query,
  rpc: (name: string, args?: any) => ({
    then: (res: any, rej: any) => {
      fake.calls.push({ kind: 'rpc', name, args });
      // поиск игрока в кассе (0154): по умолчанию ищет по данным fake.db.players, как админ; тест может подставить свой ответ
      // список детей родителя (0215): по умолчанию строится из fake.db.player_guardians (вложенный players, как в прежних данных; решение о доступе принимает сервер, фильтра тут нет);
      // тест подставляет fake.rpc.my_children, чтобы проверить ответ сервера, ошибку или сбой сети
      const h = fake.rpc[name] ?? (name === 'my_children'
        ? () => {
            if (!fake.user) return { error: { message: 'forbidden', code: '42501' } };
            return (fake.db.player_guardians ?? []).filter(g => g.user_id === fake.user!.id && g.players)
              .map(g => ({ player_id: g.players.id, full_name: g.players.full_name, group_id: g.players.group_id ?? null, group_name: g.players.groups?.name ?? null }));
          }
        : name === 'cash_find_players'
        ? (a: { q: string }) => (fake.db.players ?? []).filter(p => String(p.full_name).toLowerCase().includes(String(a.q).toLowerCase()))
            .map(p => ({ id: p.id, full_name: p.full_name, group_id: p.group_id ?? null, external_id: p.external_id ?? null, birth_date: p.birth_date ?? null, status: p.status ?? 'active', group_name: p.groups?.name ?? null }))
        : undefined);
      // ответ может быть обещанием: тест сам решает, когда база «ответит» (проверка повторного нажатия во время запроса)
      if (fake.hang) return new Promise(() => {}).then(res, rej);
      return Promise.resolve(h ? h(args) : null)
        .then((out: any) => (out && typeof out === 'object' && ('error' in out || 'data' in out) ? { data: out.data ?? null, error: out.error ?? null } : { data: out, error: null }))
        .then(res, rej);
    },
  }),
  auth: {
    getUser: async () => ({ data: { user: fake.user } }),
    getSession: async () => ({ data: { session: fake.user ? { access_token: 'test-token' } : null } }),
    signOut: async () => {
      fake.calls.push({ kind: 'rpc', name: 'auth.signOut' });
      return { error: null };
    },
    verifyOtp: async (a: any) => {
      fake.calls.push({ kind: 'rpc', name: 'auth.verifyOtp', args: a });
      return { error: null };
    },
  },
};
