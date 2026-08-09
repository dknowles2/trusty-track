# Getting Started Guide

Welcome to Trusty Track! This guide will walk you through the initial setup and help you create your first race event.

## 1. Welcome to Trusty Track

Trusty Track is designed to make running a Pinewood Derby race smooth and enjoyable for organizers, racers, and spectators alike. This application handles everything from racer check-in and automated scheduling to real-time race execution and audience leaderboards.

## 2. Opening the App

Trusty Track runs directly in your web browser. Once the software is started, you can access it by navigating to the URL provided by your administrator. On the machine running the software that is usually `https://localhost:8000` — the [installation guide](user/install.md) for your platform gives the exact address, which differs by a port number between installs.

Multiple volunteers can open the app on different devices simultaneously to handle different tasks, such as check-in or race monitoring.

![Trusty Track Home Screen](assets/screenshots/getting-started/01-home-page.png)

## 3. First-Time Setup: System Settings

The first time you launch Trusty Track, or when you need to adjust your organization's details, you'll use the **System Settings** page — headed **Initial Setup** until you have saved it once. You can access this at any time by clicking the **Settings** gear icon in the top right corner of the navigation bar.

### Organization Details

- **Organization Name**: The name of your Cub Scout Pack, school, or group (e.g., "Pack 123").

### Track Configuration

Trusty Track needs to know about your physical race track:

- **Track Name**: A descriptive name for the track.
- **Lanes**: How many lanes your track has (e.g., 4).
- **Length (Feet)**: The total length of the track in feet.
- **Timer Type**: Select the device connected to your track. Use **Fake Timer (Manual Control)** for testing or practicing without physical hardware.

If you run more than one track, **+ Add Another Track** adds another to the same form.

![System Settings Form](assets/screenshots/getting-started/02-system-settings.png)

Click **Save Settings** to apply your changes.

## 4. Creating Your First Race

Once your system settings are configured, you're ready to create a race event.

1. From the Home page, click the **+ Create New Race** button.
2. Fill in the **Create New Race Event** form:
   - **Event Name**: A name for your race (e.g., "2024 Pinewood Derby").
   - **Date & Time**: When the race will take place.
   - **Location**: Where the race is being held.
   - **Scoring**: **Timed** ranks racers on their average time; **Points** ranks them on their finishing places added up.
   - **Championship Trophies**: How many trophies the championship awards (3 by default).
   - **Check car weights at inspection**: On by default at 5.0 oz, the usual pack rule. Change the limit, or turn the check off entirely if your pack does not weigh cars.
   - **Track / Timer**: Select which track you'll be using for this event.
   - **Car Numbering**: Choose how car numbers should be assigned (Manual allows you to enter numbers during check-in).

![New Race Form](assets/screenshots/getting-started/03-new-race-form.png)

After clicking **Create Race**, you will be taken to the **Roster** page.

## 5. Following the Setup Checklist

A new race opens with a **Setting up this race** panel at the top of the Roster page, listing the four things that have to happen before you can run a heat:

1. **Set up dens**
2. **Add racers**
3. **Check in cars**
4. **Generate a schedule**

Each item ticks itself off as you do it — there is nothing to mark complete by hand — and the panel shows a button for whichever step you are on. Once all four are behind you it disappears, so it is only ever on screen while something is genuinely outstanding.

If your pack does not use dens, skip the first step: it counts as done as soon as you have racers.

## 6. Setting Up Dens

Before adding racers, you should define your racing groups, typically called "Dens" in Cub Scouting.

1. On the **Roster** page, click **⋯** at the top right of the roster and choose **Manage Dens**.
2. Click **+ Add New Den** and enter the name (e.g., "Lions", "Tigers").
3. Each den is offered a car number range to itself — 100–199 for the first den, 200–299 for the next. Change or clear those numbers if you number cars some other way.

![Den Management](assets/screenshots/getting-started/04-den-management.png)

With your dens configured, your race is ready for racer registration and check-in!

![Empty Race Details](assets/screenshots/getting-started/05-race-details-empty.png)
_A race with no racers yet. The setup checklist at the top is pointing at the next thing to do; it will remove itself once all four steps are done._

## What's Next?

Now that your race is set up, you can proceed to adding racers and managing the event:

- [Race Setup Guide](race-setup.md) — Adding racers and managing dens
- [Race Day Operations Guide](race-day.md) — Check-in and running the race
- [Observation & Audience Displays Guide](observation-displays.md) — Setting up kiosks and displays
