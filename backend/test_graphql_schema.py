"""Tests to validate the GraphQL schema contract."""

import pytest
from backend import schema

def test_populate_race_mutation_sdl():
    """Verify the populateRace mutation structure in the SDL."""
    sdl = str(schema.schema)
    
    # Check for populateRace mutation with its arguments
    # Strawberry converts snake_case to camelCase for the schema
    assert "populateRace(raceId: Int!, config: PopulateTestDataInput!): String!" in sdl
    
    # Check that it doesn't use 'input' for the config argument
    assert "populateRace(raceId: Int!, input:" not in sdl

def test_populate_test_data_input_sdl():
    """Verify PopulateTestDataInput structure in the SDL."""
    sdl = str(schema.schema)
    
    # Check for the input type definition
    # Strawberry converts fields to camelCase
    assert "input PopulateTestDataInput {" in sdl
    assert "count: Int!" in sdl
    assert "addRacerPhotos: Boolean!" in sdl
    assert "addCarPhotos: Boolean!" in sdl
    assert "assignDens: Boolean!" in sdl
    assert "checkIn: Boolean!" in sdl
