import { useCallback, useEffect, useState } from 'react';
import { useNavState } from '../nav';
import { fmtDate, plural } from '../lib/coach';
import { fetchLedgerTotals } from '../lib/pointsLedger';
import { supabase } from '../lib/supabase';
import { Avatar, BackButton, EmptyState, Pill, Segmented, type Tone } from '../ui/components';
import { Failure, Loading } from './Message';
import PointsLedger from './PointsLedger';

// Профиль игрока для родителя и ребёнка (#266, этапы 1–2; условия П1.*, П2.11–П2.14 в docs/PLAYER_PROFILE_ACCEPTANCE.md).
// Только данные этого ребёнка: строку игрока, его матчи и посещения отдаёт сервер по правам (RLS и player_training_history).
// Фото, номера, позиции, «Прогресса» и «Достижений» пока нет: не показываем их как работающие.

type Section = 'overview' | 'matches' | 'trainings' | 'points';

interface Player { id: string; full_name: string; birth_date: string | null; groups: { name: string } | null }
interface MatchRow { match_id: string; goals: number; matches: { played_on: string; team: string; opponent: string | null; goals_for: number | null; goals_against: number | null } | null }
export interface TrainingRow { day: string; starts_at: string | null; kind: 'group' | 'guest' | 'individual' | 'goalkeeper' | 'extra'; title: string; group_name: string | null; status: 'present' | 'absent' | 'excused' | 'unmarked' }

const WINDOW = 90; // дней в одной порции ленты
const MAX_BACK = 360; // лента не глубже примерно года (четыре порции)

/** Сегодня по Тбилиси (YYYY-MM-DD), как считает сервер. */
export const tbilisiToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tbilisi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shiftDay = (iso: string, d: number) => {
  const t = new Date(`${iso}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
};

export const STATUS_LABEL: Record<TrainingRow['status'], string> = { present: 'Был', absent: 'Не был', excused: 'Уважительная причина', unmarked: 'Нет отметки' };
const STATUS_TONE: Record<TrainingRow['status'], Tone> = { present: 'success', absent: 'danger', excused: 'warning', unmarked: 'neutral' };

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="ks-slot">
      <span className="ks-slot-main">{label}</span>
      <b style={{ textAlign: 'right' }}>{value}</b>
    </div>
  );
}

function Trainings(props: { rows: TrainingRow[] | null; error: string | null; busy: boolean; canMore: boolean; onMore: () => void; onRetry: () => void }) {
  const { rows } = props;
  return (
    <section className="ks-card" aria-label="Тренировки">
      <p className="muted" style={{ marginTop: 0 }}>
        История групповых занятий собирается с первой отметки ребёнка. «Нет отметки» значит, что тренер не отметил посещение.
      </p>
      {rows && rows.length === 0 && !props.error && <EmptyState icon="calendar" title="Отмеченных тренировок за этот период нет" />}
      {rows && rows.length > 0 && (
        <ul className="ks-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {rows.map((r, i) => (
            <li key={`${r.day}|${r.starts_at ?? ''}|${r.kind}|${i}`} className="ks-slot">
              <span className="ks-slot-main">
                {r.title}
                <span className="ks-muted">{[fmtDate(r.day), ...(r.starts_at ? [r.starts_at.slice(0, 5)] : []), ...(r.group_name && r.kind === 'group' ? [r.group_name] : [])].join(' · ')}</span>
              </span>
              <Pill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Pill>
            </li>
          ))}
        </ul>
      )}
      {props.error && (
        <p className="error" role="alert">
          Не удалось загрузить тренировки: {props.error}{' '}
          <button type="button" className="ks-btn secondary" onClick={props.onRetry}>
            Повторить
          </button>
        </p>
      )}
      {rows && props.canMore && !props.error && (
        <button type="button" className="ks-btn secondary" disabled={props.busy} onClick={props.onMore}>
          Показать ещё {WINDOW} дней
        </button>
      )}
    </section>
  );
}

export default function PlayerProfile({ playerId, onBack }: { playerId: string; onBack: () => void }) {
  const [player, setPlayer] = useState<Player | null | undefined>(undefined); // undefined — загрузка, null — нет доступа
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [points, setPoints] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [section, setSection] = useNavState<Section>('profile.section', 'overview');
  // лента тренировок: загружено от from до сегодня; догружается порциями назад
  const [train, setTrain] = useState<TrainingRow[] | null>(null);
  const [trainFrom, setTrainFrom] = useState<string | null>(null);
  const [trainErr, setTrainErr] = useState<string | null>(null);
  const [trainBusy, setTrainBusy] = useState(false);

  const loadTrain = useCallback(async (to: string) => {
    const from = shiftDay(to, -(WINDOW - 1));
    setTrainBusy(true);
    setTrainErr(null);
    const r = await supabase.rpc('player_training_history', { p: playerId, p_from: from, p_to: to });
    setTrainBusy(false);
    if (r.error) return setTrainErr(r.error.message);
    setTrain(prev => [...(prev ?? []), ...((r.data ?? []) as TrainingRow[])]);
    setTrainFrom(from);
  }, [playerId]);

  useEffect(() => {
    let live = true;
    setPlayer(undefined);
    setError(null);
    setTrain(null);
    setTrainFrom(null);
    void (async () => {
      const pl = await supabase.from('players').select('id, full_name, birth_date, groups(name)').eq('id', playerId).maybeSingle();
      if (!live) return;
      if (pl.error) return setError(pl.error.message);
      if (!pl.data) return setPlayer(null);
      const [mp, led] = await Promise.all([
        supabase.from('match_players').select('match_id, goals, matches(played_on, team, opponent, goals_for, goals_against)').eq('player_id', playerId).eq('played', true),
        fetchLedgerTotals([playerId]),
      ]);
      if (!live) return;
      if (mp.error) return setError(mp.error.message);
      if (led.error) return setError(led.error);
      const rows = ((mp.data ?? []) as unknown as MatchRow[]).filter(r => r.matches);
      rows.sort((a, b) => (a.matches!.played_on < b.matches!.played_on ? 1 : -1));
      setMatches(rows);
      setPoints(led.totals[playerId] ?? 0);
      setPlayer(pl.data as unknown as Player);
      void loadTrain(tbilisiToday());
    })();
    return () => {
      live = false;
    };
  }, [playerId, reload, loadTrain]);

  const back = (
    <div style={{ marginBottom: 8 }}>
      <BackButton onClick={onBack} />
    </div>
  );
  if (error) return <Failure title="Не удалось загрузить профиль" text={error} onRetry={() => setReload(n => n + 1)} back={back} />;
  if (player === undefined) return <Loading title="Профиль игрока" />;
  if (player === null) {
    return (
      <main className="page">
        {back}
        <h1>Профиль недоступен</h1>
        <p className="muted">Этот профиль сейчас недоступен вашему аккаунту.</p>
      </main>
    );
  }

  const goals = matches.reduce((s, m) => s + (m.goals ?? 0), 0);
  const lastPresent = train?.find(r => r.status === 'present');
  const canMore = trainFrom !== null && trainFrom > shiftDay(tbilisiToday(), -(MAX_BACK - 1));

  return (
    <main className="page">
      {back}
      <section className="ks-card" aria-label="Игрок">
        <div className="ks-kid-head">
          <Avatar name={player.full_name} large />
          <div className="ks-kid-who">
            <h1 style={{ margin: 0 }}>{player.full_name}</h1>
            {player.groups?.name && <p className="muted">{player.groups.name}</p>}
            {player.birth_date && <p className="muted">Год рождения: {player.birth_date.slice(0, 4)}</p>}
          </div>
        </div>
      </section>

      <Segmented<Section>
        label="Разделы профиля"
        value={section}
        onChange={setSection}
        items={[
          { value: 'overview', label: 'Обзор' },
          { value: 'matches', label: 'Матчи' },
          { value: 'trainings', label: 'Тренировки' },
          { value: 'points', label: 'Баллы' },
        ]}
      />

      {section === 'overview' && (
        <section className="ks-card" aria-label="Обзор">
          {matches.length ? <Line label="Сыграно матчей" value={`${matches.length} · голов: ${goals}`} /> : <Line label="Матчи" value="Пока нет отмеченных матчей" />}
          <Line label="Баллы" value={`${points} ${plural(points)}`} />
          <Line
            label="Последняя тренировка"
            value={trainErr ? 'Не удалось загрузить' : !train ? '…' : lastPresent ? fmtDate(lastPresent.day) : `За ${WINDOW} дней посещений не отмечено`}
          />
        </section>
      )}

      {section === 'matches' && (
        <section className="ks-card" aria-label="Матчи">
          {matches.length === 0 ? (
            <EmptyState icon="trophy" title="Отмеченных матчей пока нет" text="Здесь матчи, где тренер отметил участие ребёнка. Все матчи команды есть во вкладке «Матчи»." />
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {matches.map(m => {
                const x = m.matches!;
                const score = x.goals_for !== null && x.goals_against !== null ? `Счёт команды ${x.goals_for}:${x.goals_against}` : 'Счёт не внесён';
                return (
                  <li key={m.match_id} className="ks-slot">
                    <span className="ks-slot-main">
                      {x.team}
                      {x.opponent ? ` — ${x.opponent}` : ''}
                      <span className="ks-muted">{[fmtDate(x.played_on), score].join(' · ')}</span>
                    </span>
                    <span>{m.goals > 0 ? `Голы: ${m.goals}` : 'Играл'}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {section === 'trainings' && (
        <Trainings
          rows={train}
          error={trainErr}
          busy={trainBusy}
          canMore={canMore}
          onMore={() => trainFrom && void loadTrain(shiftDay(trainFrom, -1))}
          onRetry={() => void loadTrain(trainFrom ? shiftDay(trainFrom, -1) : tbilisiToday())}
        />
      )}

      {section === 'points' && <PointsLedger playerId={player.id} showEmpty />}
    </main>
  );
}
