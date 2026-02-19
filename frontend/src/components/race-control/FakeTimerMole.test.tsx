import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FakeTimerMole } from './FakeTimerMole';

describe('FakeTimerMole', () => {
    const mockHeat = { 
        id: 1, 
        heatNumber: 1,
        total_participants: 2, 
        laneResults: JSON.stringify([
            { lane: 1, racer_id: 101, time: null, place: null },
            { lane: 2, racer_id: 102, time: null, place: null }
        ]) 
    };

    const mockOnTriggerFinish = vi.fn();
    const mockOnTriggerStart = vi.fn();

    beforeEach(() => {
        vi.useFakeTimers();
        mockOnTriggerFinish.mockClear();
        mockOnTriggerStart.mockClear();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders nothing when isOpen is false', () => {
        const { container } = render(
            <FakeTimerMole 
                isOpen={false}
                activeHeat={mockHeat}
                onTriggerFinish={mockOnTriggerFinish}
            />
        );
        expect(container.firstChild).toBeNull();
    });

    it('renders when isOpen is true', () => {
        render(
            <FakeTimerMole 
                isOpen={true}
                activeHeat={mockHeat}
                onTriggerFinish={mockOnTriggerFinish}
            />
        );
        expect(screen.getByText('Fake Timer Controls')).toBeInTheDocument();
    });

    it('calls onTriggerStart when Start Timer is clicked', () => {
        render(
            <FakeTimerMole 
                isOpen={true}
                activeHeat={mockHeat}
                onTriggerFinish={mockOnTriggerFinish}
                onTriggerStart={mockOnTriggerStart}
            />
        );
        fireEvent.click(screen.getByText('Start Timer'));
        expect(mockOnTriggerStart).toHaveBeenCalled();
    });

    it('calls onTriggerFinish when Finish Heat is clicked', () => {
        render(
            <FakeTimerMole 
                isOpen={true}
                activeHeat={mockHeat}
                isRunning={true}
                onTriggerFinish={mockOnTriggerFinish}
            />
        );
        fireEvent.click(screen.getByText('Finish Heat'));
        expect(mockOnTriggerFinish).toHaveBeenCalledWith(expect.any(Array));
        const results = mockOnTriggerFinish.mock.calls[0][0];
        expect(results).toHaveLength(2);
        expect(results[0].time).toBeDefined();
        expect(results[0].place).toBeDefined();
    });

    it('automatically triggers finish after delay when isRunning is true', async () => {
        render(
            <FakeTimerMole 
                isOpen={true}
                activeHeat={mockHeat}
                isRunning={true}
                onTriggerFinish={mockOnTriggerFinish}
            />
        );

        expect(screen.getByText('Racing...')).toBeInTheDocument();

        // Advance timers by 6 seconds (max delay is 5s)
        vi.advanceTimersByTime(6000);

        expect(mockOnTriggerFinish).toHaveBeenCalled();
    });

    it('shows completed status and disables buttons when isCompleted is true', () => {
        render(
            <FakeTimerMole 
                isOpen={true}
                activeHeat={mockHeat}
                isCompleted={true}
                onTriggerFinish={mockOnTriggerFinish}
            />
        );
        expect(screen.getByText('Heat Completed')).toBeInTheDocument();
        expect(screen.getByText('Start Timer')).toBeDisabled();
        expect(screen.getByText('Finish Heat')).toBeDisabled();
    });

    it('clears timeout on unmount', () => {
        const { unmount } = render(
            <FakeTimerMole 
                isOpen={true}
                activeHeat={mockHeat}
                isRunning={true}
                onTriggerFinish={mockOnTriggerFinish}
            />
        );
        unmount();
        vi.advanceTimersByTime(6000);
        expect(mockOnTriggerFinish).not.toHaveBeenCalled();
    });
});
