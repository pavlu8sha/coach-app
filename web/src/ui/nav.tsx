// Нативные кнопки Telegram с запасным вариантом вне Telegram.
import { useEffect, useRef } from 'react';
import { inTelegram, tgApp } from '../lib/telegram';
import { backStack } from '../nav/backStack';
import { BackButton } from './components';

/** «Назад»: оболочка над общим стеком (nav/backStack). Обработчик попадает в единый стек: его вызывают нативная кнопка Telegram,
 *  системная «Назад» браузера/PWA и кнопка на экране. В Telegram своей кнопки на экране нет, в браузере она рисуется здесь. */
export function BackNav({ onBack, managed }: { onBack: () => void; managed?: boolean }) {
  const native = inTelegram() && Boolean(tgApp()?.BackButton);
  const cb = useRef(onBack);
  cb.current = onBack;
  // managed: экран открыт через стек навигации, его «Назад» уже зарегистрирован слоем (NavRoot): второй обработчик не нужен
  useEffect(() => (managed ? undefined : backStack().register(() => cb.current())), [managed]);
  return native ? null : <BackButton onClick={onBack} />;
}

/** Главная кнопка Telegram для единственного главного действия экрана. Возвращает true, если кнопка Telegram доступна;
 *  иначе экран должен показать обычную кнопку. */
export function useMainButton(o: { text: string; visible: boolean; enabled: boolean; loading?: boolean; onClick: () => void }): boolean {
  const native = inTelegram() && Boolean(tgApp()?.MainButton);
  const click = useRef(o.onClick);
  click.current = o.onClick;
  useEffect(() => {
    const b = tgApp()?.MainButton;
    if (!native || !b || !o.visible) return;
    const handler = () => click.current();
    b.setText(o.text);
    b.onClick(handler);
    b.show();
    return () => {
      b.offClick(handler);
      b.hideProgress();
      b.hide();
    };
  }, [native, o.visible, o.text]);
  useEffect(() => {
    const b = tgApp()?.MainButton;
    if (!native || !b || !o.visible) return;
    if (o.enabled && !o.loading) b.enable();
    else b.disable();
    if (o.loading) b.showProgress(false);
    else b.hideProgress();
  }, [native, o.visible, o.enabled, o.loading]);
  return native;
}
