import type { CoachGroup } from '../lib/coach';
import type { SectionId } from '../lib/adminMenu';
import AdminPhotos from './AdminPhotos';
import AdminPrices from './AdminPrices';
import Admin from './Admin';
import Camps from './Camps';
import Coaches from './Coaches';
import CoachMatches from './CoachMatches';
import Equipment from './Equipment';
import Extra from './Extra';
import Group from './Group';
import Individual from './Individual';
import Leads from './Leads';
import MenuSettings from './MenuSettings';
import Money from './Money';
import Players from './Players';
import PointsStart from './PointsStart';
import RecalcPoints from './RecalcPoints';
import Schedule from './Schedule';
import Sessions from './Sessions';
import Stats from './Stats';
import TrainerLog from './TrainerLog';

// Экран раздела администратора: одинаков, лежит ли раздел на нижней панели или в «Ещё»
export default function AdminSection({ id, groups, onMenuChanged }: { id: SectionId; groups: CoachGroup[]; onMenuChanged: () => void }) {
  switch (id) {
    case 'sessions': return <Sessions groups={groups} />;
    case 'players': return <Players />;
    case 'money': return <Money />;
    case 'cmatches': return <CoachMatches groups={groups} admin />;
    case 'requests': return <Admin />;
    case 'ind': return <Individual />;
    case 'extra': return <Extra />;
    case 'schedule': return <Schedule all />;
    case 'equip': return <Equipment />;
    case 'camps': return <Camps />;
    case 'photos': return <AdminPhotos />;
    case 'leads': return <Leads />;
    case 'stats': return <Stats />;
    case 'tlog': return <TrainerLog />;
    case 'points': return <Group groups={groups} />;
    case 'coaches': return <Coaches />;
    case 'prices': return <AdminPrices />;
    case 'pstart': return <PointsStart />;
    case 'recalc': return <RecalcPoints />;
    case 'menu': return <MenuSettings onChanged={onMenuChanged} />;
  }
}
