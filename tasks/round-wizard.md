# Round Creation Wizard

To ease the creation of initializing rounds, we provide the user a simplified flow for creating the rounds for an entire race day.

## Flow

The user starts the "Round Creation Wizard" and is provided a dialog to help them through the process. It asks a few simple questions and then analyzes the Racer Roster to determine the best way to schedule the races.

At the top of the dialog, we have a sticky bar that shows the current estimated race duration. This estimate should be dynamically updated based on user selections.

### General Rounds

The user is first prompted for the creation of the first set of rounds that we call the "General Rounds". These schedule either the entire pack as one big race group (a singluar "General Round"), or rounds for each den (the plural "General Rounds").

The user must answer the following questions:

- Do you want to race as a PACK or DEN? (Radio button)
  - PACK racing will create one big round of racing. The name of the round will default to "All Pack".
  - DEN racing will schedule a round per den. Each round will be named after the den name.

- Runs per lane [input integer]
  - This specifies how many times each racer should race in each lane.

Changing the "Runs per lane" should update a time estimate for the general round.

The user then clicks the "Next" button to start configuring "Championship Rounds".

### Championship Round(s)

In this phase, we are scheduling races to determine the overall winner(s). The user is prompted to create a single Championship Round, but can then add additional rounds. (however each subsequent round must have less racers than the previous) The user provides the following information:

- Name of the round
  - Defaults to "Championship Round"

- If we scheduled Den racing, provide the option for picking the top N racers from [DEN | PACK]. Otherwise, simply ask for how many top racers to pick.

- Runs per lane [input integer]
  - This specifies how many times each racer should race in each lane for the championship races. We suggest only 1 for championship rounds.

The user should also have the option to add an additional Championship Round. For now, restrict to only 2 total championship rounds.

The user then clicks a "Preview Race" button that will generate the initial schedule. The user should be able to either modify the schedule manually, or go back to update parameters. Note that the championship rounds must have placeholder entries, because they require knowing the winners of the general rounds to schedule.

Once the user has confirmed this is correct, they click a "Create Rounds" button and we generate the schedule.
