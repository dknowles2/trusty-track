import strawberry

from .award import AwardMutations
from .config import ConfigMutations, InitialConfigMutations, TimerResetMutations
from .display import DisplayMutations
from .importing import ImportMutations
from .race import RaceMutations, RaceSetupMutations
from .racer import PhotoUploadMutations, RacerBulkMutations, RacerMutations
from .round_heat import RoundHeatMutations, RoundScheduleMutations, TrackLaneMutations
from .timer import TimerMutations


@strawberry.type
class Mutation(
    RaceMutations,
    DisplayMutations,
    RacerMutations,
    TrackLaneMutations,
    AwardMutations,
    RoundHeatMutations,
    TimerMutations,
    RacerBulkMutations,
    InitialConfigMutations,
    TimerResetMutations,
    ConfigMutations,
    RaceSetupMutations,
    ImportMutations,
    RoundScheduleMutations,
    PhotoUploadMutations,
):
    """Root GraphQL Mutation type composed from domain mutation groups."""
