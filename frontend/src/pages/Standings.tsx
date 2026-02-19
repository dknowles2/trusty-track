import { useParams, Link } from 'react-router-dom';
import Leaderboard from '../components/Leaderboard';
import Icon from '@mdi/react';
import { mdiArrowLeft } from '@mdi/js';
import { useQuery, useSubscription } from 'urql';
import { RACE_STATE_CHANGED_SUBSCRIPTION } from '../graphql/raceDetails';

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

    const [result, reExecute] = useQuery({
        query: GET_RACE_NAME,
        variables: { id },
        pause: !id || isNaN(id)
    });

    // Subscribe to race state changes so this page auto-refetches.
    useSubscription(
        { query: RACE_STATE_CHANGED_SUBSCRIPTION, variables: { raceId: id }, pause: !id || isNaN(id) },
        (_prev, _data) => {
            reExecute({ requestPolicy: 'network-only' });
            return _data;
        }
    );

    const { data, fetching } = result;
    const race = data?.race;

    if (!raceId || isNaN(id)) return <div>Invalid Race ID</div>;

    return (
        <div className="container" style={{ padding: '2rem' }}>
            <div style={{ marginBottom: '2rem' }}>
                <Link to={`/race/${raceId}`} style={{ display: 'flex', alignItems: 'center', gap: '5px', textDecoration: 'none', color: '#666', marginBottom: '1rem' }}>
                    <Icon path={mdiArrowLeft} size={0.8} /> Back to Race Details
                </Link>
                
                <h1 style={{ margin: 0, color: 'var(--scouting-blue)' }}>
                    {fetching ? 'Standings' : (race ? `${race.name} - Standings` : 'Standings')}
                </h1>
            </div>

            <Leaderboard raceId={id} />
        </div>
    );
}
