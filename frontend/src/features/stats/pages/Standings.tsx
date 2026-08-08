import { useParams } from 'react-router-dom';
import Leaderboard from '../components/Leaderboard';

export default function Standings() {
    const { raceId } = useParams<{ raceId: string }>();
    const id = parseInt(raceId || '0');

    if (!raceId || isNaN(id)) return <div>Invalid Race ID</div>;

    // No header of its own. It used to hold the race-mode toggle between two
    // spacer divs; the navigation above the page does that job now.
    return (
        <div className="container" style={{ padding: '2rem' }}>
            <Leaderboard raceId={id} />
        </div>
    );
}
