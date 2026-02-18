# Task: Frontend Printables UI

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
