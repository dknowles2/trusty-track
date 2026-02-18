# Documentation Task: Race Setup Guide

## Document Details

| Field | Value |
|-------|-------|
| **Output file** | `docs/user/race-setup.md` |
| **Audience** | Pack admin setting up a race before race day |
| **Goal** | Explain how to manage dens, register racers (manually and via CSV), assign car numbers, and review the roster before race day |
| **Prerequisite** | A race has been created (see [Getting Started Guide](getting-started.md)) |

---

## Outline

### 1. Overview: The Race Details Page

Explain that this is the main hub for managing who is in the race. Summarize what you can do here:
- Add and edit dens/groups
- Register individual racers
- Bulk-import racers from a CSV file
- Assign car numbers
- View the complete racer roster

**Screenshot required:** The Race Details page showing a race with multiple dens and several racers listed. Annotate the key action buttons (Add Racer, Import CSV, etc.).

---

### 2. Managing Dens (Racing Groups)

Explain what a "den" is in the context of the application. Walk through:

- Adding a den: name, rank (Lion/Tiger/Wolf/Bear/Webelos/Arrow of Light), color.
- Editing an existing den.
- Understanding that den rank controls branding/color for that group.
- Note: Dens can be set up during initial race creation or added later.

**Screenshot required:** The Den Manager UI, showing 4–5 dens with rank colors visible (e.g., gold for Arrow of Light, blue for Webelos).

**Screenshot required:** The "Add Den" / "Edit Den" form with a rank dropdown visible.

---

### 3. Adding Racers Individually

Walk through the "Add Racer" form step by step:

- **First Name / Last Name** — required.
- **Den** — assign the racer to a den.
- **Car Number** — auto-suggested based on the race's numbering strategy; can be edited.
- **Car Name** — optional; can be added later during check-in.
- **Racer Picture** — optional; can be uploaded now or at check-in.

**Screenshot required:** The "Add Racer" form with all fields visible and sample data filled in.

**Screenshot required:** The racer list after adding several racers — show the car number column, den color indicators, and the inspection status column (all showing "not inspected" at this stage).

---

### 4. Bulk Import via CSV

Explain the workflow for importing a roster from a spreadsheet:

1. Prepare a CSV with racer information (provide a sample column layout).
2. Click "Import Racers" and upload the file.
3. Map CSV columns to Trusty Track fields if the column names don't match exactly.
4. Review the preview and confirm the import.

**Screenshot required:** The file upload dialog / "Import Racers" button in context.

**Screenshot required:** The column mapping step — show a CSV with non-standard column names being mapped to the correct fields.

**Screenshot required:** The post-import racer list showing the newly imported racers, with car numbers auto-assigned.

---

### 5. Car Number Assignment

Explain the three numbering strategies and how they work in practice:

- **Global**: All racers share a single sequence (1, 2, 3, ...). Good for small packs.
- **Per-Group**: Each den gets its own range (Lion: 100–199, Tiger: 200–299, etc.). Good when you want car numbers to indicate den membership.
- **Manual**: The operator assigns every number explicitly. Most flexible, most work.

Explain the bulk actions available:

- **Auto-Number** — assigns or re-assigns numbers to all racers based on the current strategy.
- **Clear Numbers** — removes all car numbers so you can start fresh.

**Screenshot required:** The bulk action dropdown or button showing "Auto-Number" and "Clear Numbers" options.

**Screenshot required:** The racer list before and after auto-numbering (or a side-by-side if the format supports it).

---

### 6. Bulk Racer Actions

Cover additional bulk operations:

- **Move to Den** — select multiple racers and reassign them to a different den.
- **Delete Racers** — remove selected racers from the race.

Note: Always double-check before deleting; this cannot be undone.

**Screenshot required:** The racer list with multiple racers selected (checkboxes), and the bulk action menu visible.

---

### 7. Reviewing the Roster Before Race Day

Summarize the checklist to complete before race day:

- [ ] All expected racers have been added.
- [ ] Every racer is assigned to the correct den.
- [ ] Car numbers are assigned.
- [ ] No duplicate car numbers exist.

Mention that the "Car Passed Inspection" column defaults to **Not Inspected** for all racers and will be updated on race day during check-in.

**Screenshot required:** The final roster with a realistic mix of racers across 3–4 dens, car numbers assigned, and all inspection statuses showing "Pending."

---

## Notes for the Writer

- The CSV import column-mapping step is a planned enhancement (see `tasks/improvements/02_csv_column_mapping.md`). Take screenshots of the current behavior and note any limitations.
- Do not mention the database, SQLite, or any backend details.
- Tip boxes are encouraged: e.g., "Tip: You can always come back and add more racers — even on race day."
