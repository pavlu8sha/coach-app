import { Pill } from './components';
import { RESULT_NAME, matchPoints, resultKind, type Participation } from '../lib/parentMatches';

const TONE = { w: 'success', d: 'warning', l: 'danger' } as const;

/** Оценка 1-5 точками; без оценки не рисуется. */
export function RatingDots({ rating }: { rating: number }) {
  return (
    <span className="ks-rate" role="img" aria-label={`Оценка ${rating} из 5`}>
      {[1, 2, 3, 4, 5].map(n => <i key={n} className={n <= rating ? 'f' : ''} />)}
    </span>
  );
}

export interface ResultRowProps {
  title: string;
  /** дата, команда и т. п. — первая строка подписи */
  meta: string;
  gf: number | null;
  ga: number | null;
  /** участие своего ребёнка: «Играл», «Не играл» или без пометки; с именем при нескольких детях */
  kids?: { name?: string; status: Participation; goals?: number; best?: boolean; rating?: number | null }[];
}

/** Строка результата матча: светофор слева, счёт и В/Н/П справа, участие, оценка (условия О1-О5). */
export default function MatchResultRow({ title, meta, gf, ga, kids = [] }: ResultRowProps) {
  const kind = resultKind(gf, ga);
  const scored = kind !== 'n';
  return (
    <div className={`ks-row ks-mres ${kind}`}>
      <span className="ks-row-main">
        <span className="ks-row-title">{title}</span>
        <span className="ks-row-sub">{meta}</span>
        {kids.filter(k => k.status).map((k, i) => (
          <span className="ks-row-sub ks-mres-kid" key={i}>
            {k.name ? `${k.name}: ` : ''}
            <b>{k.status === 'played' ? 'Играл' : 'Не играл'}</b>
            {k.status === 'played' && (k.goals ?? 0) > 0 && ` · голы: ${k.goals}`}
            {k.status === 'played' && k.best && <span className="ks-mres-star"> · ★ Лучший</span>}
            {k.status === 'played' && k.rating != null && (
              <span className="ks-mres-rate">
                <RatingDots rating={k.rating} />
                {scored && <span>+{matchPoints(k.rating, Boolean(k.best))} б.</span>}
              </span>
            )}
          </span>
        ))}
      </span>
      <span className="ks-row-end">
        {scored ? (
          <>
            <span className="ks-score">{gf}:{ga}</span>
            <Pill tone={TONE[kind as 'w' | 'd' | 'l']}>{RESULT_NAME[kind as 'w' | 'd' | 'l']}</Pill>
          </>
        ) : (
          <Pill>Без счёта</Pill>
        )}
      </span>
    </div>
  );
}

/** Плитка сводки: «16 побед» цветом светофора. */
export function ResultTiles({ wins, draws, losses }: { wins: number; draws: number; losses: number }) {
  return (
    <div className="ks-mres-tiles" role="group" aria-label="Результаты матчей">
      <div className="ks-tile w"><b>побед</b>{wins}</div>
      <div className="ks-tile d"><b>ничьих</b>{draws}</div>
      <div className="ks-tile l"><b>поражений</b>{losses}</div>
    </div>
  );
}
