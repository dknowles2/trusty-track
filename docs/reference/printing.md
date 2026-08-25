# Printed documents

Everything Trusty Track puts on paper. All of it comes off a normal printer
— nothing to install, no PDFs. For the walkthrough, see the
[Printables guide](../printables.md).

## The five documents

| Document | Where | What it is |
| --- | --- | --- |
| **Pit passes** | Roster → ⋯ → Print | Lanyard-sized, six per sheet: photo, name, den, car, event details |
| **Driver's licences** | Roster → ⋯ → Print | Business-card sized, ten per sheet — the same size as stationery-shop card stock. The car number is the biggest thing on it |
| **Check-in codes** | Roster → ⋯ → Print | A QR code per racer, twelve per sheet, name and car number underneath |
| **Heat sheet** | Race Control → Schedule | The running order: a table per round, a row per heat, a column per lane, and an empty **Result** column to write into |
| **Results sheet** | Standings → Print results | Awards and winners at the top, then the standings — overall, and a table per den |

## Rules the card documents follow

- Cards print in **car number order**, unnumbered racers last — they are the
  ones still needing a number, easiest to spot at the bottom of the stack.
- Ticking racers on the roster before opening Print prints just those; with
  nothing ticked, the whole roster.
- The line under the buttons says how much paper the job is before you
  commit any.
- A racer with no photo gets their initials — passes are usually printed
  before check-in, which is exactly when photos are missing.
- The dashed lines on screen are cut guides; they do not print.

## Check-in codes

A code identifies **that racer at that race**. A pass from last year's derby
will not scan into this year's, deliberately: the racer it points at could be
a different scout now.

What the scanner may say, and what each message means:

| What it says | What happened |
| --- | --- |
| That is not a Trusty Track code | Some other QR code — a product label, a poster |
| That code is for a different race | A pass from another event, most likely last year's |
| That code is for a racer who is no longer on this roster | The racer was deleted after the code was printed |

Scanning uses a browser feature only Chrome and Edge have. In Safari and
Firefox the scanner opens without a viewfinder, and the **Car number** box
is the way in. The box works everywhere, and only matches when exactly one
racer holds that number.

## The heat sheet

The document that matters when something goes wrong — the wifi drops, the
laptop runs flat, and the announcer still has to know which cars are next.

- A championship round whose line-up is not decided yet reads **To be
  decided** in each lane, rather than being blank: somebody will write a
  name in.
- A lane nobody is in reads **—**: nobody is coming. The difference from
  the line above matters.
- Every row has a column for every lane the track has, so a heat short a
  lane still lines up with the rows around it.

## The results sheet

- The standings on it are the **qualifying rounds only**, and the sheet says
  so — championship placings are in the awards table at the top.
- Each den's table is numbered from 1: what a reader wants there is who won
  the den, not pack ranks.
- An award nobody has decided prints as **Not awarded** rather than being
  left out — a missing line reads as an award that does not exist.
- A race with one den gets no per-den tables; racers in no den appear only
  in the overall table.

## Printer settings worth setting once

- Turn on **Background graphics** (Chrome) / **Print backgrounds** (Safari,
  Firefox) under the print dialogue's More settings — without it, the blue
  headers and den colours print white.
- Set margins to **Default**, not None. The sheets are laid out for a
  half-inch margin, and None crops the outer column.
