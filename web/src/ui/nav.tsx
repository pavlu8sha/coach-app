// Нативные кнопки Telegram с запасным вариантом вне Telegram.
import { useEffect, useRef } from 'react';
import { inTelegram, tgApp } from '../lib/telegram';
import { BackButton } from './components';

/** «Назад»: кнопка на экране всегда (в клиентах Telegram шапка её может не показывать); в Telegram дополнительно нативная кнопка в шапке. */
export function BackNav({ onBack }: { onBack: () => void }) {
  const native = inTelegram();
  useEffect(() => {
    const b = tgApp()?.BackButton;
    if (!native || !b) return;
    b.onClick(onBack);
    b.show();
    return () => {
      b.offClick(onBack);
      b.hide();
    };
  }, [native, onBack]);
  return <BackButton onClick={onBack} />;
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
