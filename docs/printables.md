# Printables

Trusty Track prints three things: **pit passes**, **driver's licences**, and
**check-in codes**. All three come off a normal printer on plain paper or card
— there is nothing to install and no PDF to download.

Print before check-in opens. The whole roster is one job, and the sheets are
laid out to be printed and then cut up.

## Getting there

Open a race, click **⋯** at the top right of the roster, and choose **Print**.

![The Print button on the racer roster](assets/screenshots/printables/roster-print-button.png)

Tick some racers first and the button prints just those — useful when a den
turns up late, or a scout registers on the morning. With nothing ticked it
prints the whole roster.

## Choosing what to print

The three buttons across the top switch between documents. The line underneath
tells you how much paper the job is before you commit any:

> 6 cards · 1 sheet of Letter · 10 per sheet

Cards come out in car-number order, so the stack matches how the roster reads.
**Racers with no car number sort to the end** — they are the ones still needing
a number, and that is easier to notice at the bottom of the stack than in the
middle of it.

### Pit passes

Lanyard sized, six to a sheet. The photo, the name, the den, the car, and the
event details — what a scout needs to know where to be.

![A sheet of pit passes](assets/screenshots/printables/pit-pass-sheet.png)

A racer with no photo yet gets their initials instead. Passes usually get
printed *before* check-in, which is exactly when the photos are missing.

![A single pit pass](assets/screenshots/printables/pit-pass-card.png){ width=260 }

### Driver's licences

Business-card sized, ten to a sheet — the same size as stationery-shop business
card stock, if you want to print them on card rather than cut them out.

![A sheet of driver's licences](assets/screenshots/printables/drivers-license-sheet.png)

The car number is the biggest thing on it, because that is what gets called out
at the track.

![A single driver's licence](assets/screenshots/printables/drivers-license-card.png){ width=260 }

### Check-in codes

A QR code per racer, twelve to a sheet, with the name and car number
underneath.

![A sheet of check-in codes](assets/screenshots/printables/check-in-code-sheet.png)

![A single check-in code](assets/screenshots/printables/check-in-code-card.png){ width=260 }

Cut them up and hand them out, or leave the sheet whole and scan off it as
scouts arrive — the name under each code is there for both.

The code identifies **that racer at that race**. A code printed at last year's
derby will not scan into this year's, which is deliberate: the racer it points
at could well be a different scout this year, and scanning the wrong child in
at check-in is expensive.

## Scanning at check-in

Click **Scan** above the roster, hold a printed code up to the camera, and that
racer's check-in opens.

![The check-in scanner](assets/screenshots/printables/check-in-scanner.png)

*(The green pattern above is a test camera — yours shows the real one.)*

There is a **Car number** box under the viewfinder, and it works everywhere.
Use it when a code is creased, the camera will not focus, or there is a queue.

!!! note "Scanning needs Chrome or Edge"

    QR decoding uses a browser feature only Chromium-based browsers have. In
    Safari and Firefox the scanner opens without a viewfinder and the car
    number box is the way in — everything else about check-in is the same.

A few things the scanner will refuse, and what they mean:

| What it says | What happened |
| --- | --- |
| That is not a Trusty Track code | Some other QR code — a product label, a poster |
| That code is for a different race | A pass from another event, most likely last year's |
| That code is for a racer who is no longer on this roster | The racer was deleted after the code was printed |

The last two are why codes carry the race: without it, a pass from last year's
derby would check in whoever holds that racer number today.

## Printing

Click **Print** and your browser's own print dialogue opens. Two things worth
setting the first time:

!!! tip "Turn on background graphics"

    In the print dialogue, under **More settings**, tick **Background
    graphics** (Chrome) or **Print backgrounds** (Safari, Firefox). Without it
    the blue header bars and den colours print white.

!!! tip "Set margins to Default, not None"

    The sheets are laid out for a half-inch margin. "None" will crop the outer
    column.

The dashed lines on screen are cut guides — they do not print.

## The heat sheet

The running order on paper: a table per round, a row per heat, a column per
lane, and an empty **Result** column to write the finishing order into.

**Race Control → Schedule → Heat sheet.** It lives there rather than with the
cards above because it prints the *schedule* rather than the roster.

![The printed heat sheet](assets/screenshots/printables/heat-sheet.png)

This is the artefact that matters when something goes wrong. The wifi drops,
the laptop runs flat, the timer stops talking — and the announcer still has to
know which cars are next. Print it once the schedule is settled and put it on
the table.

Two things it shows that a screen does not have to:

- A championship round whose field is not decided yet reads **To be decided**
  in each lane, rather than being blank. Somebody will write a name in.
- A lane nobody is in reads **—**. That happens with an odd number of racers,
  or where a lane is [out of service](hardware-timer.md#if-a-lane-stops-working),
  and the difference from the line above matters: nobody is coming.

## The results sheet

The other half of the pair: the heat sheet goes on the table before the racing,
this one goes on the noticeboard afterwards. Awards and their winners at the
top, then the standings — overall, and one table per den.

**Standings → Print results.** It lives there rather than in the roster's print
menu, because that menu prints the *cards* — one per racer, before the event —
and this is one document about the whole race once it is over.

![The printed results sheet](assets/screenshots/printables/results-sheet.png)
_Awards first, then the overall standings, then a table per den. The den tables
are the overall standings narrowed, so they cannot disagree with a "fastest
Wolf" trophy about who won._

Three things worth knowing:

- **The standings are the qualifying rounds only**, and the sheet says so. A
  championship's placings are a consequence of these rather than part of them
  (see [scoring](race-day.md#part-5-final-standings)), and the trophies
  for it are in the awards table at the top.
- **Each table is numbered from 1.** A den's table headed 4, 9, 17 would be a
  list of pack ranks; what a reader wants there is who won the den.
- **An award nobody has decided prints as "Not awarded"** rather than being
  left out. A missing line reads as an award that does not exist; this one
  reads as one somebody still has to fill in.

A race with only one den gets no per-den tables, since they would repeat the
overall one. Racers in no den appear in the overall table and in none of the
den tables.
