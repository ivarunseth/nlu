"""widen instance api_key for jwt keys

Revision ID: c74f6e25bd90
Revises: 6c511e96f142
Create Date: 2026-07-17 19:15:25.512145

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c74f6e25bd90'
down_revision = '6c511e96f142'
branch_labels = None
depends_on = None


def upgrade():
    # API keys are now JWTs, which are much longer than the old opaque
    # secrets. (Autogenerate also proposed dropping Celery's result-backend
    # tables taskmeta/tasksetmeta — those are managed by Celery, not us,
    # and were removed from this migration.)
    with op.batch_alter_table('instances', schema=None) as batch_op:
        batch_op.alter_column('api_key',
               existing_type=sa.VARCHAR(length=64),
               type_=sa.String(length=512),
               existing_nullable=True)


def downgrade():
    with op.batch_alter_table('instances', schema=None) as batch_op:
        batch_op.alter_column('api_key',
               existing_type=sa.String(length=512),
               type_=sa.VARCHAR(length=64),
               existing_nullable=True)
