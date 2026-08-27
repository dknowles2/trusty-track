# Trusty Track - Design Specification

## Product Vision

**Trusty Track** is a race management system for Cub Scout Pinewood Derby events. It prioritizes ease of use for operators and clean aesthetics for participants who are experiencing the event through the application. On race day, we prioritize fairness and accuracy of the results while offering an easily customizable experience for adminstering the race, showing the status of the race, and tallying the final results. The race tracking itself is always as fair and accurate as possible.

## Basic Requirements

The application should be considered in multiple parts:

1. Core application logic. This is the "backend" of the application. It needs to be stable, cross-platform, and have clearly-defined APIs for interaction with various frontends. This part of the application is both the "data plane" and "control plane", handling both data storage (configuration data, racer information, etc), and core application logic (race scheduling, result coalescing, etc)

2. User Interfaces. These are the "frontends" of the application. We want these to be accessible across multiple device types: laptops, desktops, mobile phones, tablets, kiosks, and large-format displays.

3. Remote Proxies. In some cases it may be desirable to have the physical access to hardware such as timing devices separate from the backend application logic. For example, you may want to run the backend application "in the cloud" but then have physical access to a timing device on race-day. In this case, we want to provide various options: having a dedicated device proxying timing information (think: raspberry pi directly hooked up via serial to a timing device), or repurposing a frontend device to proxy information back to the backend (think: a local laptop computer playing "double-duty" as a serial interface *and* a race controller interface)

## User Journeys

Here we outline the core user journeys we can think of. These will likely evolve over time as we better understand the various ways that users want to interact with this software. These should not be considered exhaustive but instead a view into the primary way we think users would want to interact. In other words, while these are the primary journeys we are designing around, we do not want to limit users to only these strict journeys; instead we want to provide a "well-lit path" via these journeys, but allow "power users" more control via other means.

Core tenet: users should always be able to re-configure all options in an intuitive manner.

### Initial Configuration

After initial installation of the application, the user should be given the option to provide configuration options that should be relatively static.

Well-lit path: User installs the software and navigates to the main view of the application (http://<ip-address>:port/). This starts an iniital configuration flow that requests the following information:

- Name of the group that is racing
  - While we are catering primarily to Cub Scout packs, we should make this generic enough to work for other organizations
- Properties of the race track that is available
  - How many lanes?
  - What is the track length? (free-form numeric input, in feet)
  - What kind of timer is attached to the track?
    - We should provide a few options:
      - Fake timer (for testing purposes; make it clear that you can change this later)
      - Auto-detect, with two options:
        - Timer is connected to the backend
        - Timer is connected to the current device (the "proxy" option outlined above)
    - Implementation detail: out-of-the-box, we should support the devices that "DerbyTimer" (the java program from https://github.com/jeffpiazza/derbynet) supports. The DerbyNet timer protocol is documented in [The Timer Protocol for DerbyNet](derbynet-timer-protocol.md).


This initial setup specifies paramaters that we expect to not change in most cases. But we also want to allow modifying them in the future. Imagine that you buy an updated track, swap out the timer, or move to a new location where you want to utilize your existing software. These settings should be accessible later via a global settings such as "Global Settings", "System Settings", or similar option.

### Race Configuration

The next major journey is when you want to run a specific race. At this point you have already completed the "Initial Configuration", so you want to start setting up your group (again, probably "pack") race. For this, the user *must* go through an interactive interface and we do not allow configuring by configuration file.

Information needed:

- Race Name
  - Must be unique for the application. (Suggest to the user that this is the current year?)
- (optional) Date / time of the race
- (optional) Location of the race
- Racing Groups - These define the way you may later want to sub-divide racers. The default option is something like "All Racers" or "Pack" (for Cub Scouts), it's also useful to define these now so you can group racers and then later decide how you want to use the groups
  - If Cub Scouts, then each group is likely a "Den", and each "Den" should also be assigned a "rank" which can be used later for branding. One of: {"Lion", "Tiger", "Wolf", "Bear", "Webelos", "Arrow of Light"}
- Car numbering strategy:
  - Per-group - each group is assigned a sub-range (100-199, 200-299, etc)
    - With this option, the operator must next assign the sub-range to each group. We should auto-suggest something reasonable but allow them to change it.
  - Global - participants get a number increased globally (1, 2, 3, ...)
    - With this option, allow the operator to specify the starting number. Default to "1"
  - Manual - operators must assign car numbers manually

We should provide reasonable defaults for these options. We also need to allow the user to change these preferences later, with caveats:

- If the racing groups change, we need to allow the user to re-group the racers (or just remove all groupings with a warning to the user that this is happening)
- If the car numbering strategy changes, we need to let the user see and modify the proposed changes

### Racer Details

After a specific race has been initialized, we now need to know *who* is racing. The following details need to be collected:

  - First Name
  - Last Name
  - (optional) Racing Group (if configured in the previous step)
  - Car Number
    - Assigned based on the "Car numbering strategy" for the race. Shoud be auto-suggested but editable.
  - (optional) Car Name
    - We don't expect this to be known when initially configuring racer details, but we want to allow the option
  - (optinal) Racer Picture
    - Allow uploading a headshot of the racer. We should auto-crop this as appropriate.
  - (optional) Car Picture
    - Allow uploading a picture of the car itself.
  - Car Passed Inspection (bool)
    - Defaults to `false` when doing bulk or pre-race import. **Must** be toggled to `true` on race-day to be eligible to race.

We need to allow multiple modes of racer import:

1.  Bulk-import - Allow the user to upload a CSV of participants. We should suggest a suitable format that matches the required text fields, but also allow an arbitrary CSV to be uploaded and then allow the user to map the columns in the CSV to the specific fields we need to consume.
2.  Manual import - Allow the user to import racers individually  This could happen either before the race, or on race-day. In either case, the input form is likely very similar.

#### Printables

✅ *Implemented — see the [Printables guide](printables.md). Printed as HTML from
`/race/:raceId/print` rather than as server-rendered PDFs; only the QR code
comes from the backend.*

Once all racers are input into the system, we should also provide the option to physically print some documents:

-  Check-in barcode - a basic barcode or QR-Code that allows a check-in operator (see below) to scan the code and immediately be presented with the final check-in process for the racer.
-  Drivers License - A cute business-card sized printout about the participant that "allows" them to race.
-  Pit Pass - A printable that is suitable for hanging on a lanyard, containing the event name, date, time, location, participant name, and participant picture.

### Race Check-In

On "race day" (or sometimes before), operators need to verify which participants are eligible for racing. If the racers have been previously imported, this means verifying that each car is suitable for racing ("passed inspection") and then collecting any additional information (car name, racer picture, car picture). ✅ *Implemented via `CheckInModal` in `RaceDetails.tsx`.*

If "Printables" were previously utilized, we want a race "check-in" operator to be able to scan the barcode or QR-code to look up the participant. This should not require additional hardware--if using a laptop or physical computer, the attached USB camera should be able to convert a barcode into a participant record; if using a mobile phone or tablet, the onboard camera should be able to do the same. ✅ *Implemented via the **Scan** button on the roster. Decoding uses the browser's own `BarcodeDetector`, which is Chromium-only; other browsers get car-number entry, offered alongside the viewfinder everywhere.*

### Race Operation

When all participants have been checked in it's time to actually operate the race. We'll call the operator of this role "race control".

First, this operator needs to first determine a few things about the race:

1. How will the race progress?
  - Are heats being scheduled for each sub-group, or for the entire roster as a whole?

2. Do we want a championship runoff?
  - If racing in sub-groups, do you want to race the winner of each group?
  - If not racing in sub-groups, do you want to re-race the fastest N overall?

No we can schedule heats...

  - Output an initial "Race Schedule" - this should show the proposed heats as an ordered list of racers per heat
  - The operator is then provided two options:
    1. Start Racing
      - This officially schedules the proposed heats, and starts the race schedule
    2. Change Options
       - This brings the operator back to the start of "Race Control" or provides the option to "refresh racers"
       - Once options have been refreshed, we provide the same race preview again and repeat the process util the race is accepted.

### Race Observation

We want to allow various bystandards to view the state of the race. This list is not exhaustive, and the API we provide should allow easily extending this.

#### On Deck ✅

A simple view of what racers are next to race. Can utilize all the data previously collected.

#### Currently Racing ✅

The current racers. Let the user decide which pictures are shown (racer or car or both)

#### Timing Stats ✅

The exact timing of the last / current heat. Basic details about the racers or their cars.

#### Leaderboard ✅

The current standings according to racing rules.

#### Heats ✅

A view of who is expected to be racing, annotated with racer names & car names. Could include pictures if it makes sense in the visual representation.

## UI & Branding (Official BSA Guidelines)

  * **Primary Colors:**
    * **Scouting Blue:** `#003F87` (Headers, Nav, Primary Buttons)
    * **Cub Scouting Gold:** `#FCD116` (Check-In status, Call-to-Action)
  * **Typography:**
    * **Headers:** `Roboto Condensed Bold`
    * **Body:** `Roboto Regular`
  * **Design Elements:** Rounded corners (12px) and high-contrast "Projector Mode" race observation views.
