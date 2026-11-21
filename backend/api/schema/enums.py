import enum

import strawberry

from backend.api import auth
from backend.domain import audit
from backend.domain import displays as domain_displays
from backend.domain import heat_session as domain_heat_session
from backend.domain import scenes as domain_scenes

#: The caller's own role (#15), published so the UI can reflect what it may
#: do rather than every screen offering every control to every role and
#: discovering the boundary from a refused mutation (#892). Wrapped the same
#: way `HeatPhase`/`DisplayViewEnum` below wrap their own domain enums —
#: `auth.py` stays the one place the three values are spelled, and `POLICY`
#: is still the one place a mutation is actually classified. A screen
#: reading this is deciding what to *show*; it is never what decides what is
#: *allowed* — that is `RolePolicyExtension` alone, and always will be, so a
#: UI that drifts from this value fails safe into the humane refusal message
#: rather than into anything permitted.
RoleEnum = strawberry.enum(auth.Role, name="Role")


#: The domain's phase enum, published as-is. Wrapped from here rather than
#: decorated where it is defined, so `backend/domain` keeps importing no
#: Strawberry — and wrapped rather than re-declared, so there is one copy of the
#: vocabulary and a phase added there cannot be forgotten here.
HeatPhase = strawberry.enum(domain_heat_session.Phase, name="HeatPhase")


#: What an audience display is showing (#174). Wrapped for the same reason as
#: the phase above: one copy of the vocabulary, and a view added to the domain
#: cannot be forgotten here.
DisplayViewEnum = strawberry.enum(domain_displays.DisplayView, name="DisplayView")


#: How the `STANDINGS_ONLY` view gets through a list too long for one screen
#: (#663) — wrapped for the same reason as `DisplayViewEnum`.
ScrollBehaviorEnum = strawberry.enum(
    domain_displays.ScrollBehavior, name="ScrollBehavior"
)


#: Which page `QRCODE` points a phone at (#614) — wrapped for the same
#: reason as `DisplayViewEnum` above.
QRTargetEnum = strawberry.enum(domain_displays.QRTarget, name="QRTarget")


#: What kind of device a display is (#177 stage 1a) — wrapped for the same
#: reason as `DisplayViewEnum` above.
DisplayRoleEnum = strawberry.enum(domain_displays.DisplayRole, name="DisplayRole")


#: A built-in scene recipe's key (#613) — wrapped for the same reason as
#: `DisplayViewEnum` above.
ScenePresetEnum = strawberry.enum(domain_scenes.ScenePreset, name="ScenePreset")


#: One of the six subjects an activity-log entry can be about (#1253) —
#: wrapped for the same reason as `DisplayViewEnum` above: the vocabulary and
#: `ACTIONS_BY_CATEGORY` live once, in `domain/audit.py`, and the client
#: renders the chip row from the category the server hands back on each
#: entry rather than a second copy of the action lists.
AuditCategoryEnum = strawberry.enum(audit.AuditCategory, name="AuditCategory")


@strawberry.enum
class RaceChangeKind(enum.Enum):
    """What kind of change a ``RaceStateChangedEvent`` describes.

    Subscribers use this to decide whether they care. Editing a racer's name
    during check-in should not make the stats page re-query the race.
    """

    #: A heat's results were recorded, cleared, or edited. Carries ``heat``.
    HEAT_RESULT = "HEAT_RESULT"
    #: Fields changed on an existing racer — checked in, renamed, renumbered,
    #: photographed. Carries ``racer`` when a single one changed. Crucially this
    #: does *not* change which racers exist or which racing group they are in, so a
    #: normalized client cache can merge the payload without refetching a list.
    RACER = "RACER"
    #: Racers were added or removed, or moved between racing groups. ``Race.racers`` and
    #: ``RacingGroup.racers`` membership changed, which no payload can express — a
    #: client has to re-read the list.
    ROSTER = "ROSTER"
    #: Heats or rounds were created, regenerated, reordered, or deleted. The
    #: shape of the schedule changed, so a refetch is genuinely warranted.
    SCHEDULE = "SCHEDULE"
    #: Race-level settings changed — name, scoring strategy, trophies.
    RACE_SETTINGS = "RACE_SETTINGS"
    #: A break started, was extended, paused, resumed or ended (#592).
    #: Carries ``intermission``, the fully resolved current state — a
    #: subscriber applies it directly rather than re-querying `Race`.
    INTERMISSION = "INTERMISSION"
    #: Something changed that has not been classified yet. Treat as "refetch".
    OTHER = "OTHER"
