/**
 * What a reader sees instead of a blank page or a plausible-looking empty
 * one (#787).
 *
 * Two callers, two messages, one component: `App.tsx`'s catch-all route for
 * a mistyped or renamed path, and `RaceTerminologyGate` for a race id that
 * no longer resolves to anything — a stale bookmark, a link someone pasted,
 * a race that has since been deleted. Both are "you followed a link that
 * does not lead anywhere any more," and both need the same thing: a plain
 * sentence saying so, and a way back in one click. Neither renders the
 * controls of a page that is not there — that is the failure this exists to
 * replace.
 */

import { Link } from 'react-router-dom';

interface NotFoundPageProps {
  heading: string;
  message: string;
}

export default function NotFoundPage({ heading, message }: NotFoundPageProps) {
  return (
    <div style={{ maxWidth: '32rem', margin: '4rem auto', padding: '0 1.5rem', textAlign: 'center' }}>
      <h1>{heading}</h1>
      <p style={{ marginBottom: '1.5rem' }}>{message}</p>
      <Link to="/" className="primary-btn">Go to Home</Link>
    </div>
  );
}
