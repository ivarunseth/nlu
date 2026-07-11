"""empty message

Revision ID: 699d482c1005
Revises: 9e9ec0673765
Create Date: 2026-06-04 00:07:40.600176

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '699d482c1005'
down_revision = '9e9ec0673765'
branch_labels = None
depends_on = None


def upgrade():
    # No-op: models.type is already added by the parent revision
    # 9e9ec0673765. This revision previously re-added the same column, which
    # crashed upgrades with "duplicate column name: type".
    pass


def downgrade():
    pass
