# Printed documents

Everything Trusty Track puts on paper. All of it comes off a normal printer
— nothing to install, no PDFs. For the walkthrough, see the
[Printables guide](../printables.md).

## The seven documents

| Document | Where | What it is |
| --- | --- | --- |
| **Pit passes** | Roster → ⋯ → Print | Lanyard-sized, six per sheet: photo, name, den, car, event details |
| **Driver's licences** | Roster → ⋯ → Print | Business-card sized, ten per sheet — the same size as stationery-shop card stock. The car number is the biggest thing on it, and there is a line for the scout to sign |
| **Check-in codes** | Roster → ⋯ → Print | A QR code per racer, twelve per sheet, name and car number underneath |
| **Car labels** | Roster → ⋯ → Print | Avery 5163 shipping-label sized, ten per sheet: car number, name, racing group, inspected weight, and a scan code — for the underside of the car or the impound box |
| **Heat sheet** | Race Control → Schedule | The running order: a table per round, a row per heat, a column per lane, and an empty **Result** column to write into |
| **Results sheet** | Standings → Print results | Awards and winners at the top, then the standings — overall, and a table per den |
| **Certificates** | Race → Awards → Print certificates | One certificate per award, one per sheet, in the ceremony's running order — with artwork for a ready-made superlative or a speed award |

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

## Names on paper

Pit passes, driver's licences, car labels, the heat sheet, the results sheet
and certificates all print a racer's full name by default. **Names on public
screens**, in System Settings (with a per-race override on the race's edit
form), can shorten it to "Jordan M." or "Jordan" everywhere on this list
instead — the same setting that shortens names on the audience displays and
the standings export. See
[Race and track settings](race-settings.md#names-on-public-screens) for the
three choices. Check-in codes are the one document on this page left at full
names regardless: they are scanned at the check-in desk to find the right
child, not carried around the venue the way a pit pass is. Photos are
unaffected everywhere on this page.

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
is the way in. The box works everywhere, but it only resolves a number that
belongs to exactly one racer — manual numbering allows duplicates, so it
says which case it hit:

| What it says | What happened |
| --- | --- |
| No racer has car number *N* | Nobody on the roster holds that number |
| More than one racer has car number *N* — find them by name | Manual numbering allows duplicates; look the racer up on the roster instead |

## Car labels

Sized for **Avery 5163** shipping labels — 2in × 4in, ten per Letter sheet in
two columns of five. A label goes on the underside of the car or on the
impound box, so a pit wrangler can find car #24 among fifty near-identical
wedges without flipping anything over or touching the axles. The car number
is the loudest thing on it; the racing group, the name and the inspected
weight are secondary, and the same check-in QR code every other printable
draws from is there too, so a wrangler with a phone can confirm a car
without reading anything at all. Unlike the pit pass and the driver's
licence it carries no photo.

Impound labels are usually printed twice — once before the scale opens, and
again once every car has a weight on file. Tick **Leave the weight blank
(printing before check-in)** for the first run: it prints `____ oz` in place
of the weight regardless of what is on record, so a batch run off before
inspection cannot claim a weight that has not been checked yet. Leave it
unticked to print the recorded weight, to two decimal places — a racer who
has not been weighed yet still prints blank either way.

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

## Certificates

One certificate per award — not per racer — because a den's speed trophy or
a single Best Paint has one recipient, not a stack. They print in the
ceremony's own order (the running order on the Awards screen), so a printed
stack matches the order they get handed out in.

- An award nobody has decided yet still gets a certificate, with a blank
  line where the name goes, rather than being skipped — the same choice the
  results sheet's award lines make, and for the same reason: skipping it
  would mean reprinting the whole run the moment judging finishes.
- **Its artwork comes from the award, not a separate choice on this page.**
  A ready-made superlative carries the artwork chosen for it on the Awards
  screen; a speed award (Fastest Car, Fastest Wolf, and so on) gets its
  artwork automatically from what kind of trophy it is. An award with
  neither prints a plain certificate — no artwork, just the name, the
  recipient, and the event.
- **The two lines at the foot are for signatures**, marked Race Director and
  Cubmaster. They print blank on every certificate: Trusty Track has nowhere
  to record who signed one, and a certificate is signed as it is handed over.
- Artwork ships inside the app itself. Nothing is fetched or generated when
  you print, which matters on the venue's own network — and the same goes for
  the borders, seals and the chequered flag band on the cards.

## Printer settings worth setting once

- Turn on **Background graphics** (Chrome) / **Print backgrounds** (Safari,
  Firefox) under the print dialogue's More settings — without it the blue
  headers, the den colours, the chequered band and the certificate's border
  wash all print white. It is the one setting worth checking before a long
  run.
- Set margins to **Default**, not None. The sheets are laid out for a
  half-inch margin, and None crops the outer column.
