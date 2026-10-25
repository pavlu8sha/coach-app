import { useState } from 'react';
import { ADMIN_CHAT } from '../lib/clubInfo';
import { ListRow, Pill } from '../ui/components';
import Link from './Link';
import { STATUS, type Req } from './LinkStatus';

const STEPS = ['Найдите ребёнка по фамилии и имени', 'Отметьте согласие на обработку данных', 'Дождитесь подтверждения администратора клуба'];

const Steps = ({ current }: { current: number }) => (
  <ol className="ks-card" style={{ margin: '0 0 12px', paddingLeft: 36 }} aria-label="Шаги подключения">
    {STEPS.map((s, i) => (
      <li key={s} aria-current={i === current ? 'step' : undefined} style={{ margin: '6px 0', fontWeight: i === current ? 600 : 400 }}>
        {s}
      </li>
    ))}
  </ol>
);

const AdminLink = ({ children }: { children: string }) => (
  <a href={ADMIN_CHAT} target="_blank" rel="noreferrer">{children}</a>
);

// Родитель вошёл, но ребёнок не привязан: один понятный путь вместо пустых блоков.
// Новые данные не запрашиваются: запросы родителя уже загружены главной.
export default function LinkOnboarding({ reqs, onApproved, onOpenStatus }: { reqs: Req[]; onApproved: () => void; onOpenStatus: () => void }) {
  const [searching, setSearching] = useState(false);
  const waiting = reqs.filter(r => r.status === 'pending').length;
  const rejected = reqs.some(r => r.status === 'rejected');
  // подтверждённый запрос есть, а ребёнка в списке нет: повторная привязка не поможет, нужно восстановить доступ
  const approvedNoAccess = waiting === 0 && reqs.some(r => r.status === 'approved');

  const statusRow = reqs.length > 0 && (
    <ListRow
      title="Статус запросов"
      sub={[`Всего: ${reqs.length}`, ...(waiting ? [<Pill tone={STATUS.pending.tone} dot>{STATUS.pending.label}</Pill>] : []), ...(rejected ? [<Pill tone={STATUS.rejected.tone} dot>{STATUS.rejected.label}</Pill>] : [])]}
      onClick={onOpenStatus}
    />
  );

  if (waiting > 0 && !searching) {
    return (
      <main className="page">
        <h1>Запрос отправлен</h1>
        <p className="muted" style={{ marginBottom: 14 }}>Как только администратор клуба его подтвердит, здесь появятся баллы ребёнка. Отправлять запрос ещё раз не нужно.</p>
        <Steps current={2} />
        {statusRow}
        <button type="button" className="ks-btn secondary" style={{ marginTop: 12 }} onClick={() => setSearching(true)}>
          Добавить другого ребёнка
        </button>
      </main>
    );
  }

  if (approvedNoAccess && !searching) {
    return (
      <main className="page">
        <h1>Ребёнок пока не отображается</h1>
        <p className="muted" style={{ marginBottom: 14 }}>
          Запрос подтверждён, но доступ к профилю не виден. Закройте приложение и откройте снова. Если не помогло, <AdminLink>напишите администратору клуба</AdminLink>: он восстановит доступ.
        </p>
        {statusRow}
        <button type="button" className="ks-btn secondary" style={{ marginTop: 12 }} onClick={() => setSearching(true)}>
          Найти другого ребёнка
        </button>
      </main>
    );
  }

  if (!searching) {
    return (
      <main className="page">
        <h1>Подключите профиль ребёнка</h1>
        <p className="muted" style={{ marginBottom: 14 }}>Расписание, баллы и матчи появятся после того, как администратор клуба подтвердит, что это ваш ребёнок.</p>
        <Steps current={0} />
        {rejected && (
          <p className="muted note" style={{ marginBottom: 12 }}>
            Прошлый запрос был отклонён. Можно попробовать снова или <AdminLink>написать администратору клуба</AdminLink>.
          </p>
        )}
        <button type="button" className="ks-btn" onClick={() => setSearching(true)}>
          Найти ребёнка
        </button>
        {statusRow && <div style={{ marginTop: 12 }}>{statusRow}</div>}
      </main>
    );
  }

  return (
    <main className="page">
      <h1>Подключите профиль ребёнка</h1>
      <Link onApproved={onApproved} onOpenStatus={onOpenStatus} />
    </main>
  );
}
