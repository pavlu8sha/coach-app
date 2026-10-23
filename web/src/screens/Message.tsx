import type { ReactNode } from 'react';
import { EmptyState, SkeletonRows } from '../ui/components';

export default function Message(props: { title: string; text?: string; action?: { label: string; run: () => void } }) {
  return (
    <main className="page center">
      <h1>{props.title}</h1>
      {props.text && <p className="muted">{props.text}</p>}
      {props.action && (
        <button className="btn" onClick={props.action.run}>
          {props.action.label}
        </button>
      )}
    </main>
  );
}

/** Загрузка: скелетон без выдуманных данных. */
export function Loading() {
  return (
    <main className="page" role="status" aria-label="Загрузка">
      <SkeletonRows count={4} />
    </main>
  );
}

/** Ошибка загрузки с повтором. Повтор безопасен: экраны только читают данные. */
export function Failure(props: { title: string; text: string; onRetry: () => void; back?: ReactNode }) {
  return (
    <main className="page">
      {props.back}
      <EmptyState icon="alert" title={props.title} text={props.text} action={{ label: 'Повторить', run: props.onRetry }} />
    </main>
  );
}
