import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoundWizard } from './RoundWizard';
import userEvent from '@testing-library/user-event';
import { AlertProvider } from '../../../context/AlertContext';

// Mock urql
const mockExecuteMutation = vi.fn();
vi.mock('urql', async (importOriginal) => {
    const actual = await importOriginal<typeof import('urql')>();
    return {
        ...actual,
        useMutation: () => [{}, mockExecuteMutation],
    };
});

describe('RoundWizard Component', () => {
    const mockOnClose = vi.fn();
    const mockOnCreated = vi.fn();

    const defaultProps = {
        isOpen: true,
        onClose: mockOnClose,
        raceId: 1,
        racerCount: 10,
        denCount: 2,
        laneCount: 4,
        championshipTrophies: 3,
        onCreated: mockOnCreated
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockExecuteMutation.mockResolvedValue({ data: { createRaceWizard: [] } });
    });

    it('renders Step 1 by default', () => {
        render(<AlertProvider><RoundWizard {...defaultProps} /></AlertProvider>);
        expect(screen.getByText('Race Schedule Wizard')).toBeInTheDocument();
        expect(screen.getByText('Quickly generate a complete race schedule based on your settings.')).toBeInTheDocument();
        expect(screen.getByText('All Pack')).toBeInTheDocument();
        expect(screen.getByText('By Den')).toBeInTheDocument();
    });

    it('calculates estimation correctly in Step 3 (with default championship)', async () => {
        const user = userEvent.setup();
        render(<AlertProvider><RoundWizard {...defaultProps} /></AlertProvider>);
        
        // Navigate to Step 3
        await user.click(screen.getByText('Next')); // Step 2
        await user.click(screen.getByText('Next')); // Step 3

        // Estimation logic:
        // Gen: 10 racers * 1 run / 4 lanes = 2.5
        // Champ (default): max(3, 4) = 4 racers. 4 * 1 / 4 = 1.
        // Total = 3.5 -> ceil -> 4 total heats.
        
        expect(screen.getByText('Total Heats: 4')).toBeInTheDocument();
        // 4 heats * 3 min = 12 min
        expect(screen.getByText(/Estimated Duration: ~12 mins/i)).toBeInTheDocument();
    });

    it('navigates through steps', async () => {
        const user = userEvent.setup();
        render(<AlertProvider><RoundWizard {...defaultProps} /></AlertProvider>);
        
        // Step 1 -> Step 2
        await user.click(screen.getByText('Next'));
        expect(screen.getByText('Championship Rounds')).toBeInTheDocument();
        // Should show default round
        expect(screen.getByDisplayValue('Grand Finals')).toBeInTheDocument();
        
        // Step 2 -> Step 3
        await user.click(screen.getByText('Next'));
        expect(screen.getByText('Estimated Duration: ~12 mins')).toBeInTheDocument();
        expect(screen.getByText('Review')).toBeInTheDocument(); // Step indicator or content
        
        // Step 3 -> Step 2
        await user.click(screen.getByText('Back'));
        expect(screen.getByDisplayValue('Grand Finals')).toBeInTheDocument();
    });

    it('can remove default round and add new one', async () => {
        const user = userEvent.setup();
        render(<AlertProvider><RoundWizard {...defaultProps} /></AlertProvider>);
        await user.click(screen.getByText('Next')); // To Step 2
        
        // Verify default exists
        expect(screen.getByDisplayValue('Grand Finals')).toBeInTheDocument();
        
        // Remove it
        // Remove it
        
        // Use test id for reliability
        const closeButton = screen.getByTestId('remove-round-btn');
        await user.click(closeButton);

        await waitFor(() => {
            expect(screen.queryByDisplayValue('Grand Finals')).not.toBeInTheDocument();
            expect(screen.getByText('No championship rounds configured.')).toBeInTheDocument();
        });
        
        // Add new one
        await user.click(screen.getByText('+ Add Round'));
        expect(screen.getByDisplayValue('New Championship Round')).toBeInTheDocument();
    });
    
    it('submits correct data to GraphQL mutation', async () => {
        const user = userEvent.setup();
        render(<AlertProvider><RoundWizard {...defaultProps} /></AlertProvider>);
        
        // Step 2
        await user.click(screen.getByText('Next'));
        // Keep default "Grand Finals"

        // Step 3
        await user.click(screen.getByText('Next'));
        
        // Create!
        await user.click(screen.getByText('Generate Schedule'));
        
        expect(mockExecuteMutation).toHaveBeenCalledWith({
            raceId: 1,
            config: expect.objectContaining({
                generalRound: expect.objectContaining({ type: 'PACK' }),
                championshipRounds: [
                    expect.objectContaining({ 
                        name: 'Grand Finals',
                        source: 'PACK', 
                        numTopRacers: 4 // Math.max(3, 4)
                    })
                ]
            })
        });
        expect(mockOnCreated).toHaveBeenCalled();
    });

    it('shows error alert on API failure', async () => {
        const user = userEvent.setup();
        mockExecuteMutation.mockResolvedValue({ error: new Error('Simulated Error') });
        
        render(<AlertProvider><RoundWizard {...defaultProps} /></AlertProvider>);
        
        // Navigate to create step (Step 3)
        await user.click(screen.getByText('Next'));
        await user.click(screen.getByText('Next'));
        
        await user.click(screen.getByText('Generate Schedule'));
        
        // Wait for the custom modal to show error
        await waitFor(() => {
            expect(screen.getByText('Failed to create rounds: Simulated Error')).toBeInTheDocument();
        });
    });
});
