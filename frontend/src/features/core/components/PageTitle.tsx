/**
 * Keeps the browser tab's name in step with the page (`pageTitle.ts`).
 *
 * A component with nothing to render rather than a hook called from each
 * page: there are fourteen routes, and a rule that depends on every page
 * remembering to call it reaches only some of them — which is the standing
 * lesson of #48. Mounted once inside the router, it sees every navigation,
 * including the full-screen views that hide the rest of the app's chrome.
 *
 * The race's name comes from the navigation's own query, so this costs no
 * request: urql answers it from the cache it filled a moment earlier.
 */

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery } from 'urql';

import { GET_RACES_NAV } from '../graphql/queries';
import { pageTitle, raceIdIn } from '../pageTitle';

export default function PageTitle() {
    const location = useLocation();
    const [{ data }] = useQuery({ query: GET_RACES_NAV });

    const raceId = raceIdIn(location.pathname);
    const races: { id: number; name: string }[] = data?.races ?? [];
    const raceName = raceId ? (races.find((race) => race.id === raceId)?.name ?? null) : null;

    useEffect(() => {
        document.title = pageTitle(location.pathname, raceName);
    }, [location.pathname, raceName]);

    return null;
}
