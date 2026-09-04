"""races.qr_headline, races.qr_wifi_note (#614)

Two nullable text columns for the full-screen `QRCODE` audience display
view: a custom call-to-action headline ("Scan to Vote for Best in Show!")
and an optional venue Wi-Fi guidance line, both shown under the code.

Null (every race created before this column existed) means no override —
`qr_headline` falls back to a default derived from what the code points at,
and `qr_wifi_note` shows nothing, which is most venues.

Revision ID: 0047_race_qr_display
Revises: 0046_track_lane_colors
Create Date: 2026-09-04

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0047_race_qr_display"
down_revision: str | Sequence[str] | None = "0046_track_lane_colors"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("races", schema=None) as batch_op:
        batch_op.add_column(sa.Column("qr_headline", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("qr_wifi_note", sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("races", schema=None) as batch_op:
        batch_op.drop_column("qr_wifi_note")
        batch_op.drop_column("qr_headline")
