# Getting Started Guide

Welcome to Trusty Track! This guide will walk you through the initial setup and help you create your first race event.

## 1. Welcome to Trusty Track

Trusty Track is designed to make running a Pinewood Derby race smooth and enjoyable for organizers, racers, and spectators alike. This application handles everything from racer check-in and automated scheduling to real-time race execution and audience leaderboards.

This guide is written for a Cub Scout pack, since that is who most people
installing it are — but nothing about the app requires one. A school, a
club, or anyone running the same kind of race day can rename "Den" and
"Pack" to their own words; see [the words on screen](reference/race-settings.md#the-words-on-screen).

## 2. Opening the App

Trusty Track runs in your web browser. Once it is started, open it by typing its address into the browser — ask whoever set it up, or, on the machine running Trusty Track itself, it is usually `https://localhost:8000`. The [installation guide](user/install.md) for your platform gives the exact address, which differs a little between install methods.

Multiple volunteers can open the app on different devices simultaneously to handle different tasks, such as check-in or race monitoring.

![Trusty Track Home Screen](assets/screenshots/getting-started/01-home-page.png)
_The Home page before any races exist. **Try a practice race** builds a whole rehearsal on a fake timer; see [below](#4-trying-a-practice-race-first)._

## 3. First-Time Setup: System Settings

The first time you launch Trusty Track, or when you need to adjust your organization's details, you'll use the **System Settings** page — headed **Initial Setup** until you have saved it once. You can access this at any time by clicking the **Settings** gear icon in the top right corner of the navigation bar.

The first time, everything below is on one page, in order — fill it in from top
to bottom. Afterwards the page splits into sections listed down the left —
**General**, **Appearance**, **Access**, **Tracks** and **Backup** — and shows one at a time.
**Save Settings** saves the lot, whichever section you are looking at.

### Organization Details

- **Organization Name**: The name of your Cub Scout Pack, school, or group (e.g., "Pack 123").
- **Debugging Mode**: Off by default. Turning it on shows extra timer controls and logs during races — leave it off unless you're troubleshooting.

### Appearance

Every picker here already defaults to the app's usual look and to matching
your own screen, so this section is entirely safe to skip on a first run —
come back to it later if you want the wall display to look different for an
evening race, a patriotic-themed derby, or a print run that needs to save
ink. See [Themes](reference/themes.md) for the full list.

### Access

Next comes a security decision, and it's fine to skip it for a kitchen-table first run: by default there's no PIN, so anyone who can reach the app on your network can change anything — including deleting the race mid-event. Setting an **Operator PIN** locks that down; an optional **Check-in PIN** limits a registration-desk device to adding and checking in racers. Both can be added later before race day. See [Access and Your Network](access-and-network.md) for what each PIN protects and how to set one.

### Setting Up Your Track

Trusty Track needs to know about your physical race track:

- **Track Name**: A descriptive name for the track.
- **Lanes**: How many lanes your track has (e.g., 4).
- **Length (Feet)**: The total length of the track in feet.
- **Timer Type**: Select the device connected to your track. Use **Fake Timer (Manual Control)** for testing or practicing without physical hardware, or **No timer — I'll enter results by hand** if your pack genuinely has no electronic timer. If you have an electronic finish line, the [Hardware Timer guide](hardware-timer.md) covers plugging it in and checking it works — worth doing the week before, not on race morning.

If you run more than one track, **+ Add Another Track** adds another to the same form.

![System Settings Form](assets/screenshots/getting-started/02-system-settings.png)

Click **Save Settings** to apply your changes.

## 4. Trying a Practice Race First

Before your first real event, **Try a practice race** on the Home page builds a
whole rehearsal in one click: a dozen racers with photographs, sorted into
dens, all checked in, a qualifying round and a final — on a fake timer, so no
hardware is involved. It drops you straight onto Race Control with the first
heat ready to start.

Run a few heats, watch the standings move, let the final fill from the
placings, and put a screen on the [audience display](observation-displays.md).
Nothing here touches your real event.

When you are done, open the practice race and delete it like any other race.

> [!TIP]
> The night before is the time for this. It takes a couple of minutes and it is
> the difference between meeting the race control screen at a kitchen table and
> meeting it with sixty children waiting.

## 5. Creating Your First Race

Once your system settings are configured, you're ready to create a race event.

1. From the Home page, click the **+ Create New Race** button.
2. Fill in the **Create New Race Event** form:
   - **Event Name**: A name for your race (e.g., "2024 Pinewood Derby").
   - **Date & Time**: When the race will take place.
   - **Location**: Where the race is being held.
   - **Scoring**: **Timed** ranks racers on their average time; **Points** ranks them on their finishing places added up. See [Scoring & Championships](scoring-and-championships.md) for what each means on race day.
   - **Championship Trophies**: How many trophies the championship awards (3 by default).
   - **Check car weights at inspection**: On by default at 5.0 oz, the usual pack rule. Change the limit, or turn the check off entirely if your pack does not weigh cars.
   - **Track / Timer**: Select which track you'll be using for this event.
   - **Car Numbering**: Choose how car numbers should be assigned (Manual allows you to enter numbers during check-in).

   Every field is explained in
   [Race and track settings](reference/race-settings.md).

![New Race Form](assets/screenshots/getting-started/03-new-race-form.png)

After clicking **Create Race**, you will be taken to the **Roster** page.

## 6. Following the Setup Checklist

A new race opens with a **Setting up this race** panel at the top of the Roster page, listing the four things that have to happen before you can run a heat:

1. **Set up dens**
2. **Add racers**
3. **Check in cars**
4. **Generate a schedule**

Each item ticks itself off as you do it — there is nothing to mark complete by hand — and the panel shows a button for whichever step you are on. Once all four are behind you it disappears, so it is only ever on screen while something is genuinely outstanding.

If your pack does not use dens, skip the first step: it counts as done as soon as you have racers.

## 7. Setting Up Dens

Before adding racers, you should define your racing groups, typically called "Dens" in Cub Scouting.

1. On the **Roster** page, click **⋯** at the top right of the roster and choose **Manage Dens**.
2. Click **+ Add New Den** and enter the name (e.g., "Lions", "Tigers").
3. Each den is offered a car number range to itself — 100–199 for the first den, 200–299 for the next. Change or clear those numbers if you number cars some other way.

![The racing group manager, listing each group with its colour and car number range](assets/screenshots/getting-started/04-racing-group-management.png)

With your dens configured, your race is ready for racer registration and check-in!

![Empty Race Details](assets/screenshots/getting-started/05-race-details-empty.png)
_A race with no racers yet. The setup checklist at the top is pointing at the next thing to do; it will remove itself once all four steps are done._

## What's Next?

Now that your race is set up, you can proceed to adding racers and managing the event:

- [Race Setup Guide](race-setup.md) — Adding racers and managing dens
- [Race Day Operations Guide](race-day.md) — Check-in and running the race
- [Observation & Audience Displays Guide](observation-displays.md) — Setting up kiosks and displays
