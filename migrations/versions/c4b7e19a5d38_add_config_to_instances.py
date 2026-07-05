"""add config to instances

Revision ID: c4b7e19a5d38
Revises: ebb6d0b28ac7
Create Date: 2026-07-04 18:12:07.418205

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c4b7e19a5d38'
down_revision = 'ebb6d0b28ac7'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('instances', schema=None) as batch_op:
        batch_op.add_column(sa.Column('config', sa.JSON(), nullable=True))


def downgrade():
    with op.batch_alter_table('instances', schema=None) as batch_op:
        batch_op.drop_column('config')
