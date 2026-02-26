# Task: CSV Import Column Mapping UI

## Goal

When importing racers via CSV, allow the operator to map arbitrary CSV column headers to the required racer fields, rather than requiring a specific CSV format.

## Background

SPEC.md states:
> "We should suggest a suitable format that matches the required text fields, but also allow an arbitrary CSV to be uploaded and then allow the user to map the columns in the CSV to the specific fields we need to consume."

The existing `ImportRacersModal.tsx` imports a CSV file and sends it to the backend `import_racers` mutation. However, it assumes a specific column format and does not present a column mapping UI.

## Steps

1. **Parse CSV Headers on Upload**
   - After the user selects a CSV file in `ImportRacersModal.tsx`, parse the header row client-side (without uploading yet).
   - Display the detected column headers to the user.

2. **Column Mapping UI**
   - Render a mapping form with one row per required/optional field:
     - Required: First Name, Last Name, Car Number (optional for MANUAL strategy)
     - Optional: Car Name, Den, Car Passed Inspection
   - Each row has a dropdown to select which CSV column maps to that field (or "Not included" to skip).
   - Pre-populate with smart defaults by matching column names case-insensitively (e.g., `first_name`, `First Name`, `firstname` → First Name).

3. **Preview**
   - After mapping, show a preview table of the first 5 rows as they would be imported.
   - Highlight any validation errors (e.g., missing required fields, duplicate car numbers).

4. **Submit with Mapping**
   - Pass the column mapping to the backend `import_racers` mutation so it can parse the CSV accordingly.
   - Alternatively, transform the CSV client-side using the mapping before sending to the backend.

5. **Suggested Format Download**
   - Provide a "Download Template CSV" link that generates a CSV with the expected column headers for easy reference.

## Verification

- Upload a CSV with non-standard column names. Verify the mapping UI appears.
- Map columns and verify the preview shows correct data.
- Complete the import and verify racers are created with correct data.
- Upload a CSV with standard column names and verify the mapping is auto-detected.
