"""add prediction logs

Revision ID: b3f1c07d92e4
Revises: e7a3d94f1c26
Create Date: 2026-07-07 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b3f1c07d92e4'
down_revision = 'e7a3d94f1c26'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'predictions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('model_id', sa.String(), nullable=True),
        sa.Column('environment', sa.String(), nullable=False),
        sa.Column('version', sa.String(), nullable=True),
        sa.Column('created_at', sa.Float(), nullable=False),
        sa.Column('latency', sa.Float(), nullable=True),
        sa.Column('cached', sa.Boolean(), nullable=True),
        sa.Column('error', sa.String(), nullable=True),
        sa.Column('label', sa.String(), nullable=True),
        sa.Column('score', sa.Float(), nullable=True),
        sa.Column('input', sa.JSON(), nullable=True),
        sa.Column('output', sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(['model_id'], ['models.id'], name=op.f('fk_predictions_model_id_models')),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_predictions'))
    )
    op.create_index('ix_predictions_scope', 'predictions',
                    ['model_id', 'environment', 'created_at'], unique=False)


def downgrade():
    op.drop_index('ix_predictions_scope', table_name='predictions')
    op.drop_table('predictions')
