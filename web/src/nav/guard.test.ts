// Тест-страж общего механизма навигации (#518, критерий 5 и 10): новые экраны не должны обходить слой src/nav
// локальными решениями. Если проверка падает, не добавляйте исключение молча: либо переведите экран на useNavState / стек,
// либо объясните исключение в списке ниже.
import { describe, expect, it } from 'vitest';

const files = import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const sources = Object.entries(files)
  .map(([path, text]) => [path.startsWith('./') ? path.replace('./', 'src/nav/') : path.replace('../', 'src/'), text] as const)
  .filter(([path]) => !/\.test\.tsx?$/.test(path) && !path.startsWith('src/test/'));

const filesWith = (re: RegExp) => sources.filter(([, text]) => re.test(text)).map(([path]) => path).sort();

describe('общий слой навигации: страж', () => {
  it('браузерное хранилище используется только в известных местах', () => {
    expect(filesWith(/\b(localStorage|sessionStorage)\b/)).toEqual([
      'src/App.tsx', // режим «Родитель» у тренера (настройка, не состояние экрана)
      'src/lib/theme.ts', // тема оформления
      'src/nav/storage.ts', // снимок состояния навигации (белый список)
      'src/screens/Debtors.tsx', // шаблон сообщения должникам (текст-настройка, не состояние экрана)
    ]);
  });

  it('история браузера, popstate, beforeunload и прокрутка страницы управляются только из nav и окна подтверждения', () => {
    expect(filesWith(/\bhistory\.(pushState|replaceState|back|forward|go)\b|\bpopstate\b|\bbeforeunload\b|window\.scrollTo\(|scrollTop\s*=/)).toEqual([
      'src/nav/backStack.ts',
      'src/nav/dirtyGuard.ts',
      'src/nav/react.tsx',
      'src/ui/ConfirmSheet.tsx', // блокировка прокрутки под модальным окном
    ]);
  });

  it('на диск не объявляются поля, похожие на поиск, имена, тексты и суммы', () => {
    const bad: string[] = [];
    const re = /useNavState(?:<[^>]*>)?\(\s*['"`]([^'"`]+)['"`][^)]*persist:/g;
    for (const [path, text] of sources) {
      for (const m of text.matchAll(re)) {
        const name = m[1].split('.').pop() ?? '';
        if (/^(q|search|query|find|name|text|note|comment|amount|sum|phone|message|title|body)$/i.test(name)) bad.push(`${path}: ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('системная «Назад» регистрируется только через BackNav и слой nav', () => {
    expect(filesWith(/backStack\(\)\.register\(/)).toEqual(['src/nav/react.tsx', 'src/ui/nav.tsx']);
  });

  it('вложенные экраны открываются стеком, а не локальными переменными «открыто / показать»: в переведённых экранах нет useState для перехода', () => {
    // Список ориентирован на экраны, где навигация уже переведена на стек. Исключения — формы и временные переключатели без шага «Назад».
    const navigated = ['Coaches', 'Equipment', 'Camps', 'Players', 'PlayerCard', 'Profile', 'About', 'ClubArticles', 'MyKids', 'Home', 'More'];
    const bad: string[] = [];
    for (const name of navigated) {
      const text = files[`../screens/${name}.tsx`];
      if (!text) continue;
      for (const m of text.matchAll(/const \[(open|selected|opened|statusOpen|view|materials|product)\b[^\]]*\]\s*=\s*useState/g)) bad.push(`${name}: ${m[1]}`);
    }
    expect(bad).toEqual([]);
  });
});
