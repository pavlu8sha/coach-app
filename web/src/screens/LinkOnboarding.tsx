import { useState, type ReactNode } from 'react';
import { ADMIN_CHAT } from '../lib/clubInfo';
import { ListRow, Pill } from '../ui/components';
import Link from './Link';
import { STATUS, type Req } from './LinkStatus';

const STEPS = ['Найдите ребёнка по фамилии и имени', 'Отметьте согласие на обработку данных', 'Дождитесь подтверждения администратора клуба'];

const Steps = ({ current }: { current: number }) => (
  <ol className="ks-card ks-steps" aria-label="Шаги подключения">
    {STEPS.map((s, i) => (
      <li key={s} className={i < current ? 'done' : undefined} aria-current={i === current ? 'step' : undefined}>
        <span className="n" aria-hidden="true">{i < current ? '✓' : i + 1}</span>
        <span className="tx">{s}</span>
      </li>
    ))}
  </ol>
);

// Заголовок состояния: иконка, заголовок и пояснение по центру
const Head = ({ tone, title, children, icon }: { tone?: 'warning' | 'danger'; title: string; children: ReactNode; icon: ReactNode }) => (
  <div className="ks-state">
    <span className={`ks-ico${tone ? ` ${tone}` : ''}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
    </span>
    <h1>{title}</h1>
    <p className="muted">{children}</p>
  </div>
);
const I_USER = <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>;
const I_CLOCK = <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>;
const I_ALERT = <><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5h.01" /></>;

const AdminLink = ({ children }: { children: string }) => (
  <a href={ADMIN_CHAT} target="_blank" rel="noreferrer">{children}</a>
);

// Родитель вошёл, но ребёнок не привязан: один понятный путь вместо пустых блоков.
// Новые данные не запрашиваются: запросы родителя уже загружены главной.
export default function LinkOnboarding({ reqs, onApproved, onOpenStatus, onGuest }: { reqs: Req[]; onApproved: () => void; onOpenStatus: () => void; onGuest?: () => void }) {
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
        <Head tone="warning" title="Запрос отправлен" icon={I_CLOCK}>Как только администратор клуба его подтвердит, здесь появятся баллы ребёнка. Отправлять запрос ещё раз не нужно.</Head>
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
        <Head tone="danger" title="Ребёнок пока не отображается" icon={I_ALERT}>
          Запрос подтверждён, но доступ к профилю не виден. Закройте приложение и откройте снова. Если не помогло, <AdminLink>напишите администратору клуба</AdminLink>: он восстановит доступ.
        </Head>
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
        <Head title="Подключите профиль ребёнка" icon={I_USER}>Расписание, баллы и матчи появятся после того, как администратор клуба подтвердит, что это ваш ребёнок.</Head>
        <Steps current={0} />
        {rejected && (
          <p className="ks-card note" role="status">
            <Pill tone="danger" dot>Отклонено</Pill>
            <br />
            Прошлый запрос был отклонён. Можно попробовать снова или <AdminLink>написать администратору клуба</AdminLink>.
          </p>
        )}
        <button type="button" className="ks-btn" onClick={() => setSearching(true)}>
          Найти ребёнка
        </button>
        {statusRow && <div style={{ marginTop: 12 }}>{statusRow}</div>}
        {onGuest && (
          <p className="muted note" style={{ textAlign: 'center', marginTop: 16 }}>
            Нет ребёнка в клубе?{' '}
            <button type="button" className="link-btn" onClick={onGuest}>
              Просто посмотреть клуб
            </button>
          </p>
        )}
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
