import { errorText } from '../../../utils/errors';

interface QueryErrorProps {
  error: unknown;
  fallback: string;
  onRetry: () => void;
}

/**
 * Full-page query error state with a plain-language message and retry button.
 */
export default function QueryError({ error, fallback, onRetry }: QueryErrorProps) {
  return (
    <div
      role="alert"
      style={{ maxWidth: '32rem', margin: '4rem auto', padding: '0 1.5rem', textAlign: 'center' }}
    >
      <p style={{ color: 'var(--error)', marginBottom: '1.5rem' }}>
        {errorText(error, fallback)}
      </p>
      <button type="button" className="primary-btn" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
