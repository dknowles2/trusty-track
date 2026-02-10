import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoundWizard } from './RoundWizard';
import { apiClient } from '../../api/client';
import userEvent from '@testing-library/user-event';
import { AlertProvider } from '../../context/AlertContext';

// Mock apiClient
vi.mock('../../api/client', () => ({
    apiClient: {
        post: vi.fn(),
    }
}));

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
    });

    it('renders Step 1 by default', () => {
        render(<AlertProvider><RoundWizard {...defaultProps} /></AlertProvider>);
        expect(screen.getByText('Step 1: General Rounds')).toBeInTheDocument();
        expect(screen.getByText('PACK (One big race)')).toBeInTheDocument();
        expect(screen.getByText('DEN (Round per den)')).toBeInTheDocument();
    });

    it('calculates estimation correctly in Step 1 (no championship)', () => {
        render(<AlertProvider><RoundWizard {...defaultProps} /></AlertProvider>);
        // 10 racers, 1 run per lane -> 10 heats for PACK
        // 10 heats * 120s = 1200s = 20 min
        expect(screen.getByText('10 Total Heats')).toBeInTheDocument();
        expect(screen.getByText(/Estimated Race Duration: 20 min/i)).toBeInTheDocument();
    });

    it('navigates through steps', async () => {
        const user = userEvent.setup();
        render(<AlertProvider><RoundWizard {...defaultProps} /></AlertProvider>);
        
        // Step 1 -> Step 2
        await user.click(screen.getByText('Next'));
        expect(screen.getByText('Step 2: Championship Rounds')).toBeInTheDocument();
        
        // Step 2 -> Step 3
        await user.click(screen.getByText('Next'));
        expect(screen.getByText('Step 3: Preview and Finalize')).toBeInTheDocument();
        
        // Step 3 -> Step 2
        await user.click(screen.getByText('Back'));
        expect(screen.getByText('Step 2: Championship Rounds')).toBeInTheDocument();
    });

    it('can add/remove championship rounds with source selection', async () => {
        const user = userEvent.setup();
        // Start in DEN mode to enable "Each Den" option
        render(<AlertProvider><RoundWizard {...defaultProps} /></AlertProvider>);
        const denRadio = screen.getByLabelText('DEN');
        await user.click(denRadio);

        await user.click(screen.getByText('Next')); // To Step 2
        
        // Initially no championship rounds shown
        expect(screen.getByText('No championship rounds added.')).toBeInTheDocument();

        // Add championship round
        const addBtn = screen.getByText(/Add Championship Round/i);
        await user.click(addBtn);
        
        expect(screen.getByDisplayValue('Championship Round')).toBeInTheDocument();

        // Select "Each Den" source (available because we chose DEN in Step 1)
        const sourceSelect = screen.getByRole('combobox');
        const denOption = screen.getByText(/Each Den/i);
        expect(denOption).not.toBeDisabled();
        
        await user.selectOptions(sourceSelect, 'DEN');
        await user.selectOptions(sourceSelect, 'DEN');
        // 10 racers (General) + (3 top * 2 Dens * 1 run) (Championship) = 10 + 6 = 16 heats
        expect(screen.getByText('16 Total Heats')).toBeInTheDocument();
        
        // Also verify time estimate breakdown: 16 * 120s = 1920s = 32 mins
        expect(screen.getByText(/Estimated Race Duration: 32 min/i)).toBeInTheDocument();
        // 10 * 120 = 1200s = 20m Gen. 6 * 120 = 720s = 12m Champ.
        expect(screen.getByText(/\(20 min Gen \+ 12 min Champ\)/i)).toBeInTheDocument();
    });


    it('shows warning when racer count is 0', () => {
        render(<AlertProvider><RoundWizard {...defaultProps} racerCount={0} /></AlertProvider>);
        expect(screen.getByText(/Warning:/i)).toBeInTheDocument();
        expect(screen.getByText(/No racers found./i)).toBeInTheDocument();
        expect(screen.getByText(/Schedule generation will fail/i)).toBeInTheDocument();
        
        // Estimation should be 0 (if no championship rounds default)
        expect(screen.getByText('0 Total Heats')).toBeInTheDocument();
    });

    it('shows warning when racer count is 1', () => {
        render(<AlertProvider><RoundWizard {...defaultProps} racerCount={1} /></AlertProvider>);
        expect(screen.getByText(/Warning:/i)).toBeInTheDocument();
        expect(screen.getByText(/Not enough racers/i)).toBeInTheDocument();
        expect(screen.getByText(/Schedule generation will fail/i)).toBeInTheDocument();
    });

    it('restricts "Each Den" option if general round is PACK', async () => {
        const user = userEvent.setup();
        // Default is PACK
        render(<AlertProvider><RoundWizard {...defaultProps} /></AlertProvider>);
        
        await user.click(screen.getByText('Next')); // To Step 2
        await user.click(screen.getByText(/Add Championship Round/i));

        const denOption = screen.getByText(/Each Den/i);
        expect(denOption).toBeDisabled();

        // Go back and change to DEN
        await user.click(screen.getByText('Back'));
        await user.click(screen.getByLabelText('DEN'));
        await user.click(screen.getByText('Next'));

        expect(screen.getByText(/Each Den/i)).not.toBeDisabled();
    });

    it('resets "Each Den" source when switching back to PACK', async () => {
        const user = userEvent.setup();
        render(<AlertProvider><RoundWizard {...defaultProps} /></AlertProvider>);
        
        // 1. Set to DEN
        await user.click(screen.getByLabelText('DEN'));
        await user.click(screen.getByText('Next'));
        await user.click(screen.getByText(/Add Championship Round/i));
        
        // 2. Set championship to DEN source
        await user.selectOptions(screen.getByRole('combobox'), 'DEN');
        expect(screen.getByText('16 Total Heats')).toBeInTheDocument();

        // 3. Go back to Step 1 and change to PACK
        await user.click(screen.getByText('Back'));
        await user.click(screen.getByLabelText('PACK'));
        
        // 4. Verification: Estimation should reset (10 + 3 = 13)
        // Because "Each Den" (16) was reset to "PACK" (13)
        expect(screen.getByText('13 Total Heats')).toBeInTheDocument();
        
        // 5. Verification: Step 2 should show PACK source select
        await user.click(screen.getByText('Next'));
        expect(screen.getByRole('combobox')).toHaveValue('PACK');
    });

    it('submits correct data to API', async () => {
        const user = userEvent.setup();
        (apiClient.post as any).mockResolvedValue({});
        
        render(<AlertProvider><RoundWizard {...defaultProps} /></AlertProvider>);
        
        // Step 2
        await user.click(screen.getByText('Next'));
        await user.click(screen.getByText(/Add Championship Round/i));

        // Step 3
        await user.click(screen.getByText('Next'));
        
        // Create!
        await user.click(screen.getByText('Create Rounds'));
        
        expect(apiClient.post).toHaveBeenCalledWith('/races/1/wizard', expect.objectContaining({
            championship_rounds: [
                expect.objectContaining({ source: 'PACK', num_top_racers: 3 })
            ]
        }));
    });

    it('shows error alert on API failure', async () => {
        const user = userEvent.setup();
        (apiClient.post as any).mockRejectedValue(new Error('Not enough racers'));
        
        render(<AlertProvider><RoundWizard {...defaultProps} /></AlertProvider>);
        
        // Navigate to create step (Step 3)
        await user.click(screen.getByText('Next'));
        await user.click(screen.getByText('Next'));
        
        await user.click(screen.getByText('Create Rounds'));
        
        // Wait for the custom modal to show error
        await waitFor(() => {
            expect(screen.getByText('Failed to create rounds: Not enough racers')).toBeInTheDocument();
        });
    });

    it('enforces championshipTrophies minimum for final round', async () => {
        const user = userEvent.setup();
        // Set trophies to 5
        render(<AlertProvider><RoundWizard {...defaultProps} championshipTrophies={5} /></AlertProvider>);
        
        await user.click(screen.getByText('Next')); // To Step 2
        await user.click(screen.getByText(/Add Championship Round/i));
        
        const numInput = screen.getByLabelText(/Number to pick/i);
        expect(numInput).toHaveValue(5);
        expect(numInput).toHaveAttribute('min', '5');
        
        // Try to set it to 3
        fireEvent.change(numInput, { target: { value: '3' } });
        // My implementation uses Math.max(minVal, value) in onChange, so it should snap to 5
        expect(numInput).toHaveValue(5);
    });

    it('hides "Add Follow-up Round" if current round is at trophy minimum', async () => {
        const user = userEvent.setup();
        render(<AlertProvider><RoundWizard {...defaultProps} championshipTrophies={3} /></AlertProvider>);
        
        await user.click(screen.getByText('Next')); // To Step 2
        await user.click(screen.getByText(/Add Championship Round/i));
        
        // Default pick is 3 (matches championshipTrophies)
        // Button should be REMOVED (hidden) according to latest requirement
        expect(screen.queryByRole('button', { name: /Add Follow-up Round/i })).not.toBeInTheDocument();
        expect(screen.getByText(/Minimum participant count \(3\) reached/i)).toBeInTheDocument();
        
        // Increase participants to 4
        const numInput = screen.getByLabelText(/Number to pick/i);
        fireEvent.change(numInput, { target: { value: '4' } });
        
        // Now it should be visible again
        expect(screen.getByRole('button', { name: /Add Follow-up Round/i })).toBeInTheDocument();
        expect(screen.queryByText(/Minimum participant count \(3\) reached/i)).not.toBeInTheDocument();
    });
});
