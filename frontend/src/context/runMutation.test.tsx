/**
 * The shared error-toast wrapper every mutation call site used to write out
 * by hand (issue #436). The property worth pinning is the one the issue is
 * about: a mutation that errors always toasts a message, and a mutation that
 * succeeds never does — so "forgot the alert" cannot happen at a call site
 * any more, because the call site no longer writes the check.
 */

import { render, screen, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AlertProvider } from './AlertContext';
import { useRunMutation } from './runMutation';

function Caller({
  execute,
  fallback,
}: {
  execute: (vars: { id: number }) => Promise<{ data?: unknown; error?: unknown }>;
  fallback: string;
}) {
  const runMutation = useRunMutation();
  return (
    <button
      onClick={() => {
        void runMutation(execute, { id: 1 }, fallback);
      }}
    >
      Go
    </button>
  );
}

async function renderCaller(
  execute: (vars: { id: number }) => Promise<{ data?: unknown; error?: unknown }>,
  fallback = 'It could not be saved.',
) {
  render(
    <AlertProvider>
      <Caller execute={execute} fallback={fallback} />
    </AlertProvider>,
  );
  await act(async () => {
    screen.getByRole('button', { name: 'Go' }).click();
  });
}

describe('useRunMutation', () => {
  it('toasts the fallback message when the mutation errors with no server message', async () => {
    const execute = vi.fn().mockResolvedValue({ error: {} });
    await renderCaller(execute, 'The record could not be saved.');

    expect(await screen.findByText('The record could not be saved.')).toBeInTheDocument();
    expect(execute).toHaveBeenCalledWith({ id: 1 });
  });

  it('toasts the backend GraphQL message over the fallback', async () => {
    const execute = vi.fn().mockResolvedValue({
      error: { graphQLErrors: [{ message: 'Cannot delete round: it has been raced.' }] },
    });
    await renderCaller(execute, 'The round could not be deleted.');

    expect(
      await screen.findByText('Cannot delete round: it has been raced.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('The round could not be deleted.')).toBeNull();
  });

  it('shows no toast at all when the mutation succeeds', async () => {
    const execute = vi.fn().mockResolvedValue({ data: { widget: { id: 7 } } });
    await renderCaller(execute);

    expect(screen.queryByText('It could not be saved.')).toBeNull();
  });
});
