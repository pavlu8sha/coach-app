// Заглушка Supabase для тестов экранов: данные в памяти, запись вызовов. Подставляется вместо lib/supabase (vite.config.ts → test.alias).
// Вложенные выборки вида players(id, full_name, groups(name)) не разворачиваются: вложенные объекты кладутся в строки данных готовыми.
type Row = Record<string, any>;
export interface Call { kind: 'rpc' | 'insert' | 'upsert' | 'update' | 'delete'; name: string; args?: any }

export const fake = {
  db: {} as Record<string, Row[]>,
  calls: [] as Call[],
  rpc: {} as Record<string, (args: any) => any>, // имя функции → ответ (значение, либо { data, error })
  errors: {} as Record<string, string>,         // таблица → текст ошибки выборки
  user: { id: 'u' } as { id: string } | null,
  reset() {
    this.db = {};
    this.calls = [];
    this.rpc = {};
    this.errors = {};
    this.user = { id: 'u' };
  },
  /** Вызовы функций базы по имени (аргументы). */
  rpcCalls(name: string) {
    return this.calls.filter(c => c.kind === 'rpc' && c.name === name).map(c => c.args);
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
  let lim = Infinity, from = 0, to = Infinity, single = false;

  const run = () => {
    if (fake.errors[table]) return { data: null, error: { message: fake.errors[table] } };
    // как в базе: pay_month — вычисляемый месяц платежа (for_month или месяц paid_on)
    const rows = op === 'select' && table === 'payments'
      ? (fake.db[table] ?? []).map((r: any) => ({ pay_month: r.for_month ?? (r.paid_on ? String(r.paid_on).slice(0, 7) + '-01' : undefined), ...r }))
      : fake.db[table] ?? [];
    const rowsOf = (p: any) => (Array.isArray(p) ? p : [p]);
    if (op === 'insert') {
      fake.calls.push({ kind: 'insert', name: table, args: payload });
      fake.db[table] = [...rows, ...rowsOf(payload)];
      return { data: null, error: null };
    }
    if (op === 'upsert') {
      fake.calls.push({ kind: 'upsert', name: table, args: payload });
      return { data: null, error: null };
    }
    if (op === 'update') {
      fake.calls.push({ kind: 'update', name: table, args: payload });
      return { data: null, error: null };
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

  const q: any = { then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej) };
  q.select = () => q;
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
      const h = fake.rpc[name];
      const out = h ? h(args) : null;
      const shaped = out && typeof out === 'object' && ('error' in out || 'data' in out) ? { data: out.data ?? null, error: out.error ?? null } : { data: out, error: null };
      return Promise.resolve(shaped).then(res, rej);
    },
  }),
  auth: {
    getUser: async () => ({ data: { user: fake.user } }),
    getSession: async () => ({ data: { session: fake.user ? {} : null } }),
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
