"""retire the development inference environment

Revision ID: b81d47ac9e30
Revises: c74f6e25bd90
Create Date: 2026-08-30 11:20:04.118372

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b81d47ac9e30'
down_revision = 'c74f6e25bd90'
branch_labels = None
depends_on = None


ENVIRONMENT = 'development'


def upgrade():
    # `development` is gone from ALLOWED_ENVIRONMENTS; models are now validated
    # in `testing` before promotion to production. Environment.update() would
    # drop the row at the next startup, but only with Redis and Celery
    # reachable, and it never touches predictions — which denormalize the
    # environment name and would keep the retired one alive in Analyse. So the
    # rows go here, deterministically, in foreign-key order.
    #
    # This does not revoke Redis routes: a leftover serving worker has no queue
    # to be reached on any more, and its keys are namespaced under
    # `development:*` (see Registry._key). Sweep them with
    #   redis-cli --scan --pattern 'development:*' | xargs -r redis-cli del
    connection = op.get_bind()

    connection.execute(
        sa.text('DELETE FROM predictions WHERE environment = :name'),
        {'name': ENVIRONMENT},
    )
    connection.execute(
        sa.text(
            'DELETE FROM instances WHERE environment_id IN '
            '(SELECT id FROM environments WHERE name = :name)'
        ),
        {'name': ENVIRONMENT},
    )
    connection.execute(
        sa.text('DELETE FROM environments WHERE name = :name'),
        {'name': ENVIRONMENT},
    )


def downgrade():
    # Restores the environment row so a downgraded schema still matches an
    # ALLOWED_ENVIRONMENTS that names it (Environment.update() would otherwise
    # recreate it at startup anyway). The deleted deployments and predictions
    # are not recoverable.
    connection = op.get_bind()
    existing = connection.execute(
        sa.text('SELECT id FROM environments WHERE name = :name'),
        {'name': ENVIRONMENT},
    ).first()
    if existing is None:
        connection.execute(
            sa.text('INSERT INTO environments (name) VALUES (:name)'),
            {'name': ENVIRONMENT},
        )
