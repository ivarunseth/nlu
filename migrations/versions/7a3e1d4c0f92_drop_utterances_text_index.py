"""drop the btree index on utterances.text

Revision ID: 7a3e1d4c0f92
Revises: b81d47ac9e30
Create Date: 2026-09-18 10:00:00.000000

"""
from alembic import op


# revision identifiers, used by Alembic.
revision = '7a3e1d4c0f92'
down_revision = 'b81d47ac9e30'
branch_labels = None
depends_on = None


def upgrade():
    # A btree on the full text bought nothing — utterance search is
    # ILIKE '%q%', which it cannot serve — and it broke bulk imports:
    # Postgres caps btree entries at about a third of a page (2704 bytes),
    # so one long row (an IMDB review, say) failed the whole COPY with
    # "index row size … exceeds btree version 4 maximum".
    with op.batch_alter_table('utterances', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_utterances_text'))


def downgrade():
    with op.batch_alter_table('utterances', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_utterances_text'), ['text'], unique=False)
