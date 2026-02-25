import { useParams } from 'react-router-dom';
import Leaderboard from '../components/Leaderboard';
import RaceModeToggle from '../components/RaceModeToggle';
import { useQuery } from 'urql';

const GET_RACE_NAME = `
  query GetRaceName($id: Int!) {
    race(raceId: $id) {
      id
      name
    }
  }
`;

export default function Standings() {
    const { raceId } = useParams<{ raceId: string }>();
    const id = parseInt(raceId || '0');

    const [result] = useQuery({
        query: GET_RACE_NAME,
        variables: { id },
        pause: !id || isNaN(id)
    });

    const { data, fetching } = result;
    const race = data?.race;

    if (!raceId || isNaN(id)) return <div>Invalid Race ID</div>;

    return (
        <div className="container" style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '15px', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', borderBottom: '1px solid #eee', paddingBottom: '1rem' }}>
                <div style={{ minWidth: '160px' }} />

                <RaceModeToggle />

                <div style={{ minWidth: '160px' }} />
            </div>

            <Leaderboard raceId={id} />
        </div>
    );
}
