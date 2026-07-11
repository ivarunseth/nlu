"""denormalize predictions onto model/environment/version

Prediction rows were attributed through ``instance_id``, but instances are
deleted and recreated on every republish (and deleted on unpublish or when
an environment is removed), and the ORM cascade wiped the telemetry with
them — the Analyse Production tab reset on every redeploy. Rows now carry
their model, environment and served version themselves, so history outlives
any deployment and only the TELEMETRY_RETENTION_DAYS sweep prunes it.

Existing rows are backfilled from their instance before ``instance_id`` is
dropped. Rows whose instance is already gone (bulk instance deletes bypassed
the cascade) stay unattributed and age out through the sweep as before.

Revision ID: d41b7c2e9f05
Revises: bc66d2653853
Create Date: 2026-07-10 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'd41b7c2e9f05'
down_revision = 'bc66d2653853'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('predictions', schema=None) as batch_op:
        batch_op.add_column(sa.Column('model_id', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('environment', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('version', sa.String(), nullable=True))

    op.get_bind().execute(sa.text('''
        UPDATE predictions SET
            model_id = (
                SELECT instances.model_id FROM instances
                WHERE instances.id = predictions.instance_id
            ),
            environment = (
                SELECT environments.name FROM instances
                JOIN environments ON environments.id = instances.environment_id
                WHERE instances.id = predictions.instance_id
            ),
            version = (
                SELECT CAST(trainings.version AS TEXT) FROM instances
                JOIN trainings ON trainings.id = instances.training_id
                WHERE instances.id = predictions.instance_id
            )
        WHERE instance_id IS NOT NULL
    '''))

    with op.batch_alter_table('predictions', schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f('fk_predictions_instance_id_instances'), type_='foreignkey')
        batch_op.create_foreign_key(batch_op.f('fk_predictions_model_id_models'), 'models', ['model_id'], ['id'])
        batch_op.drop_column('instance_id')
        batch_op.create_index('ix_predictions_scope', ['model_id', 'environment', 'created_at'], unique=False)


def downgrade():
    with op.batch_alter_table('predictions', schema=None) as batch_op:
        batch_op.drop_index('ix_predictions_scope')
        batch_op.add_column(sa.Column('instance_id', sa.Integer(), nullable=True))
        batch_op.drop_constraint(batch_op.f('fk_predictions_model_id_models'), type_='foreignkey')
        batch_op.create_foreign_key(batch_op.f('fk_predictions_instance_id_instances'), 'instances', ['instance_id'], ['id'])

    # Best-effort: reattach rows to whichever instance currently serves their
    # model in their environment; rows for retired deployments stay orphaned.
    op.get_bind().execute(sa.text('''
        UPDATE predictions SET instance_id = (
            SELECT instances.id FROM instances
            JOIN environments ON environments.id = instances.environment_id
            WHERE instances.model_id = predictions.model_id
              AND environments.name = predictions.environment
        )
    '''))

    with op.batch_alter_table('predictions', schema=None) as batch_op:
        batch_op.drop_column('version')
        batch_op.drop_column('environment')
        batch_op.drop_column('model_id')
