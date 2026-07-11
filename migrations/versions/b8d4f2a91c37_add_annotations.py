"""add annotations for named entity recognition

Adds the annotations table (labelled spans), colour and description on
labels (the entity registry), and model ownership on utterances. Existing
classification rows are untouched: their utterances keep label_id and the
new columns stay null.

Revision ID: b8d4f2a91c37
Revises: e7a3d94f1c26
Create Date: 2026-07-09 10:15:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b8d4f2a91c37'
down_revision = 'e7a3d94f1c26'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('annotations',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('utterance_id', sa.Integer(), nullable=False),
    sa.Column('label_id', sa.Integer(), nullable=False),
    sa.Column('start', sa.Integer(), nullable=False),
    sa.Column('end', sa.Integer(), nullable=False),
    sa.Column('value', sa.Text(), nullable=True),
    sa.Column('created_at', sa.Integer(), nullable=True),
    sa.ForeignKeyConstraint(['label_id'], ['labels.id'], name=op.f('fk_annotations_label_id_labels')),
    sa.ForeignKeyConstraint(['utterance_id'], ['utterances.id'], name=op.f('fk_annotations_utterance_id_utterances')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_annotations'))
    )
    with op.batch_alter_table('labels', schema=None) as batch_op:
        batch_op.add_column(sa.Column('color', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('description', sa.Text(), nullable=True))
    with op.batch_alter_table('utterances', schema=None) as batch_op:
        batch_op.add_column(sa.Column('model_id', sa.String(), nullable=True))
        batch_op.create_foreign_key(batch_op.f('fk_utterances_model_id_models'), 'models', ['model_id'], ['id'])


def downgrade():
    with op.batch_alter_table('utterances', schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f('fk_utterances_model_id_models'), type_='foreignkey')
        batch_op.drop_column('model_id')
    with op.batch_alter_table('labels', schema=None) as batch_op:
        batch_op.drop_column('description')
        batch_op.drop_column('color')
    op.drop_table('annotations')
