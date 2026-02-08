import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoundWizard } from './RoundWizard';
import { apiClient } from '../../api/client';
import userEvent from '@testing-library/user-event';

// Mock apiClient
vi.mock('../../api/client', () => ({
    apiClient: {
        post: vi.fn(),
    }
}));

describe('RoundWizard Component', () => {
    const mockOnClose = vi.fn();
    const mockOnCreated = vi.fn();
    const mockDens = [
        { id: 1, name: 'Den A' },
        { id: 2, name: 'Den B' }
    ];

    const defaultProps = {
        isOpen: true,
        onClose: mockOnClose,
        raceId: 1,
        racerCount: 10,
        denCount: 2,
        laneCount: 4,
        dens: mockDens,
        onCreated: mockOnCreated
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders Step 1 by default', () => {
        render(<RoundWizard {...defaultProps} />);
        expect(screen.getByText('Step 1: General Rounds')).toBeInTheDocument();
        expect(screen.getByText('PACK (One big race)')).toBeInTheDocument();
        expect(screen.getByText('DEN (Round per den)')).toBeInTheDocument();
    });

    it('calculates estimation correctly in Step 1 (no championship)', () => {
        render(<RoundWizard {...defaultProps} />);
        // 10 racers, 1 run per lane -> 10 heats for PACK
        // 10 heats * 120s = 1200s = 20 min
        expect(screen.getByText('10 Total Heats')).toBeInTheDocument();
        expect(screen.getByText(/Estimated Race Duration: 20 min/i)).toBeInTheDocument();
    });

    it('navigates through steps', async () => {
        const user = userEvent.setup();
        render(<RoundWizard {...defaultProps} />);
        
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
        render(<RoundWizard {...defaultProps} />);
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

    it('can toggle championship rounds inclusion', async () => {
        const user = userEvent.setup();
        render(<RoundWizard {...defaultProps} />);
        
        await user.click(screen.getByText('Next')); // To Step 2
        
        // Add championship round
        await user.click(screen.getByText(/Add Championship Round/i));
        // 10 + 3 = 13 heats
        expect(screen.getByText('13 Total Heats')).toBeInTheDocument();

        // Toggle OFF
        const includeToggle = screen.getByLabelText(/Include Championship/i);
        await user.click(includeToggle);
        
        // Should reduce to 10 heats (General only)
        expect(screen.getByText('10 Total Heats')).toBeInTheDocument();
        expect(screen.getByText(/Championship rounds are disabled/i)).toBeInTheDocument();
        
        // Step 3 should show "Disabled"
        await user.click(screen.getByText('Next'));
        expect(screen.getByText('Disabled')).toBeInTheDocument();
        
        // Submitting should send empty championship rounds
        (apiClient.post as any).mockResolvedValue({});
        await user.click(screen.getByText('Create Rounds'));
        
        expect(apiClient.post).toHaveBeenCalledWith('/races/1/wizard', expect.objectContaining({
            championship_rounds: []
        }));
    });

    it('shows warning when racer count is 0', () => {
        render(<RoundWizard {...defaultProps} racerCount={0} />);
        expect(screen.getByText(/Warning:/i)).toBeInTheDocument();
        expect(screen.getByText(/No racers found./i)).toBeInTheDocument();
        expect(screen.getByText(/Schedule generation will fail/i)).toBeInTheDocument();
        
        // Estimation should be 0 (if no championship rounds default)
        expect(screen.getByText('0 Total Heats')).toBeInTheDocument();
    });

    it('shows warning when racer count is 1', () => {
        render(<RoundWizard {...defaultProps} racerCount={1} />);
        expect(screen.getByText(/Warning:/i)).toBeInTheDocument();
        expect(screen.getByText(/Not enough racers/i)).toBeInTheDocument();
        expect(screen.getByText(/Schedule generation will fail/i)).toBeInTheDocument();
    });

    it('restricts "Each Den" option if general round is PACK', async () => {
        const user = userEvent.setup();
        // Default is PACK
        render(<RoundWizard {...defaultProps} />);
        
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
        render(<RoundWizard {...defaultProps} />);
        
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
        
        render(<RoundWizard {...defaultProps} />);
        
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
        const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => {});
        (apiClient.post as any).mockRejectedValue(new Error('Not enough racers'));
        
        render(<RoundWizard {...defaultProps} />);
        
        // Navigate to create step (Step 3)
        await user.click(screen.getByText('Next'));
        await user.click(screen.getByText('Next'));
        
        await user.click(screen.getByText('Create Rounds'));
        
        await waitFor(() => {
            expect(alertMock).toHaveBeenCalledWith('Failed to create rounds: Not enough racers');
        });
        
        alertMock.mockRestore();
    });
});
