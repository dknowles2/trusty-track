---
hide:
  - toc
---

# How Trusty Track compares

Several programs run Pinewood Derby races, and most packs would do fine with any
of them. Here is what the others are, and when one of them is the better pick.

Prices and versions were checked on each program's own site on 28 August 2026;
the "Telling screens apart" row on 29 August 2026, and the "Words on screen"
row on 30 August 2026; Derby Pulse's entries on 3 September 2026. They move,
so follow the links before you spend anything, and please
[tell us](https://github.com/dknowles2/trusty-track/issues) if something here has
gone stale or reads unfairly.

You can try Trusty Track without installing it. The
[demo](https://demo.trusty-track.com) is a real race, already set up. There is only
one of it, so anybody else looking at the same moment is in the same race as you,
and it resets itself once it has been quiet for a while. DerbyNet's playground gives
each visitor a private instance instead, which is the nicer arrangement and one we
have not built yet.

## The others

[**GrandPrix Race Manager**](https://www.grandprix-software-central.com/gprm/) is
the one you will hear named most often. It is on its twenty-sixth annual version,
covers Awana Grand Prix, Space Derby and Raingutter Regatta as well as Pinewood,
and costs $60 for Lite or $80 for Pro. One Windows or Mac machine runs the
event. If somebody in your pack already knows this program, that is worth more
than anything on this page.

[**DerbyNet**](https://derbynet.org/) is free, MIT-licensed, and has been
developed in the open since 2015. It works much the way Trusty Track does: a small
server on one machine, with every other screen joining in a browser. Installing it
means unzipping a folder with Apache and PHP inside it and starting that server,
which is a couple of steps more than a double-click. Their
[playground](https://hosting.derbynet.org/playground.php) hands you a private
instance for a few hours if you want a look first.

Ten of Trusty Track's twelve timer profiles are adapted from DerbyNet's protocol
notes, under its licence and credited in the source. A pack with an unusual timer
has Jeff Piazza to thank for that, not us.

[**Derby Magic Race Manager**](https://derbymagic.com/race-management/) costs $65
and runs on Windows. The Derby Magic Company sell tracks and timers too, so it is
the sensible choice if your track came from them and you would rather have one
phone number for the lot.

[**Derby Day!**](http://www.derbydaysoftware.com/) is free, Windows-only, takes up
to fifteen racers and does exactly one format: ladderless elimination. If that is
how your pack races, its narrowness is the point.

[**Derby Pulse**](https://derbypulse.com/) is not really the same kind of program
as the four above — it does not schedule heats or talk to a timer at all. It is a
free, cloud-hosted app that runs entirely in a browser: a parent scans a QR code
with their own phone to register a car and have a number assigned automatically,
where Trusty Track's check-in is run from a desk. Inspecting the car is still
somebody's job at a table, but Derby Pulse gives them a digital checklist — a
six-item BSA default that a pack can edit — rather than the single
passed-inspection toggle and optional weight limit this page's own inspection
amounts to. The base app is free; a one-time $15 per event unlocks car photos,
live voting, award categories and a results-reveal dashboard. Because
everything lives on Derby Pulse's own servers, using it means an internet
connection on race day, and it still hands its roster off to something else —
a spreadsheet, or one of the programs above — to actually run the race.

A spreadsheet is what plenty of packs use, and for a first year with fifteen cars
and a stopwatch it is a perfectly good answer.

## Side by side

| | **Trusty Track** | **GrandPrix RM** | **DerbyNet** | **Derby Magic** | **Derby Day!** | **Derby Pulse** |
| --- | --- | --- | --- | --- | --- | --- |
| **Cost** | Free | $60 Lite, $80 Pro | Free | $65 | Free | Free, $15/event premium |
| **Licence** | Apache 2.0 | Proprietary | MIT | Proprietary | Proprietary | Proprietary |
| **Runs on** | Windows, macOS, Pi, Docker | Windows, macOS | Windows, macOS, Linux, Pi | Windows | Windows | Web only |
| **What you install** | One app | One app | A zip holding a bundled web server | One app | One app | Nothing — free account |
| **Other screens** | Any browser on the network | Single machine | Any browser on the network | Single machine | Single machine | Any browser with internet |
| **Telling screens apart** | Names itself on connect, rename any time | — | Named by hand, one at a time | — | — | — |
| **Timer models listed** | 12 | 6, plus custom in Pro | 8 | Their own | By hand or timer | Not a timer program |
| **Race formats** | Perfect-N, championship, elimination, balanced, slowest | Several, more in Pro | Several | Several | Elimination only | Doesn't run races |
| **Racer limit** | None | None | None | None | 15 | — |
| **Racer and car photos** | Yes | Pro only | Yes | — | — | Premium only |
| **Words on screen** | Free text — group, organization and vehicle, plus a vehicle picture | Built-in presets for Pinewood, Awana Grand Prix, Space Derby and Raingutter Regatta, with their own vehicle names | — | — | — | — |
| **Try before installing** | One shared demo | — | A private instance, a few hours | — | — | In-app demo, read-only |
| **Public since** | Jan 2026 | Version 26 | Jul 2015 | Long-established | Long-established | — |

A blank cell means their site does not say, not that the answer is no.

## When to pick something else

Trusty Track's repository is seven months old. DerbyNet's is eleven years old, and
GrandPrix Race Manager is on version twenty-six. Both have run into race-day
problems that have not come up here yet, and if your derby is next week and it is
your first, that history counts for more than any feature.

Nine of the twelve timer models listed here have never been connected to the
actual hardware. They were built from DerbyNet's written notes, and only the ones marked
*Tested* on the [front page](https://trusty-track.com/#timers) have been checked
against recordings of a real device. [Hardware Timer](hardware-timer.md) explains
what that means on the day, and how a bench test moves a timer across.

Support is a GitHub issue tracker read by one person who has a day job. Nobody
outside the project has reviewed any of this either, so everything above about
Trusty Track is the author's own account of it.

If self-service is what you want on check-in night — a parent scanning a QR
code with their own phone to register a car, rather than a line at a desk —
[Derby Pulse](https://derbypulse.com/) does that and Trusty Track does not.
Its digital inspection checklist goes further too: a pack can add or edit its
own line items, where Trusty Track offers a single passed-inspection toggle
and an optional weight limit.

## When to pick this one

You install one application and open it. There is no server to start, no database
to create, and nothing to configure afterwards.

Every screen is a browser, so the check-in desk can work from a tablet while the
projector at the back is another tab, both reading the same event over the hall's
own wifi. The operator can change what any screen is showing without getting up.

It expects the day to go wrong. A racer turning up after the round has started, a
lane whose sensor dies mid-event, a car withdrawn between rounds, a time typed in
wrong and corrected later: each of those has a defined behaviour rather than a
workaround, and [Mid-race changes](reference/mid-race-changes.md) lists what
happens in each case.

Nothing leaves the building. No accounts, no cloud service, no internet needed on
race day, and children's names and photographs stay on your own machine.

The rules are also written down. When a parent asks why their child came fourth,
[Reference](reference/index.md) has the answer in full.

Trusty Track started as a Cub Scout Pinewood Derby program, and some of the
others on this page did too — but here the words on screen are not fixed. A
school, a club, a Space Derby, or a Raingutter Regatta can rename "Den",
"Pack" and "Car" to their own, in any words at all, install-wide or per
race; see
[the words on screen](reference/race-settings.md#the-words-on-screen).
GrandPrix Race Manager already covers those same formats, with its own
built-in vehicle names (car, truck, rocket, boat) — the difference here is
that the words are free text rather than a fixed list, and the racing group
and organization can be renamed alongside the vehicle.

## Sources

- GrandPrix Race Manager — [product page](https://www.grandprix-software-central.com/gprm/)
  and [shop](https://grandprix-software-central.com/index.php/shopping/category/70-grandprix-race-manager)
- DerbyNet — [derbynet.org](https://derbynet.org/), the
  [source](https://github.com/jeffpiazza/derbynet), the
  [playground](https://hosting.derbynet.org/playground.php), and the
  ["Assign Name" kiosk instructions](https://derbynet.org/builds/docs/Running%20a%20Race%20with%20DerbyNet.pdf)
  in its manual
- Derby Magic — [race management](https://derbymagic.com/race-management/) and
  [pricing](https://derbymagic.com/pricing-guide/)
- Derby Day! — [derbydaysoftware.com](http://www.derbydaysoftware.com/)
- Derby Pulse — [derbypulse.com](https://derbypulse.com/)

*Pinewood Derby is a registered trademark of the Boy Scouts of America. Awana
Grand Prix is a registered trademark of Awana Clubs International. Other names
belong to their owners, and Trusty Track is not affiliated with any of them.*
