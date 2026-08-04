# Task: Frontend Printables UI [COMPLETED]

> Built as `features/printables/`, reachable from the roster's **Print**
> button at `/race/:raceId/print`. User guide: `docs/printables.md`.
>
> **Sheet-first rather than card-first, which is the one real departure from
> the steps below.** They describe a per-racer menu with a link per document
> and a separate bulk option; nobody prints one pit pass, so the page is the
> sheet, the roster's selection is carried in on `?racers=`, and an empty
> selection means the whole roster rather than nothing. There is no per-racer
> print menu at all.
>
> Two smaller consequences of the HTML-not-PDF decision in
> `01_backend_generation.md`:
>
> - **No `barcode_sheet/{race_id}` endpoint** (step 2). A sheet is a CSS grid
>   of the per-racer images the browser already caches.
> - **No preview modal** (step 3). The page *is* the preview — the cards are
>   sized in inches in both media, so what is on screen is the paper.
>
> The layout numbers live in `documents.ts`, not the stylesheet, because the
> page has to say "2 sheets of Letter" before the operator commits paper to
> it, and a card size kept in two places drifts.

## Goal

Add a UI in the Racer Details page to allow operators to generate and print the three document types for each racer: check-in barcode, driver's license, and pit pass.

## Background

SPEC.md states that "once all racers are input into the system, we should also provide the option to physically print some documents." This should be accessible from the racer roster view.

## Steps

1. **Add Print Actions to Racer Roster**
   - In `RaceDetails.tsx`, add a print/download menu to each racer row (or within the racer's action buttons).
   - The menu should offer three options:
     - Print Barcode (generates check-in QR)
     - Print Driver's License
     - Print Pit Pass
   - Clicking an option opens the document in a new tab (browser print dialog) or triggers a download.

2. **Bulk Print Option**
   - Add a bulk action "Print Barcodes" that generates a sheet of barcodes for all selected racers (e.g., 8-per-page Avery label layout).
   - This may require a new backend endpoint: `GET /api/printables/barcode_sheet/{race_id}`.

3. **Print Preview Modal (Optional)**
   - Consider a simple preview modal that shows a scaled-down render of the document before printing.
   - For MVP, opening in a new browser tab is sufficient.

4. **URL Construction**
   - Construct printable URLs using the pattern `/api/printables/{type}/{racer_id}`.
   - Example: `<a href="/api/printables/drivers_license/42" target="_blank">Print Driver's License</a>`

## Verification

- Verify each print link opens the correct document in a new tab.
- Verify the document renders with correct racer data.
- Verify bulk barcode sheet includes all selected racers.

## Dependencies

- Requires `01_backend_generation.md` to be completed first.
