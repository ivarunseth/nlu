"""require config on instances

Revision ID: e7a3d94f1c26
Revises: c4b7e19a5d38
Create Date: 2026-07-04 20:41:18.734512

"""
import json

from alembic import op
import sqlalchemy as sa

from flask import current_app


# revision identifiers, used by Alembic.
revision = 'e7a3d94f1c26'
down_revision = 'c4b7e19a5d38'
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    instances = sa.table(
        'instances',
        sa.column('id', sa.Integer),
        sa.column('environment_id', sa.Integer),
        sa.column('config', sa.JSON),
    )
    environments = sa.table(
        'environments',
        sa.column('id', sa.Integer),
        sa.column('name', sa.String),
    )

    config = current_app.config
    heartbeat_interval = config['INFERENCE_HEARTBEAT_INTERVAL']

    def default_config(environment):
        # Mirrors Instance.default_params(): development loads lazily.
        return {
            'lazy': environment == 'development',
            'cache': True,
            'top': 1,
            'timeout': config['INFERENCE_REQUEST_TIMEOUT'],
            'interval': config['INFERENCE_POLL_INTERVAL'],
            'batch_size': config['INFERENCE_BATCH_SIZE'],
            'sleep': config['INFERENCE_SLEEP'],
            'idle_timeout': config['INFERENCE_IDLE_TIMEOUT'],
            'heartbeat_interval': heartbeat_interval,
            'heartbeat_ttl': max(int(heartbeat_interval * 3), 1),
            'output_ttl': config['INFERENCE_OUTPUT_TTL'],
        }

    names = dict(connection.execute(sa.select(environments.c.id, environments.c.name)).fetchall())

    # Fill the environment's defaults in under whatever was configured, so
    # every instance carries a complete config.
    rows = connection.execute(
        sa.select(instances.c.id, instances.c.environment_id, instances.c.config)
    ).fetchall()
    for instance_id, environment_id, existing in rows:
        if isinstance(existing, (bytes, str)):
            existing = json.loads(existing) if existing else None
        connection.execute(
            instances.update()
            .where(instances.c.id == instance_id)
            .values(config={**default_config(names.get(environment_id)), **(existing or {})})
        )

    with op.batch_alter_table('instances', schema=None) as batch_op:
        batch_op.alter_column('config', existing_type=sa.JSON(), nullable=False)


def downgrade():
    with op.batch_alter_table('instances', schema=None) as batch_op:
        batch_op.alter_column('config', existing_type=sa.JSON(), nullable=True)
