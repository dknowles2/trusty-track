[x] FEAT: Replace ranks with dens. Allow the dens to be configurable. Each den should have a color and an optional rank.
[x] FEAT: With dens in place, we should add the option to group the roster by den.
[x] FEAT: Allow bulk-upload of racers via CSV.
[x] FEAT: Replace the "checked in" checkbox in the roster table with a simple indicator for whether the car has been checked in. A button should be added to the row to complete the check-in process. This should open a modal that allows the user to (optionally) enter the weight of the car and whether it passed inspection. This should also allow taking or uploading pictures of the racer and the car.
[ ] FEAT: Implement the "auto numbering" algorithms.
[ ] BUG: In the Race home page, update the "Race Settings" section to show the human-readable names of the configuration options instead of the enum values.
[ ] FEAT: Provide a way to search for a racer by name or car number. For usability, the search should be case-insensitive and search all searchable fields (name, car number, den, etc.)
[ ] BUG: Generating a race schedule should fail if there are not enough racers to create a valid schedule.
[ ] FEAT: Generate a view of the racing heats that resembles a tournament bracket.
[ ] FEAT: Generate a view that shows the current racers and the racers "on deck" for the next race.
[ ] FEAT: Update the "Race Control" page to have a few different modes:
  1.  Schedule generation and maintenance. This is essentially the current implementation.
  2.  Race execution. This mode should display the current heat, the racers in the heat, and the racers "on deck". It should provide an option for re-running the heat, overriding the timing results, and continuing to the next heat.
[ ] FEAT: We should improve the concepts of "Rounds" versus "Heats". A race consists of multiple rounds. Each round consists of multiple heats. Each round consists of a set number of racers, and the heats should be generated to fulfill the configured scheduling algorithm. Race control should have the ability to add additional rounds dynamically. But also when setting up a race initially, the type of round selection should be configurable, allowing for options such as "race entire roster together", "race per group", and "manual scheduling". We also need to configure the way we want champions to be selected. Should we use the standard "top 3 advance" algorithm, or should we use a different algorithm? Should we allow for manual selection of champions?
[ ] FEAT: When utilizing a fake timer, there should be a "mole" UI element that provides access to the fake timer controls.