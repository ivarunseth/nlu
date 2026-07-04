"""add api_key to instances

Revision ID: ebb6d0b28ac7
Revises: d62d61f7a8f0
Create Date: 2026-07-04 16:05:34.250850

"""
import secrets

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'ebb6d0b28ac7'
down_revision = 'd62d61f7a8f0'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('instances', schema=None) as batch_op:
        batch_op.add_column(sa.Column('api_key', sa.String(length=64), nullable=True))
        batch_op.create_unique_constraint(batch_op.f('uq_instances_api_key'), ['api_key'])

    # Backfill existing deployments with unique keys.
    connection = op.get_bind()
    instances = sa.table('instances', sa.column('id', sa.Integer), sa.column('api_key', sa.String))
    for (instance_id,) in connection.execute(sa.select(instances.c.id)):
        connection.execute(
            instances.update()
            .where(instances.c.id == instance_id)
            .values(api_key=secrets.token_urlsafe(32))
        )


def downgrade():
    with op.batch_alter_table('instances', schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f('uq_instances_api_key'), type_='unique')
        batch_op.drop_column('api_key')
