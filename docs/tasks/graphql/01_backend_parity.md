# Task 1: Backend Parity [COMPLETED]

## Goal

Update `backend/graphql.py` to match the capabilities of the REST API in `backend/main.py`. This is critical for the frontend migration.

## Steps

1.  **Define Missing Types**
    - `Round`: Add `Round` type with fields matching `models.Round`.
    - `Heat`: Add `Heat` type. Note `lane_results` is JSON string, maybe parse it or keep as string for now.
    - `AdvancementStatus`: Add type for advancement status response.

2.  **Implement Mutations**
    - **Racer**:
      - `create_racer(first_name, last_name, car_number, den_id, race_id, ...)`
      - `update_racer(id, ...)`
      - `delete_racer(id)`
      - `check_in_racer(id, car_passed_inspection, car_weight)`
    - **Den**:
      - `create_den(name, color, race_id)`
      - `update_den(id, ...)`
      - `delete_den(id)`
    - **Track**:
      - `create_track(...)`
      - `update_track(...)`
      - `delete_track(...)`
    - **Round / Schedule**:
      - `create_round_wizard(race_id, config)`: Replicate logic from `create_race_wizard` in `main.py`.
      - `regenerate_round(round_id)`
      - `delete_round(round_id)`
      - `advance_round(race_id, round_id)`
    - **Heats**:
      - `update_heat_result(heat_id, results)`: Parse JSON results.
    - **Bulk Actions**:
      - `bulk_auto_number(racer_ids)`
      - `bulk_clear_numbers(racer_ids)`
      - `bulk_move_to_den(racer_ids, den_id)`
      - `bulk_delete_racers(racer_ids)`

3.  **Update Schema**
    - Register all new mutations in the root `Mutation` type.

## Verification

- Create `backend/test_graphql_mutations.py` to test each new mutation.
- **Run Tests**: Run `pytest backend/` and ensure all tests pass (both existing and new).
