import { describe, expect, it } from 'vitest';
import { DEBT_START } from './debtSeason';

const MIGRATION_SOURCES = import.meta.glob('../../../db/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const CREATE_RE = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?debt_start\s*\(\s*\)[\s\S]*?\$\$([\s\S]*?)\$\$/gi;
const DROP_RE = /drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?debt_start\s*\(\s*\)/gi;

interface Definition {
  file: string;
  line: number;
  body: string;
}

function lineAt(sql: string, index: number): number {
  return sql.slice(0, index).split('\n').length;
}

function fileOf(key: string): string {
  const match = /([^/\\]+\.sql)$/.exec(key);
  if (!match) throw new Error(`unexpected migration path: ${key}`);
  return match[1];
}

function latestDebtStart(): Definition {
  const migrations = Object.entries(MIGRATION_SOURCES)
    .map(([key, sql]) => ({ file: fileOf(key), sql }))
    .filter(({ file }) => /^\d{4}_.*\.sql$/.test(file))
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  let latest: Definition | null = null;

  for (const { file, sql } of migrations) {
    const events: { kind: 'create' | 'drop'; index: number; body?: string }[] = [];

    for (const match of sql.matchAll(CREATE_RE)) {
      events.push({ kind: 'create', index: match.index ?? 0, body: match[1] });
    }
    for (const match of sql.matchAll(DROP_RE)) {
      events.push({ kind: 'drop', index: match.index ?? 0 });
    }

    events.sort((a, b) => a.index - b.index);
    for (const event of events) {
      latest = event.kind === 'create'
        ? { file, line: lineAt(sql, event.index), body: event.body ?? '' }
        : null;
    }
  }

  if (!latest) throw new Error('debt_start(): active definition not found in db/migrations');
  return latest;
}

function literalDates(body: string): string[] {
  const dates = new Set<string>();
  for (const match of body.matchAll(/\bdate\s+'(\d{4}-\d{2}-\d{2})'|'(\d{4}-\d{2}-\d{2})'::date/gi)) {
    dates.add(match[1] ?? match[2]);
  }
  return [...dates];
}

describe('debt_start contract', () => {
  it('DEBT_START is the first day of a month', () => {
    expect(DEBT_START).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it('matches the latest SQL definition', () => {
    const definition = latestDebtStart();
    const dates = literalDates(definition.body);
    if (dates.length !== 1) {
      throw new Error(
        `debt_start(): expected exactly one literal date in ${definition.file}:${definition.line}, found ${dates.length ? dates.join(', ') : 'none'}`,
      );
    }
    if (dates[0] !== DEBT_START) {
      throw new Error(
        `debt_start() mismatch at ${definition.file}:${definition.line}: SQL has ${dates[0]}, DEBT_START is ${DEBT_START}`,
      );
    }
  });
});
