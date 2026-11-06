import { useEffect } from 'react';
import { useConfirm } from '../ui/ConfirmSheet';
import { dirtyGuard } from './dirtyGuard';

/** Подключает окно «Уйти без сохранения?» к общему предупреждению. Монтируется один раз у корня приложения. */
export default function DirtyGuardHost() {
  const { ask, dialog } = useConfirm();
  useEffect(() => {
    dirtyGuard.setAsker(() => ask({ title: 'Уйти без сохранения?', note: 'Введённые изменения не сохранятся.', confirmLabel: 'Уйти', danger: true }));
    return () => dirtyGuard.setAsker(null);
  }, [ask]);
  return dialog;
}
