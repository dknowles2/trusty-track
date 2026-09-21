import { useParams } from 'react-router-dom';
import Leaderboard from '../components/Leaderboard';
import RaceViewHeading from '../../core/components/RaceViewHeading';
import { useRaceLocked } from '../../core/hooks/useRaceLocked';

export default function Standings() {
    const { raceId } = useParams<{ raceId: string }>();
    const id = parseInt(raceId || '0');
    const locked = useRaceLocked(id);

    if (!raceId || isNaN(id)) return <div>Invalid Race ID</div>;

    // The page heading is `RaceViewHeading`'s own job now (#1296, #1297).
    // `Leaderboard`'s own `<h2>` ("Current Standings" / the round's label)
    // stays as the section heading it is — it also renders inside Race
    // Control's own round summary, where a page-level heading has no place.
    return (
        <div className="container" style={{ padding: '2rem' }}>
            <RaceViewHeading title="Standings" docsKey="standings" locked={locked} testId="standings-heading" />
            <Leaderboard raceId={id} />
        </div>
    );
}
