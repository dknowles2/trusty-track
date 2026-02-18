from backend import crud, schemas


def test_graphql_introspection(client):
    query = """
    query {
      __schema {
        types {
          name
        }
      }
    }
    """
    response = client.post("/graphql", json={"query": query})
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    assert "__schema" in data["data"]


def test_create_and_query_race(client, db):
    # 1. Create a group first
    group_in = schemas.GroupCreate(name="GraphQL Group")
    group = crud.create_group(db, group_in)
    group_id = group.id

    # 1.5 Create a track
    track_in = schemas.TrackCreate(name="GraphQL Track", lane_count=4)
    track = crud.create_track(db, track_in)
    track_id = track.id

    # 2. Create a race via GraphQL
    mutation = f"""
    mutation {{
        createRace(race: {{ name: "GraphQL Race", groupId: {group_id}, trackId: {track_id} }}) {{
            id
            name
            groupId
            trackId
        }}
    }}
    """
    response = client.post("/graphql", json={"query": mutation})
    assert response.status_code == 200, response.text
    data = response.json()
    assert "data" in data, data
    assert data["data"]["createRace"]["name"] == "GraphQL Race"
    race_id = data["data"]["createRace"]["id"]

    # 3. Query the race via GraphQL
    query = f"""
    query {{
        race(raceId: {race_id}) {{
            id
            name
            group {{
                name
            }}
        }}
    }}
    """
    response = client.post("/graphql", json={"query": query})
    assert response.status_code == 200
    data = response.json()
    assert data["data"]["race"]["name"] == "GraphQL Race"
    assert data["data"]["race"]["group"]["name"] == "GraphQL Group"
