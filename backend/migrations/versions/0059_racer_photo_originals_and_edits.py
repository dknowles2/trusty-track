"""Racer photo originals and edits (#1241).

Cropping used to be destructive: once a racer or car photo was cropped, the
pixels outside the crop box were gone, so a tight first crop could never be
loosened. Four nullable columns give a photo a memory of where it came from:

- ``racer_image_original_url``/``car_image_original_url`` — the photo
  ``racer_image_url``/``car_image_url`` was cropped from, same shape as that
  existing pair. Null means no original is on file, which is every racer
  before this migration; they behave exactly as before — Rotate / Recrop
  reopens on the current (only) image with a fresh centred crop.
- ``racer_image_edit``/``car_image_edit`` — JSON the server never
  interprets, ``{"rotation": 0|90|180|270, "crop": {"x", "y", "width",
  "height"}}``, the crop expressed in the *rotated* image's own pixel
  space — exactly the state ``ImageCropModal`` already holds, so reseeding
  it from a stored edit needs no coordinate conversion.

The downgrade drops all four columns outright. Any crop history an operator
has built up by the time somebody rolls back is lost — the same trade every
other purely additive, nullable column in this history takes (``home_unit``,
the terminology overrides): there is nowhere else for the value to go once
the column is gone, and refusing the downgrade over data nothing else in the
schema depends on would be worse than losing it. The derived images
themselves (``racer_image_url``/``car_image_url``) are untouched either way.

Revision ID: 0059_racer_photo_originals_and_edits
Revises: 0058_intermission_highlights
Create Date: 2026-09-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0059_racer_photo_originals_and_edits"
down_revision: str | Sequence[str] | None = "0058_intermission_highlights"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the four nullable columns. Nothing to backfill."""
    with op.batch_alter_table("racers", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("racer_image_original_url", sa.String(), nullable=True)
        )
        batch_op.add_column(
            sa.Column("car_image_original_url", sa.String(), nullable=True)
        )
        batch_op.add_column(sa.Column("racer_image_edit", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("car_image_edit", sa.Text(), nullable=True))


def downgrade() -> None:
    """Drop all four columns. Any crop history on file is lost with them."""
    with op.batch_alter_table("racers", schema=None) as batch_op:
        batch_op.drop_column("car_image_edit")
        batch_op.drop_column("racer_image_edit")
        batch_op.drop_column("car_image_original_url")
        batch_op.drop_column("racer_image_original_url")
