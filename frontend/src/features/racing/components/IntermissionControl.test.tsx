import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useQuery, useMutation, useSubscription } from 'urql';
import IntermissionControl from './IntermissionControl';
import {
  START_INTERMISSION_MUTATION,
  EXTEND_INTERMISSION_MUTATION,
  PAUSE_INTERMISSION_MUTATION,
  RESUME_INTERMISSION_MUTATION,
  END_INTERMISSION_MUTATION,
} from '../graphql/queries';

vi.mock('urql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('urql')>();
  return {
    ...actual,
    useQuery: vi.fn(),
    useMutation: vi.fn(),
    useSubscription: vi.fn(),
  };
});

const showAlert = vi.fn();
vi.mock('../../../context/AlertContext', () => ({
  useAlert: () => ({ showAlert, showConfirm: vi.fn(), showToast: vi.fn() }),
}));

const startIntermission = vi.fn();
const extendIntermission = vi.fn();
const pauseIntermission = vi.fn();
const resumeIntermission = vi.fn();
const endIntermission = vi.fn();
const reExecute = vi.fn();

function mockIntermission(intermission: unknown) {
  (vi.mocked(useQuery) as ReturnType<typeof vi.fn>).mockReturnValue([
    { data: { race: { id: 1, intermission } }, fetching: false, error: null },
    reExecute,
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();

  startIntermission.mockResolvedValue({ data: {}, error: undefined });
  extendIntermission.mockResolvedValue({ data: {}, error: undefined });
  pauseIntermission.mockResolvedValue({ data: {}, error: undefined });
  resumeIntermission.mockResolvedValue({ data: {}, error: undefined });
  endIntermission.mockResolvedValue({ data: {}, error: undefined });

  (vi.mocked(useMutation) as ReturnType<typeof vi.fn>).mockImplementation(
    (query: unknown) => {
      if (query === START_INTERMISSION_MUTATION) return [{ fetching: false }, startIntermission];
      if (query === EXTEND_INTERMISSION_MUTATION) return [{ fetching: false }, extendIntermission];
      if (query === PAUSE_INTERMISSION_MUTATION) return [{ fetching: false }, pauseIntermission];
      if (query === RESUME_INTERMISSION_MUTATION) return [{ fetching: false }, resumeIntermission];
      if (query === END_INTERMISSION_MUTATION) return [{ fetching: false }, endIntermission];
      return [{ fetching: false }, vi.fn()];
    },
  );

  // `useRaceStateChanged` opens this; no live payload needed for these tests.
  (vi.mocked(useSubscription) as ReturnType<typeof vi.fn>).mockReturnValue([{ data: undefined }]);
});

const NONE = { active: false, remainingSeconds: 0, paused: false, label: null, endsAt: null };

describe('no intermission is active', () => {
  it('offers the preset durations', () => {
    mockIntermission(NONE);
    render(<IntermissionControl raceId={1} />);

    expect(screen.getByTestId('intermission-preset-300')).toHaveTextContent('5 min');
    expect(screen.getByTestId('intermission-preset-600')).toHaveTextContent('10 min');
    expect(screen.getByTestId('intermission-preset-900')).toHaveTextContent('15 min');
    expect(screen.queryByTestId('intermission-countdown')).toBeNull();
  });

  it('starts a preset intermission on click', async () => {
    mockIntermission(NONE);
    render(<IntermissionControl raceId={1} />);

    fireEvent.click(screen.getByTestId('intermission-preset-600'));

    expect(startIntermission).toHaveBeenCalledWith({
      raceId: 1,
      durationSeconds: 600,
      label: null,
    });
  });

  it('offers a custom duration', () => {
    mockIntermission(NONE);
    render(<IntermissionControl raceId={1} />);

    fireEvent.click(screen.getByTestId('intermission-custom-btn'));
    const input = screen.getByLabelText('Custom break length, in minutes');
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.click(screen.getByText('Start'));

    expect(startIntermission).toHaveBeenCalledWith({
      raceId: 1,
      durationSeconds: 420,
      label: null,
    });
  });

  it('refuses a non-positive custom duration without calling the mutation', () => {
    mockIntermission(NONE);
    render(<IntermissionControl raceId={1} />);

    fireEvent.click(screen.getByTestId('intermission-custom-btn'));
    const input = screen.getByLabelText('Custom break length, in minutes');
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.click(screen.getByText('Start'));

    expect(startIntermission).not.toHaveBeenCalled();
    expect(showAlert).toHaveBeenCalled();
  });
});

describe('an intermission is running', () => {
  const running = {
    active: true,
    remainingSeconds: 300,
    paused: false,
    label: 'Snack break',
    endsAt: new Date(Date.now() + 300_000).toISOString(),
  };

  it('shows the countdown and label', () => {
    mockIntermission(running);
    render(<IntermissionControl raceId={1} />);

    expect(screen.getByText('Snack break')).toBeInTheDocument();
    expect(screen.getByTestId('intermission-countdown')).toBeInTheDocument();
  });

  it('extends by five minutes', () => {
    mockIntermission(running);
    render(<IntermissionControl raceId={1} />);

    fireEvent.click(screen.getByText(/5 min/));
    expect(extendIntermission).toHaveBeenCalledWith({ raceId: 1, seconds: 300 });
  });

  it('pauses', () => {
    mockIntermission(running);
    render(<IntermissionControl raceId={1} />);

    fireEvent.click(screen.getByText('Pause'));
    expect(pauseIntermission).toHaveBeenCalledWith({ raceId: 1 });
  });

  it('ends now', () => {
    mockIntermission(running);
    render(<IntermissionControl raceId={1} />);

    fireEvent.click(screen.getByText('End now'));
    expect(endIntermission).toHaveBeenCalledWith({ raceId: 1 });
  });
});

describe('an intermission is paused', () => {
  const paused = {
    active: true,
    remainingSeconds: 120,
    paused: true,
    label: null,
    endsAt: null,
  };

  it('offers Resume rather than Pause', () => {
    mockIntermission(paused);
    render(<IntermissionControl raceId={1} />);

    expect(screen.getByText('Resume')).toBeInTheDocument();
    expect(screen.queryByText('Pause')).toBeNull();
  });

  it('resumes', () => {
    mockIntermission(paused);
    render(<IntermissionControl raceId={1} />);

    fireEvent.click(screen.getByText('Resume'));
    expect(resumeIntermission).toHaveBeenCalledWith({ raceId: 1 });
  });
});

describe('a countdown that has run out locally', () => {
  it('falls back to the preset offer even if the last payload said active', () => {
    // No new event has arrived — the payload is stale — but the deadline
    // has passed, which `isLiveActive` catches without waiting on the server.
    mockIntermission({
      active: true,
      remainingSeconds: 60,
      paused: false,
      label: 'Break',
      endsAt: new Date(Date.now() - 60_000).toISOString(),
    });
    render(<IntermissionControl raceId={1} />);

    expect(screen.getByTestId('intermission-preset-300')).toBeInTheDocument();
  });
});
