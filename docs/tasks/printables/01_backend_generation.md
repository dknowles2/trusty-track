# Task: Backend Printable Generation [PARTLY BUILT]

> **Step 2 is built** — `GET /api/printables/barcode/{racer_id}.png`, with
> `services/printables.py` rendering and `domain/printables.py` owning what
> the payload says.
>
> **Steps 3 and 4 are deliberately not being built as specified.** The
> licence and the pit pass are HTML the browser prints, not server-rendered
> PDFs: no PDF toolchain on a Raspberry Pi, the branding and layout already
> live in the frontend, a sheet of sixty is a CSS grid rather than a page
> composition problem, and the operator gets a print preview and a choice of
> paper. See `02_frontend_print_ui.md`.
>
> Step 1's PDF library is therefore not needed; step 5's `printableUrl` is
> not either, since the one URL is a fixed shape.

## Goal

Implement backend endpoints to generate barcodes/QR codes and print-ready PDFs for the three printable document types: check-in barcode, driver's license, and pit pass.

## Background

DESIGN.md specifies these endpoints:
- `GET /api/printables/barcode/{racer_id}` - Barcode/QR for check-in scanning
- `GET /api/printables/drivers_license/{racer_id}` - Driver's license printable
- `GET /api/printables/pit_pass/{racer_id}` - Pit pass printable

The application has shifted to GraphQL for data operations, but printables are best served as REST endpoints since they return binary file responses (images/PDFs) that browsers can directly open or download.

## Steps

1. **Add Dependencies**
   - Add a QR code generation library (e.g., `qrcode[pil]`) to `pyproject.toml`.
   - Add a PDF generation library (e.g., `reportlab` or `weasyprint`) to `pyproject.toml`.

2. **Implement Barcode/QR Endpoint** (`GET /api/printables/barcode/{racer_id}`)
   - Generate a QR code encoding the racer's ID (or a URL like `/checkin?racer_id={id}`).
   - Return as PNG image (`Content-Type: image/png`).
   - Should also be possible to embed in PDFs for the other printables.

3. **Implement Driver's License Endpoint** (`GET /api/printables/drivers_license/{racer_id}`)
   - Generate a business-card-sized (3.5" × 2") PDF or PNG.
   - Include: participant name, car name, car number, race name, BSA branding colors.
   - Include the racer's photo if available (`racer_image_url`).
   - Include a small QR code for easy check-in scanning.
   - Return as PDF (`Content-Type: application/pdf`) or PNG.

4. **Implement Pit Pass Endpoint** (`GET /api/printables/pit_pass/{racer_id}`)
   - Generate a lanyard-ready printable (approximately 3" × 4").
   - Include: event name, date, time, location, participant name, participant picture.
   - Include QR code for check-in.
   - Return as PDF or PNG.

5. **Add GraphQL Queries (Optional)**
   - Consider adding `printableUrl(racerId, type)` fields to the GraphQL `Racer` type to return the URL for each printable, so the frontend can use GraphQL to retrieve URLs rather than constructing them directly.

6. **Register Routes**
   - Add the new endpoints to `main.py` under the `/api/printables/` prefix.

## Verification

- Add tests in `backend/test_printables.py`:
  - Test barcode endpoint returns valid PNG.
  - Test driver's license endpoint returns valid PDF/PNG.
  - Test pit pass endpoint returns valid PDF/PNG.
  - Test 404 response for unknown racer ID.
- Run `pytest backend/test_printables.py`.
- Manually download and verify each printable looks correct.

## Notes

- Use BSA colors from SPEC.md: Scouting Blue `#003F87`, Cub Scouting Gold `#FCD116`.
- Typography: Roboto Condensed Bold for headers, Roboto Regular for body.
- Consider generating printables as PNG for simplicity, then wrapping in PDF if needed.
