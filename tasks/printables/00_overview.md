# Printables Feature Overview

## Background

SPEC.md defines a "Printables" feature as part of the Racer Details journey. Once all racers are input into the system, operators should be able to physically print documents for each participant.

This feature also ties into the **Race Check-In** journey: if barcode/QR printables were previously generated, a check-in operator should be able to scan them to immediately pull up the racer's check-in flow.

## Designed Outputs

From SPEC.md:

1. **Check-in Barcode** - A barcode or QR code that links to the racer's check-in record. Allows a check-in operator to scan and immediately start the check-in process.
2. **Driver's License** - A cute business-card-sized printout about the participant that "allows" them to race. Should contain participant name, car name/number, and race branding.
3. **Pit Pass** - A printable suitable for hanging on a lanyard. Contains the event name, date, time, location, participant name, and participant picture.

## Scope

This feature spans both backend and frontend:

- **Backend**: Generate barcodes/QR codes and produce print-ready PDFs or images.
- **Frontend**: Provide a UI to preview and trigger printing of each document type, plus a camera-based scanning flow for check-in.

## Task Breakdown

- `01_backend_generation.md` - Backend barcode/QR code generation and PDF printable generation
- `02_frontend_print_ui.md` - Frontend UI for generating and printing documents
- `03_frontend_check_in_scan.md` - Camera-based barcode/QR scanning for race check-in

## Design Reference

- SPEC.md: "Printables" section under "Racer Details"
- SPEC.md: "Race Check-In" section
- DESIGN.md: `/api/printables` endpoints (currently not implemented)
