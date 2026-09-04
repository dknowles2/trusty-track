"""The pure half of display scenes (#613): the four built-in presets and how
their roles are handed out across whichever displays are actually connected.

No database and no registry — `assignments_for_preset` takes the display
order as a plain list, which is what lets these run with no server at all.
"""

from backend.domain import scenes
from backend.domain.displays import DisplayView


class TestPresets:
    def test_every_preset_key_is_findable(self):
        for preset in scenes.PRESETS:
            assert scenes.preset_by_key(preset.key) is preset

    def test_an_unknown_key_is_absent_rather_than_raising(self):
        assert scenes.preset_by_key("NOT_A_PRESET") is None  # type: ignore[arg-type]

    def test_every_preset_has_at_least_one_role(self):
        for preset in scenes.PRESETS:
            assert len(preset.roles) >= 1

    def test_the_four_derbynet_defaults_exist(self):
        keys = {preset.key for preset in scenes.PRESETS}
        assert keys == {
            scenes.ScenePreset.CHECK_IN,
            scenes.ScenePreset.RACING,
            scenes.ScenePreset.INTERMISSION,
            scenes.ScenePreset.AWARDS,
        }


class TestAssignmentsForPreset:
    def test_no_displays_means_nothing_to_assign(self):
        preset = scenes.preset_by_key(scenes.ScenePreset.RACING)
        assert scenes.assignments_for_preset(preset, []) == []

    def test_each_display_gets_the_role_at_its_position(self):
        preset = scenes.preset_by_key(scenes.ScenePreset.RACING)
        assert len(preset.roles) == 3

        result = scenes.assignments_for_preset(preset, ["a", "b", "c"])

        assert [display_id for display_id, _ in result] == ["a", "b", "c"]
        assert [assignment.view for _, assignment in result] == [
            role.view for role in preset.roles
        ]

    def test_fewer_displays_than_roles_just_uses_the_first_roles(self):
        preset = scenes.preset_by_key(scenes.ScenePreset.RACING)

        result = scenes.assignments_for_preset(preset, ["only-one"])

        assert len(result) == 1
        assert result[0][1].view == preset.roles[0].view

    def test_more_displays_than_roles_repeats_the_last_role(self):
        # An operator running six screens through a three-role preset almost
        # certainly wants the spares showing the same thing as the third
        # screen, not left however they already were.
        preset = scenes.preset_by_key(scenes.ScenePreset.RACING)
        last_role = preset.roles[-1]

        result = scenes.assignments_for_preset(preset, ["a", "b", "c", "d", "e", "f"])

        assert len(result) == 6
        for _display_id, assignment in result[len(preset.roles) - 1 :]:
            assert assignment.view == last_role.view

    def test_intermission_puts_every_screen_on_the_same_view(self):
        # No "main" screen during a break — the room is looking at whichever
        # screen is nearest.
        preset = scenes.preset_by_key(scenes.ScenePreset.INTERMISSION)
        assert len(preset.roles) == 1

        result = scenes.assignments_for_preset(preset, ["a", "b", "c", "d"])

        assert all(assignment.view == DisplayView.SLIDESHOW for _, assignment in result)

    def test_check_in_and_awards_presets_use_their_named_primary_view(self):
        check_in = scenes.preset_by_key(scenes.ScenePreset.CHECK_IN)
        assert check_in.roles[0].view is DisplayView.CHECKIN

        awards = scenes.preset_by_key(scenes.ScenePreset.AWARDS)
        assert awards.roles[0].view is DisplayView.AWARDS
