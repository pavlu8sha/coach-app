import { describe, expect, it } from 'vitest';

// Сторожевой тест (docs/acceptance/user-errors-everywhere-2026-11-20.md №6): в исходниках нет сырого вывода ошибок пользователю.
const RAW = import.meta.glob(['./**/*.ts', './**/*.tsx', '!./**/*.test.ts', '!./**/*.test.tsx', '!./test/**'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const files = Object.keys(RAW);
const read = (f: string) => RAW[f];
const rel = (f: string) => f.replace(/^\.\//, '');
// файлы, которым сырое сообщение нужно, чтобы его классифицировать, а не показывать
const CLASSIFIERS = new Set(['lib/userError.ts', 'lib/role.ts', 'lib/safeFetch.ts']);
const MAPPER = /(err|error)\w*$/i;

describe('нет сырых ошибок в интерфейсе', () => {
  it('«.error.message» используется только как условие (includes/startsWith…) или аргумент маппера ошибок', () => {
    const bad: string[] = [];
    for (const f of files) {
      if (CLASSIFIERS.has(rel(f))) continue;
      const src = read(f);
      src.split('\n').forEach((line: string, i: number) => {
        if (/^\s*(\/\/|\/?\*)/.test(line) || /^\s*const m = \w+\.error\.message;$/.test(line)) return; // комментарии; `const m = …` дальше уходит в includes и маппер
        for (const m of line.matchAll(/\b\w+\??\.error!?\??\.message\b(\.\w+)?/g)) {
          if (m[1] && /^\.(includes|startsWith|endsWith|toLowerCase|match|indexOf|test)$/.test(m[1])) continue;
          const before = line.slice(0, m.index);
          const fn = /([A-Za-z_]\w*)\(\s*$/.exec(before)?.[1];
          if (fn && MAPPER.test(fn) && !/^set[A-Z]/.test(fn)) continue;
          bad.push(`${rel(f)}:${i + 1}: ${line.trim().slice(0, 120)}`);
        }
      });
    }
    expect(bad).toEqual([]);
  });

  it('«.message» не выводится пользователю ни из catch, ни из составных выражений', () => {
    const bad: string[] = [];
    for (const f of files) {
      if (CLASSIFIERS.has(rel(f))) continue;
      read(f).split('\n').forEach((line: string, i: number) => {
        if (/^\s*(\/\/|\/?\*)/.test(line) || /^\s*const m = \w+\.error\.message;$/.test(line)) return;
        for (const m of line.matchAll(/\.message\b(\.\w+)?/g)) {
          if (m[1] && /^\.(includes|startsWith|endsWith|toLowerCase|match|indexOf|test)$/.test(m[1])) continue;
          const before = line.slice(0, m.index);
          const fn = /([A-Za-z_]\w*)\(\s*(\w+(\.\w+)*|\(.*\)!?)$/.exec(before)?.[1];
          if (fn && MAPPER.test(fn) && !/^set[A-Z]/.test(fn)) continue; // errText(r.error.message)
          if (/\.test\(\s*[\w.]+$/.test(before)) continue; // /re/.test(error.message)
          bad.push(`${rel(f)}:${i + 1}: ${line.trim().slice(0, 120)}`);
        }
      });
    }
    expect(bad).toEqual([]);
  });

  it('мапперы ошибок не возвращают сырой текст запасным вариантом', () => {
    const bad: string[] = [];
    for (const f of files) {
      if (CLASSIFIERS.has(rel(f))) continue;
      const src = read(f);
      for (const m of src.matchAll(/(?:const|function)\s+(\w*(?:err|Err|error|Error)\w*)\s*(?:=\s*)?\(\s*(m|message)\s*:\s*string\s*\)/g)) {
        const rest = src.slice(m.index!, m.index! + 4000);
        const end = rest.search(/;\s*\n(?=\S)|\n}\n/);
        const body = rest.slice(0, end > 0 ? end : 600);
        const v = m[2];
        if (new RegExp(`(\\?\\?|:|return)\\s*${v}\\s*$`).test(body.trim().replace(/[;)]+$/, ''))) bad.push(`${rel(f)}: ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
