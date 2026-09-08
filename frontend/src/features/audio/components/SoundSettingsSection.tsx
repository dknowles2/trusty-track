/**
 * Settings controls for event-triggered sound effects (#554).
 *
 * Configures synthesized WebAudio effects for race events (staging, race start,
 * finish chime, track record broken, award ceremony fanfare).
 * Saved on this device only (per-device localStorage preference).
 */

import React, { useState } from 'react';
import {
    playSound,
    readSoundSettings,
    writeSoundSettings,
    type SoundEffect,
    type SoundEffectsSettings,
} from '../soundEffects';

interface SoundEffectOption {
    key: SoundEffect;
    title: string;
    description: string;
}

const EFFECT_OPTIONS: readonly SoundEffectOption[] = [
    {
        key: 'stagingReady',
        title: 'Staging & Ready',
        description: 'Short double-tone when a heat is armed at the gate.',
    },
    {
        key: 'gateRelease',
        title: 'Race Start / Gate Release',
        description: 'Starter horn signal when the gate drops and the heat begins.',
    },
    {
        key: 'finish',
        title: 'Heat Finish',
        description: 'Two-tone finish chime when heat results are recorded.',
    },
    {
        key: 'recordBreak',
        title: 'Track Record Broken',
        description: 'Celebratory ascending fanfare when a new track record is set.',
    },
    {
        key: 'awardFanfare',
        title: 'Award Fanfare',
        description: 'Triumphant fanfare when presenting each award in the ceremony.',
    },
];

export default function SoundSettingsSection(): React.ReactElement {
    const [settings, setSettings] = useState<SoundEffectsSettings>(() => readSoundSettings());

    const updateSettings = (updated: SoundEffectsSettings) => {
        setSettings(updated);
        writeSoundSettings(window.localStorage, updated);
    };

    const handleMasterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        updateSettings({
            ...settings,
            master: e.target.checked,
        });
        if (e.target.checked) {
            // Preview the finish sound when turned on, matching the chime toggle convention
            playSound('finish');
        }
    };

    const handleEffectChange = (key: SoundEffect, checked: boolean) => {
        updateSettings({
            ...settings,
            [key]: checked,
        });
        if (checked) {
            playSound(key);
        }
    };

    return (
        <div style={{ marginBottom: '2rem' }} data-testid="sound-settings-section">
            <p id="sound-settings-label" style={{ margin: '0 0 0.25rem', fontWeight: 'bold' }}>
                Sound Effects
            </p>
            <p style={{ color: 'var(--text-muted-color)', fontSize: '0.85rem', margin: '0 0 0.75rem' }}>
                Synthesized race and ceremony sound effects. Off by default, remembered on this device only.
            </p>

            <div style={{ marginBottom: '1rem' }}>
                <label
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontSize: '0.95rem',
                    }}
                >
                    <input
                        type="checkbox"
                        data-testid="sound-master-toggle"
                        checked={settings.master}
                        onChange={handleMasterChange}
                    />
                    Enable sound effects on this device
                </label>
            </div>

            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                    paddingLeft: '1.5rem',
                    opacity: settings.master ? 1 : 0.6,
                }}
            >
                {EFFECT_OPTIONS.map((opt) => (
                    <div
                        key={opt.key}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '0.5rem 0.75rem',
                            borderRadius: '4px',
                            backgroundColor: 'var(--card-bg-color, rgba(0, 0, 0, 0.02))',
                            border: '1px solid var(--border-color, #e0e0e0)',
                        }}
                    >
                        <div>
                            <label
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    cursor: settings.master ? 'pointer' : 'default',
                                    fontWeight: 500,
                                    fontSize: '0.9rem',
                                }}
                            >
                                <input
                                    type="checkbox"
                                    data-testid={`sound-effect-${opt.key}`}
                                    disabled={!settings.master}
                                    checked={settings.master && settings[opt.key]}
                                    onChange={(e) => handleEffectChange(opt.key, e.target.checked)}
                                />
                                {opt.title}
                            </label>
                            <p
                                style={{
                                    margin: '0.15rem 0 0 1.6rem',
                                    fontSize: '0.8rem',
                                    color: 'var(--text-muted-color)',
                                }}
                            >
                                {opt.description}
                            </p>
                        </div>
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                            onClick={() => playSound(opt.key)}
                            title={`Preview ${opt.title}`}
                        >
                            Test
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
