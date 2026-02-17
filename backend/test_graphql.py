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


def test_create_and_query_race(client):
    # 1. Create a group first
    group_resp = client.post("/groups/", json={"name": "GraphQL Group"})
    assert group_resp.status_code == 200
    group_id = group_resp.json()["id"]

    # 1.5 Create a track
    track_resp = client.post(
        "/tracks/", json={"name": "GraphQL Track", "lane_count": 4}
    )
    assert track_resp.status_code == 200
    track_id = track_resp.json()["id"]

    # 2. Create a race via GraphQL
    mutation = f"""
    mutation {{
        createRace(name: "GraphQL Race", groupId: {group_id}, trackId: {track_id}) {{
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
