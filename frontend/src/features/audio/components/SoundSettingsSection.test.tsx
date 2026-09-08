import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SoundSettingsSection from './SoundSettingsSection';
import * as soundModule from '../soundEffects';

describe('SoundSettingsSection', () => {
    beforeEach(() => {
        window.localStorage.clear();
        vi.restoreAllMocks();
    });

    it('renders master toggle and effect options off by default', () => {
        render(<SoundSettingsSection />);

        const masterToggle = screen.getByTestId('sound-master-toggle');
        expect(masterToggle).not.toBeChecked();

        expect(screen.getByTestId('sound-effect-stagingReady')).toBeDisabled();
        expect(screen.getByTestId('sound-effect-gateRelease')).toBeDisabled();
        expect(screen.getByTestId('sound-effect-finish')).toBeDisabled();
        expect(screen.getByTestId('sound-effect-recordBreak')).toBeDisabled();
        expect(screen.getByTestId('sound-effect-awardFanfare')).toBeDisabled();
    });

    it('enables individual toggles when master is checked', () => {
        render(<SoundSettingsSection />);

        const masterToggle = screen.getByTestId('sound-master-toggle');
        fireEvent.click(masterToggle);

        expect(masterToggle).toBeChecked();
        expect(screen.getByTestId('sound-effect-stagingReady')).not.toBeDisabled();
        expect(screen.getByTestId('sound-effect-gateRelease')).not.toBeDisabled();

        // Check that settings were written to localStorage
        const stored = soundModule.readSoundSettings(window.localStorage);
        expect(stored.master).toBe(true);
    });

    it('allows toggling individual sound effects', () => {
        render(<SoundSettingsSection />);

        fireEvent.click(screen.getByTestId('sound-master-toggle'));

        const stagingToggle = screen.getByTestId('sound-effect-stagingReady');
        expect(stagingToggle).toBeChecked();

        fireEvent.click(stagingToggle);
        expect(stagingToggle).not.toBeChecked();

        const stored = soundModule.readSoundSettings(window.localStorage);
        expect(stored.stagingReady).toBe(false);
    });

    it('triggers sound playback when Test button is clicked', () => {
        const playSpy = vi.spyOn(soundModule, 'playSound').mockImplementation(() => {});
        render(<SoundSettingsSection />);

        const testButtons = screen.getAllByRole('button', { name: /test/i });
        expect(testButtons.length).toBeGreaterThan(0);

        fireEvent.click(testButtons[0]);
        expect(playSpy).toHaveBeenCalled();
    });
});
