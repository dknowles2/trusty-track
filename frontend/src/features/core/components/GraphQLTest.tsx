import { useQuery, gql } from 'urql';

const RACES_QUERY = gql`
  query GraphQLConnectivityTest {
    races {
      id
      name
    }
  }
`;

/**
 * A simple component to verify that GraphQL queries are working.
 * Displays a list of race names or an error/loading message.
 */
export const GraphQLTest = () => {
  const [result] = useQuery({ query: RACES_QUERY });
  const { data, fetching, error } = result;

  if (fetching) return <p>Loading races via GraphQL...</p>;
  if (error) return <p>GraphQL Error: {error.message}</p>;

  return (
    <div style={{ padding: '1rem', border: '1px solid #ccc', margin: '1rem 0' }}>
      <h3>GraphQL Connectivity Test</h3>
      <ul>
        {data.races.map((race: { id: number; name: string }) => (
          <li key={race.id}>{race.name}</li>
        ))}
      </ul>
      {data.races.length === 0 && <p>No races found.</p>}
    </div>
  );
};
