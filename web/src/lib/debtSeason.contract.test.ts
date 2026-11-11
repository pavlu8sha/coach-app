import { describe, expect, it } from 'vitest';
import { DEBT_START } from './debtSeason';

const MIGRATION_SOURCES = import.meta.glob('../../../db/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

interface MigrationSource {
  file: string;
  sql: string;
}

interface Definition {
  file: string;
  line: number;
  body: string;
  date: string;
}

interface Range {
  from: number;
  to: number;
}

type DollarLiteral = Range & {
  kind: 'dollar';
  contentFrom: number;
  contentTo: number;
  delimiter: string;
};

type Token =
  | (Range & { kind: 'comment' })
  | (Range & { kind: 'string' })
  | DollarLiteral;

type Event =
  | { kind: 'drop'; index: number; file: string; line: number }
  | { kind: 'create'; index: number; file: string; line: number; body: string | null; reason?: string };

const FUNCTION_NAME = String.raw`(?:(?:"public"|public)\s*\.\s*)?"?debt_start"?\s*\(\s*\)`;
const CREATE_RE = new RegExp(String.raw`\bcreate\s+(?:or\s+replace\s+)?function\s+${FUNCTION_NAME}`, 'gi');
const DROP_RE = new RegExp(String.raw`\bdrop\s+function\s+(?:if\s+exists\s+)?${FUNCTION_NAME}`, 'gi');

function lineAt(sql: string, index: number): number {
  return sql.slice(0, index).split('\n').length;
}

function fileOf(key: string): string {
  const match = /([^/\\]+\.sql)$/.exec(key);
  if (!match) throw new Error(`unexpected migration path: ${key}`);
  return match[1];
}

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];

    if (ch === '-' && sql[i + 1] === '-') {
      const from = i;
      i += 2;
      while (i < sql.length && sql[i] !== '\n') i++;
      tokens.push({ kind: 'comment', from, to: i });
      continue;
    }

    if (ch === '/' && sql[i + 1] === '*') {
      const from = i;
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      if (depth > 0) throw new Error(`unterminated block comment at line ${lineAt(sql, from)}`);
      tokens.push({ kind: 'comment', from, to: i });
      continue;
    }

    if (ch === "'") {
      const from = i;
      const escapeString = from > 0
        && (sql[from - 1] === 'E' || sql[from - 1] === 'e')
        && (from < 2 || !/[A-Za-z0-9_$]/.test(sql[from - 2]));
      let closed = false;
      i++;
      while (i < sql.length) {
        if (escapeString && sql[i] === '\\' && i + 1 < sql.length) {
          i += 2;
        } else if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
          } else {
            i++;
            closed = true;
            break;
          }
        } else {
          i++;
        }
      }
      if (!closed) throw new Error(`unterminated string literal at line ${lineAt(sql, from)}`);
      tokens.push({ kind: 'string', from, to: i });
      continue;
    }

    if (ch === '$') {
      const match = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (match) {
        const delimiter = match[0];
        const from = i;
        const contentFrom = i + delimiter.length;
        const close = sql.indexOf(delimiter, contentFrom);
        if (close === -1) throw new Error(`unterminated dollar-quoted string ${delimiter} at line ${lineAt(sql, from)}`);
        i = close + delimiter.length;
        tokens.push({ kind: 'dollar', from, to: i, contentFrom, contentTo: close, delimiter });
        continue;
      }
    }

    i++;
  }

  return tokens;
}

function maskRanges(sql: string, ranges: Range[]): string {
  const chars = sql.split('');
  for (const { from, to } of ranges) {
    for (let i = from; i < to; i++) {
      if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
    }
  }
  return chars.join('');
}

function findBody(masked: string, sql: string, from: number, dollars: DollarLiteral[]): { body: string | null; reason?: string } {
  const asRe = /\bas\b/gi;
  asRe.lastIndex = from;
  const asMatch = asRe.exec(masked);
  if (!asMatch) return { body: null, reason: 'AS keyword not found' };

  const statementEnd = masked.indexOf(';', from);
  const limit = statementEnd === -1 ? masked.length : statementEnd;
  if (asMatch.index >= limit) return { body: null, reason: 'AS keyword not found before the end of the statement' };

  const afterAs = asMatch.index + asMatch[0].length;
  const literal = dollars.find(lit =>
    lit.from >= afterAs && lit.from < limit && masked.slice(afterAs, lit.from).trim() === '',
  );
  if (!literal) return { body: null, reason: 'dollar-quoted body not found after AS' };

  return { body: sql.slice(literal.contentFrom, literal.contentTo) };
}

function collectEvents(file: string, sql: string): Event[] {
  let tokens: Token[];
  try {
    tokens = tokenize(sql);
  } catch (error) {
    throw new Error(`${file}: ${(error as Error).message}`);
  }

  const masked = maskRanges(sql, tokens);
  const dollars = tokens.filter((token): token is DollarLiteral => token.kind === 'dollar');
  const events: Event[] = [];

  for (const match of masked.matchAll(CREATE_RE)) {
    const index = match.index ?? 0;
    const found = findBody(masked, sql, index + match[0].length, dollars);
    events.push({ kind: 'create', index, file, line: lineAt(sql, index), ...found });
  }

  for (const match of masked.matchAll(DROP_RE)) {
    const index = match.index ?? 0;
    events.push({ kind: 'drop', index, file, line: lineAt(sql, index) });
  }

  events.sort((a, b) => a.index - b.index);
  return events;
}

function literalDates(body: string): string[] {
  const clean = maskRanges(body, tokenize(body).filter(token => token.kind === 'comment'));
  const dates = new Set<string>();
  for (const match of clean.matchAll(/\bdate\s+'(\d{4}-\d{2}-\d{2})'|'(\d{4}-\d{2}-\d{2})'::date/gi)) {
    dates.add(match[1] ?? match[2]);
  }
  return [...dates];
}

function latestDebtStart(sources: MigrationSource[]): Definition {
  const migrations = sources
    .filter(({ file }) => /^\d{4}_.*\.sql$/.test(file))
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));

  let latest: Event | null = null;

  for (const { file, sql } of migrations) {
    for (const event of collectEvents(file, sql)) {
      latest = event;
    }
  }

  if (!latest || latest.kind === 'drop') {
    throw new Error('debt_start(): active definition not found in db/migrations');
  }

  if (latest.body === null) {
    throw new Error(
      `debt_start(): cannot determine the latest definition at ${latest.file}:${latest.line}: ${latest.reason}`,
    );
  }

  const dates = literalDates(latest.body);
  if (dates.length !== 1) {
    throw new Error(
      `debt_start(): cannot determine the latest date at ${latest.file}:${latest.line}: expected exactly one literal date, found ${dates.length ? dates.join(', ') : 'none'}`,
    );
  }

  return { file: latest.file, line: latest.line, body: latest.body, date: dates[0] };
}

const MIGRATIONS = Object.entries(MIGRATION_SOURCES).map(([key, sql]) => ({ file: fileOf(key), sql }));
const migration = (file: string, sql: string): MigrationSource => ({ file, sql });

describe('debt_start contract', () => {
  it('DEBT_START is the first day of a month', () => {
    expect(DEBT_START).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it('matches the latest SQL definition', () => {
    const definition = latestDebtStart(MIGRATIONS);
    if (definition.date !== DEBT_START) {
      throw new Error(
        `debt_start() mismatch at ${definition.file}:${definition.line}: SQL has ${definition.date}, DEBT_START is ${DEBT_START}`,
      );
    }
    expect(definition.date).toBe(DEBT_START);
  });
});

describe('latestDebtStart', () => {
  it('reads a $$ body', () => {
    const definition = latestDebtStart([
      migration('0001_a.sql', "create or replace function debt_start() returns date language sql immutable as $$ select date '2026-09-01' $$;"),
    ]);
    expect(definition.date).toBe('2026-09-01');
  });

  it('reads a named $function$ body', () => {
    const definition = latestDebtStart([
      migration('0001_a.sql', "create or replace function public.debt_start() returns date as $function$ select date '2026-09-01' $function$ language sql;"),
    ]);
    expect(definition.date).toBe('2026-09-01');
  });

  it('uses a later redefinition across migrations', () => {
    const definition = latestDebtStart([
      migration('0001_a.sql', "create or replace function debt_start() returns date as $$ select date '2026-09-01' $$;"),
      migration('0002_b.sql', "create or replace function debt_start() returns date as $$ select date '2026-10-01' $$;"),
    ]);
    expect(definition.date).toBe('2026-10-01');
    expect(definition.file).toBe('0002_b.sql');
  });

  it('applies CREATE and DROP in order', () => {
    const definition = latestDebtStart([
      migration('0001_a.sql', "create or replace function debt_start() returns date as $$ select date '2026-09-01' $$;"),
      migration('0002_b.sql', 'drop function if exists public.debt_start();'),
      migration('0003_c.sql', "create or replace function debt_start() returns date as $function$ select date '2026-11-01' $function$;"),
    ]);
    expect(definition.date).toBe('2026-11-01');
    expect(definition.file).toBe('0003_c.sql');
  });

  it('ignores commented CREATE and DROP statements', () => {
    const definition = latestDebtStart([
      migration('0001_a.sql', "create or replace function debt_start() returns date as $$ select date '2026-09-01' $$;"),
      migration('0002_b.sql', [
        "-- create or replace function debt_start() returns date as $$ select date '2030-01-01' $$;",
        '/* drop function debt_start();',
        "   create or replace function debt_start() returns date as $$ select date '2031-01-01' $$; */",
      ].join('\n')),
    ]);
    expect(definition.date).toBe('2026-09-01');
    expect(definition.file).toBe('0001_a.sql');
  });

  it('fails when there is no active definition', () => {
    expect(() => latestDebtStart([])).toThrow(/active definition not found/);
    expect(() => latestDebtStart([
      migration('0001_a.sql', 'drop function debt_start();'),
    ])).toThrow(/active definition not found/);
  });

  it('does not fall back to an older definition after the final DROP', () => {
    expect(() => latestDebtStart([
      migration('0001_a.sql', "create or replace function debt_start() returns date as $$ select date '2026-09-01' $$;"),
      migration('0002_b.sql', 'drop function debt_start();'),
    ])).toThrow(/active definition not found/);
  });

  it('fails when the latest body is not dollar-quoted', () => {
    expect(() => latestDebtStart([
      migration('0001_a.sql', "create or replace function debt_start() returns date as 'select date ''2026-09-01''' language sql;"),
    ])).toThrow(/cannot determine the latest definition.*dollar-quoted body/);
  });

  it('fails when the latest body has multiple dates', () => {
    expect(() => latestDebtStart([
      migration('0001_a.sql', "create or replace function debt_start() returns date as $$ select date '2026-09-01', date '2026-10-01' $$;"),
    ])).toThrow(/exactly one literal date/);
  });

  it('fails when the latest body has only a commented date', () => {
    expect(() => latestDebtStart([
      migration('0001_a.sql', "create or replace function debt_start() returns date as $$ -- date '2026-09-01'\n select null::date $$;"),
    ])).toThrow(/exactly one literal date, found none/);
  });
});
