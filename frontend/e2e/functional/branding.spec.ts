/**
 * The BSA typography is applied, and nothing leaves the machine to do it (#139).
 *
 * `docs/spec.md` names Roboto and Roboto Condensed under "UI & Branding
 * (Official BSA Guidelines)", and `index.css` has always named them — but
 * nothing loaded them from anywhere, so every platform this ships to fell
 * through to its own default sans-serif. The specified typography was never
 * the typography.
 *
 * The second assertion is the one that matters most and is easiest to lose. A
 * Google Fonts link would satisfy the first while failing exactly where this
 * app runs: a Raspberry Pi at a venue, on a LAN, often with no internet. An
 * external request here is a regression even if the fonts still render on a
 * developer's laptop.
 */

import { test, expect } from '@playwright/test';
import { ensureConfigured } from './support';

test('the branding fonts render, and nothing is fetched from the internet', async ({
    page,
}) => {
    const external: string[] = [];
    page.on('request', (request) => {
        const url = request.url();
        if (!url.includes('localhost') && !url.includes('127.0.0.1') && !url.startsWith('data:')) {
            external.push(url);
        }
    });

    await ensureConfigured(page);
    await page.waitForLoadState('networkidle');

    const faces = await page.evaluate(async () => {
        await document.fonts.ready;
        return Array.from(document.fonts).map((f) => ({
            family: f.family,
            weight: f.weight,
            status: f.status,
        }));
    });

    // One variable face per family, covering every weight the UI asks for
    // rather than six static ones and a synthesised approximation.
    expect(faces).toContainEqual({ family: 'Roboto', weight: '100 900', status: 'loaded' });
    expect(faces).toContainEqual({
        family: 'Roboto Condensed',
        weight: '100 900',
        status: 'loaded',
    });

    // Declared *and* resolved: `document.fonts.check` answers against the font
    // the element would actually be painted with, so this fails if the family
    // is named but unavailable — which is the state this issue was about.
    const heading = await page.evaluate(() => {
        const element = document.querySelector('h1, h2, h3');
        if (!element) return null;
        const style = getComputedStyle(element);
        return { family: style.fontFamily, available: document.fonts.check(style.font) };
    });
    expect(heading?.family).toContain('Roboto Condensed');
    expect(heading?.available).toBe(true);

    expect(external).toEqual([]);
});
