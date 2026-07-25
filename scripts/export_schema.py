#!/usr/bin/env python
"""Export the GraphQL SDL so the frontend can generate types from it.

Writes `frontend/schema.graphql`, which graphql-codegen consumes. Run this
after changing anything in `backend/api/schema.py`:

    uv run python scripts/export_schema.py
    cd frontend && npm run codegen

`npm run codegen` does both steps for you. CI regenerates and fails if the
checked-in output is stale, so the schema and the frontend types cannot drift.

Using a script rather than `strawberry export-schema` avoids pulling in the
`strawberry-graphql[cli]` extra (typer et al.) for a two-line job.
"""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from backend.api.schema import schema  # noqa: E402

OUTPUT = REPO_ROOT / "frontend" / "schema.graphql"


def main() -> None:
    sdl = schema.as_str()
    if not sdl.endswith("\n"):
        sdl += "\n"
    OUTPUT.write_text(sdl)
    print(f"Wrote {len(sdl.splitlines())} lines of SDL to {OUTPUT}")


if __name__ == "__main__":
    main()
