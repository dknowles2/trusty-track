# Themes

How the app, the wall display, and the printed pages look, and how to change
it. Set from **System Settings → Appearance** — for the walkthrough, see
[Getting Started](../getting-started.md#appearance).

## Three screens, three choices

Trusty Track has three surfaces, and each has its own theme:

| Surface | What it covers | Who picks it |
| --- | --- | --- |
| **App** | Your own screen — Race Control, the roster, this settings page | You, on this device |
| **Display** | The wall display and the projector | The operator, for every screen in the room |
| **Printables** | Pit passes, licences, heat sheets, certificates, results sheets | The operator, for every printer |

**App is per device.** It is a preference about the screen in front of you,
saved on this laptop or tablet only — it never touches another screen, and
it never touches a printed page. Two people running the same race can each
have their own laptop looking different.

**Display and Printables are per install**, the same as the rest of
System Settings. That is deliberate: the Displays panel already sends every
wall screen what to show from the operator's own list, and walking to each
screen to set a theme on it individually would defeat the point of that.
Every printer at the event prints the same look for the same reason — a
pack's check-in desk is often more than one laptop, and every pit pass
should look like the same event no matter which one printed it.

**"Match App theme."** The Display and Printables pickers offer this first,
selected by default. It does not copy your own screen's colours — Under the
Lights, for example, uses a mid-tone dark for your own screen and full
projector black for the Display, on purpose, since nobody reads fine print
off a wall from forty feet away. "Match App theme" means: whichever theme
the App picker is set to, use *that* theme's own Display (or Printables)
look. On a wall display or a printed page, which has no App picker of its
own, this resolves to Field Uniform — so an install that has never opened
this page looks exactly as it always has.

**Changing Display or Printables does not repaint a screen that is already
open.** A wall display or projector already running mid-event picks up a
new theme on its next reload or reconnect, not instantly — the same
simplicity as entering an operator PIN reloading the page. Pick a theme
before the race starts, not mid-ceremony.

## The seven themes

| Theme | Look | Best for |
| --- | --- | --- |
| **Field Uniform** | Scouting blue and gold — unchanged | The default. Nothing to decide |
| **Under the Lights** | A darker screen for your own laptop, plus the usual projector black | An evening race, or a gym with the lights dimmed once racing starts |
| **Old Glory** | Red, white, and blue | A patriotic-themed derby |
| **Clear Sight** | Bigger, bolder, higher-contrast | A venue with harsh light or a projector fighting daylight, or anyone who wants the screens easier to read |
| **Sawdust & Pine** | Warm, wood-toned | A banquet where the certificates get framed, or a keepsake feel over a spreadsheet one |
| **Trail Colors** | Green and trail-marker orange | A fun day, or a pack that finds navy-and-gold a little stiff for a Saturday morning |
| **Newsprint** | Black ink on white paper, almost nothing else | Tight print budgets — see [the printing note](#printing-and-ink) below |

Each theme also sets its own Display (wall/projector) and Printables
(paper) look — picking a theme on the App picker does not, by itself,
change what the wall or the printer show unless Display or Printables is
also set to it, or left on "Match App theme."

![The Appearance section with Old Glory selected for all three pickers](../assets/screenshots/settings/08-appearance-old-glory.png)
_A swatch for each theme, and a live preview of all three surfaces below
the pickers — nothing here is saved until **Save Settings** is clicked._

## Printing and ink

Most themes print the pit passes, licences, heat sheets and certificates
**as they appear on screen** — a coloured header band costs about the same
ink whichever theme it is.

Two themes are the exception:

- **Under the Lights** prints **lightened**. A dark screen and a dark
  projector do not argue for a dark pit pass — the paper stays light, with
  a cooler palette so it still reads as "the same event, at night."
- **Newsprint** prints in a **deliberately ink-minimal** way: one ink colour
  instead of two, a thin rule in place of a filled header band, and the
  decorative textures (the chequered band, the security wash, the
  certificate's background pattern) faded to a fraction of their usual
  weight. It is the theme to pick if a pack is printing sixty pit passes on
  a home inkjet that is already running low.

Every theme's printed pages stay legible photocopied in black and white,
and Clear Sight and Newsprint are the two built to survive that
specifically — neither leans on a shade of grey to carry meaning.

## What is not themed

- **Layout, spacing, and rounded corners never change.** A theme changes
  colour, weight, and decoration — never where anything sits on the page or
  how big it is.
- **Timer status colours, the error colour, and medal colours** (second and
  third place) stay the same in every theme — they carry a fixed meaning
  (armed, fault, second place) that a brand palette should not be free to
  recolour.
- **Only Trail Colors' hue changes; per-den colours are untouched.** Each
  den already has its own colour chip on the roster, independent of any
  theme, and no theme pulls den colours into more of the screen than that.
- **No custom or uploaded themes.** All seven are fixed, reviewed, and
  shipped with the app — there is no colour picker for building your own.

## Not every screen themes yet

Trusty Track's colours mostly come from a shared set of names ("the primary
colour," "the accent colour") rather than being typed out fresh on every
screen — that is what lets one theme choice reach the whole app. A number of
older screens still have a few colours written out by hand instead, and
those do not yet respond to a theme change. The screens that matter most for
telling one theme from another — the wall display, the printed pages, the
buttons and cards this page's own preview shows — do respond. If part of a
screen still looks like Field Uniform under a different theme, that is a
known gap being closed over time, not a bug in the pick.
