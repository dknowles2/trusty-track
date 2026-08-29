---
hide:
  - toc
---

# How Trusty Track compares

There is more than one program for running a Pinewood Derby, and most of them
are good. This page is here so you can work out which one suits your pack —
including the cases where that is not this one.

Everything below was checked against each program's own website on
**28 August 2026**. Prices are in US dollars and change; follow the links before
you spend anything. If something here is out of date or unfair, please
[open an issue](https://github.com/dknowles2/trusty-track/issues) and it will be
corrected.

!!! note "The honest headline"

    GrandPrix Race Manager and DerbyNet have each run thousands of real events.
    Trusty Track's public repository is seven months old. If your race is next
    week and you have never run one before, the safest choice is one of the
    established programs. Trusty Track is the right pick when its particular
    shape suits you and you do not mind being an early user.

## The short answer

**Choose [GrandPrix Race Manager](https://www.grandprix-software-central.com/gprm/)**
if you want what most packs use, with someone to phone when it goes wrong. It is
the oldest and most complete of these, now on its twenty-sixth annual version,
and $60–$80 is a small line on a pack budget.

**Choose [DerbyNet](https://derbynet.org/)** if you want free and open source
with a decade of race days behind it, and you like the idea of screens all round
the room. It has been public since 2015 and is still actively developed.

**Choose [Derby Magic Race Manager](https://derbymagic.com/race-management/)**
if you already run a Derby Magic track and timer and would rather have
everything from one supplier.

**Choose [Derby Day!](http://www.derbydaysoftware.com/)** if your pack races a
small ladderless elimination bracket and you want the simplest thing that exists.

**Choose Trusty Track** if you want one application to install with nothing to
configure afterwards, a browser interface that works on a phone at the check-in
table and a projector at the back of the hall, and you are comfortable being
among the first packs to use it.

**Or use a spreadsheet.** Plenty of packs do, and for a first year with fifteen
cars and a stopwatch it is a perfectly reasonable answer.

## Side by side

| | **Trusty Track** | **GrandPrix RM** | **DerbyNet** | **Derby Magic** | **Derby Day!** |
| --- | --- | --- | --- | --- | --- |
| **Cost** | Free | $60 Lite, $80 Pro | Free | $65 | Free |
| **Licence** | Apache 2.0 | Proprietary | MIT | Proprietary | Proprietary |
| **Runs on** | macOS, Windows, Docker, Pi | Windows, macOS | Windows, macOS, Linux, Pi | Windows | Windows |
| **What you install** | One app | One app | A zip holding a bundled web server | One app | One app |
| **Other screens** | Any browser on the network | Single machine | Any browser on the network | Single machine | Single machine |
| **Timer models listed** | 8 | 6, plus custom in Pro | 8 | Their own | By hand or timer |
| **Race formats** | Perfect-N, championship, elimination, balanced, slowest | Several, more in Pro | Several | Several | Elimination only |
| **Racer limit** | None | None | None | None | 15 |
| **Racer and car photos** | Yes | Pro only | Yes | — | — |
| **Public since** | Jan 2026 | Version 26 | Jul 2015 | Long-established | Long-established |

A blank cell means the program's own site does not say, not that the answer is
no. Where it matters to you, ask them.

## What each one is like

### GrandPrix Race Manager

The one you will hear named most often, from Grand Prix Software Central. It
handles Pinewood Derby, Awana Grand Prix, Space Derby and Raingutter Regatta,
which is more breadth than anything else here. Two editions: Lite for the basics
and Pro for racer photos, extra scheduling methods, track records, tiebreaker
rules, custom timer configuration and its companion apps. It runs on one Windows
or Mac machine.

If your pack has run derbies for years and someone already knows this program,
that knowledge is worth more than any feature list on this page.

### DerbyNet

Jeff Piazza's open-source system, and the closest thing to Trusty Track in
shape: a small web server on one machine, with every other screen joining over
the network in a browser. Check-in stations, on-deck displays for the car
wranglers, slideshows and an awards display all come from the same server. It
has been developed in the open since July 2015.

Installing it means unzipping a folder containing a bundled Apache and PHP, then
starting that server — a couple of steps more than a double-click, though the
Windows download does come with everything included and will run from a flash
drive.

**Trusty Track owes DerbyNet a direct debt.** Seven of our eight timer profiles
are adapted from DerbyNet's protocol notes, under its MIT licence and with
attribution in the source. Their work is why a pack with an unusual timer has any
chance with us at all.

### Derby Magic Race Manager

From The Derby Magic Company, who also sell tracks and timers. Windows only,
with a wizard that walks you through each step. The obvious choice if you bought
your track from them and want one phone number for the whole setup.

### Derby Day!

Free, deliberately small, and built around one race format: ladderless
elimination, where cars accumulate points and the last one standing wins. Up to
fifteen racers. If that is your pack's format and size, its simplicity is a
feature rather than a limitation.

## Where Trusty Track is weakest

Worth saying plainly, because a comparison page written by an author about their
own project is not a neutral document.

**It is new.** Seven months of public history against DerbyNet's eleven years and
GrandPrix Race Manager's twenty-six versions. Those programs have met race-day
problems nobody has thought of yet here.

**Most of its timer profiles are unproven.** Only the models marked *Tested* on
[trusty-track.com](https://trusty-track.com/#timers) have been checked against
recordings of real device output. The rest are built from DerbyNet's written
notes and have never met their hardware. See
[Hardware Timer](hardware-timer.md) for what that means in practice, and for the
bench test that turns an untested timer into a tested one.

**There is no support desk.** There is a GitHub issue tracker, read by one
person who has a day job. A paid program answering the phone on a Saturday
morning is a real thing to be buying.

**Nobody has independently reviewed it.** Everything on this page about Trusty
Track is the author's own account.

## Where it is genuinely different

**One application, no configuration.** Install it and open it. There is no web
server to start, no database to create, no PHP.

**Every screen is a browser.** The operator drives from a laptop, the check-in
desk uses a tablet, and the projector is another browser tab — all reading the
same event over the venue's own network. The operator can also
[assign what each screen shows](observation-displays.md) without leaving their
seat.

**It expects the day to go wrong.** A racer arriving after the round has
started, a lane whose sensor has died mid-event, a car withdrawn between rounds,
a time entered wrong and corrected later — each has a defined behaviour rather
than being something to work around. [Mid-race changes](reference/mid-race-changes.md)
sets out what happens in each case.

**Nothing leaves the building.** No accounts, no cloud service, no internet on
race day. Children's names and photographs stay in a file on your own machine.

**The rules are written down.** Every scoring, advancement and award rule is in
[Reference](reference/index.md) in full, because a parent asking "how did my kid
come fourth?" deserves an answer you can point at.

## Sources

- GrandPrix Race Manager — [product page](https://www.grandprix-software-central.com/gprm/)
  and [shop](https://grandprix-software-central.com/index.php/shopping/category/70-grandprix-race-manager)
- DerbyNet — [derbynet.org](https://derbynet.org/) and
  [the source repository](https://github.com/jeffpiazza/derbynet)
- Derby Magic — [race management](https://derbymagic.com/race-management/) and
  [pricing](https://derbymagic.com/pricing-guide/)
- Derby Day! — [derbydaysoftware.com](http://www.derbydaysoftware.com/)

*Pinewood Derby is a registered trademark of the Boy Scouts of America. Awana
Grand Prix is a registered trademark of Awana Clubs International. Other names
belong to their owners. Trusty Track is not affiliated with any of them.*
