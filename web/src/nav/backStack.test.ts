import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackStack, type HistoryAdapter } from './backStack';

function setup() {
  let pop: () => void = () => {};
  const log: string[] = [];
  const h: HistoryAdapter = { push: () => log.push('push'), go: d => log.push(`go${d}`), onPop: cb => ((pop = cb), () => {}) };
  return { stack: new BackStack(h), log, pop: () => pop() };
}
const flush = () => Promise.resolve();

describe('BackStack: единая «Назад»', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('каждый обработчик добавляет запись истории', () => {
    const { stack, log } = setup();
    stack.register(() => {});
    stack.register(() => {});
    expect(log).toEqual(['push', 'push']);
    expect(stack.size()).toBe(2);
  });

  it('системная «Назад» вызывает верхний обработчик и не откатывает историю второй раз', async () => {
    const { stack, log, pop } = setup();
    const calls: string[] = [];
    let off2 = () => {};
    stack.register(() => calls.push('a'));
    off2 = stack.register(() => {
      calls.push('b');
      off2(); // экран закрылся и снял обработчик
    });
    pop();
    await flush();
    expect(calls).toEqual(['b']);
    expect(log).toEqual(['push', 'push']); // go(-1) не вызывался: запись уже снята браузером
  });

  it('кнопка на экране: снятие обработчика убирает запись истории', async () => {
    const { stack, log } = setup();
    const off = stack.register(() => {});
    expect(stack.invoke()).toBe(true);
    off();
    await flush();
    expect(log).toEqual(['push', 'go-1']);
  });

  it('несколько снятых обработчиков откатывают историю одним переходом, а ответный popstate игнорируется', async () => {
    const { stack, log, pop } = setup();
    const calls: string[] = [];
    const a = stack.register(() => calls.push('a'));
    const b = stack.register(() => calls.push('b'));
    a();
    b();
    await flush();
    expect(log).toEqual(['push', 'push', 'go-2']);
    pop(); // событие от нашего go(-2)
    expect(calls).toEqual([]);
  });

  it('обработчик остался на экране: запись истории возвращается', () => {
    const { stack, log, pop } = setup();
    let n = 0;
    stack.register(() => n++);
    pop();
    vi.runAllTimers();
    expect(n).toBe(1);
    expect(log).toEqual(['push', 'push']);
    pop();
    expect(n).toBe(2);
  });

  it('без обработчиков popstate ничего не делает (браузер уходит как обычно)', () => {
    const { stack, pop } = setup();
    pop();
    expect(stack.size()).toBe(0);
    expect(stack.invoke()).toBe(false);
  });
});
