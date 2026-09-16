import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import { HowHeatsAreBuiltFields, type SchedulingAlgorithmOption } from './HowHeatsAreBuiltFields';

function option(over: Partial<SchedulingAlgorithmOption> = {}): SchedulingAlgorithmOption {
  return {
    value: 'PPC',
    label: 'Partial Perfect Chart',
    guarantee: 'Every car runs every lane once; heats full; opponents vary as much as the field allows',
    unavailableReason: null,
    absorbsLatecomer: true,
    heatCount: null,
    ...over,
  };
}

const THREE_OPTIONS: SchedulingAlgorithmOption[] = [
  option({ value: 'PPC', label: 'Partial Perfect Chart' }),
  option({
    value: 'ROTATION',
    label: 'Lane rotation',
    guarantee: "Each car's next heat is its previous lane + 1; simplest to run from a printed sheet; opponents repeat",
    absorbsLatecomer: false,
  }),
  option({
    value: 'PERFECT_N',
    label: 'Perfect-N chart',
    guarantee: 'Every car meets every other car the same number of times — the fairest chart there is, where one exists for this field and lane count',
    absorbsLatecomer: false,
    unavailableReason: 'No Perfect-N chart is published for 7 cars on 4 lanes; the nearest are 5 and 9 cars. Use the Partial Perfect Chart.',
  }),
];

describe('HowHeatsAreBuiltFields', () => {
  const defaultProps = {
    algorithm: 'PPC',
    onChooseAlgorithm: vi.fn(),
    options: THREE_OPTIONS,
    labelStyle: {},
    mutedColor: 'var(--text-muted-color)',
  };

  it('renders as a closed disclosure — most packs never open it', () => {
    render(<HowHeatsAreBuiltFields {...defaultProps} />);
    const details = screen.getByText('How heats are built').closest('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
  });

  it('offers every option, PPC checked by default', () => {
    render(<HowHeatsAreBuiltFields {...defaultProps} />);
    expect(screen.getByLabelText('Partial Perfect Chart')).toBeChecked();
    expect(screen.getByLabelText('Lane rotation')).not.toBeChecked();
    expect(screen.getByLabelText('Perfect-N chart')).not.toBeChecked();
  });

  it("shows each option's one-line guarantee", () => {
    render(<HowHeatsAreBuiltFields {...defaultProps} />);
    expect(
      screen.getByText(/Every car runs every lane once; heats full/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/simplest to run from a printed sheet/)
    ).toBeInTheDocument();
  });

  it('reports the chosen algorithm', () => {
    const onChooseAlgorithm = vi.fn();
    render(<HowHeatsAreBuiltFields {...defaultProps} onChooseAlgorithm={onChooseAlgorithm} />);
    fireEvent.click(screen.getByLabelText('Lane rotation'));
    expect(onChooseAlgorithm).toHaveBeenCalledWith('ROTATION');
  });

  it('greys an unavailable option and shows its reason instead of the guarantee', () => {
    render(<HowHeatsAreBuiltFields {...defaultProps} />);
    const perfectN = screen.getByLabelText('Perfect-N chart');
    expect(perfectN).toBeDisabled();
    expect(
      screen.getByText(/No Perfect-N chart is published for 7 cars on 4 lanes/)
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Every car meets every other car the same number of times/)
    ).not.toBeInTheDocument();
  });

  it('disables every option while loading', () => {
    render(<HowHeatsAreBuiltFields {...defaultProps} loading />);
    expect(screen.getByLabelText('Partial Perfect Chart')).toBeDisabled();
    expect(screen.getByLabelText('Lane rotation')).toBeDisabled();
  });
});
