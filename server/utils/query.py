"""
Shared query-string helpers for the paginated collection endpoints.

The list views all page server-side, so sorting and filtering have to happen
in SQL — narrowing or reordering only the current page would answer a
different question than the one the UI asks. These helpers keep that
consistent: a whitelist per endpoint says what may be sorted on, anything
outside it is a 400 rather than a silently ignored parameter.

Timestamp columns are epoch seconds (see ``utils.common.timestamp``), so the
date-window filters convert ``YYYY-MM-DD`` bounds into integers here.
"""
import datetime

from flask import abort, request


def apply_sort(query, columns, default, secondary=None):
    """
    Order ``query`` by the request's ``sort``/``order`` arguments.

    ``columns`` maps each accepted public field name to its column
    expression; ``default`` is the ``(field, order)`` pair used when the
    request asks for nothing. ``secondary`` is appended as a tiebreaker so
    pagination stays stable when the sorted column holds duplicates —
    without it, rows can repeat or vanish across pages.
    """
    field, order = default
    field = request.args.get('sort', field, type=str)
    order = request.args.get('order', order, type=str).lower()

    if field not in columns:
        abort(400, 'Cannot sort by %s. Allowed: %s'
              % (field, ', '.join(sorted(columns))))
    if order not in ('asc', 'desc'):
        abort(400, 'Invalid sort order: %s. Allowed: asc, desc' % order)

    column = columns[field]
    query = query.order_by(column.asc() if order == 'asc' else column.desc())
    return query.order_by(secondary) if secondary is not None else query


def sort_arguments(default):
    """
    The validated ``(field, order)`` pair for endpoints that sort outside
    SQL. Mirrors ``apply_sort``'s parsing without touching a query.
    """
    field, order = default
    field = request.args.get('sort', field, type=str)
    order = request.args.get('order', order, type=str).lower()
    if order not in ('asc', 'desc'):
        abort(400, 'Invalid sort order: %s. Allowed: asc, desc' % order)
    return field, order


def apply_date_range(query, column, prefix='created'):
    """
    Narrow ``query`` to rows whose ``column`` falls inside the request's
    ``<prefix>_from``/``<prefix>_to`` window. Both bounds are inclusive
    ``YYYY-MM-DD`` dates and ``_to`` covers the whole of its day, so a
    single-day window is expressed by passing the same date twice.
    """
    start = to_epoch(request.args.get('%s_from' % prefix))
    if start is not None:
        query = query.filter(column >= start)
    end = to_epoch(request.args.get('%s_to' % prefix), end_of_day=True)
    if end is not None:
        query = query.filter(column <= end)
    return query


def to_epoch(value, end_of_day=False):
    """Parse an inclusive ``YYYY-MM-DD`` bound into epoch seconds."""
    if not value:
        return None
    try:
        day = datetime.datetime.strptime(value, '%Y-%m-%d')
    except ValueError:
        abort(400, 'Invalid date: %s. Expected YYYY-MM-DD' % value)
    if end_of_day:
        day = day.replace(hour=23, minute=59, second=59)
    return int(day.timestamp())


def list_argument(name, allowed=None):
    """
    A repeatable filter argument as a list, accepting both ``?k=a&k=b`` and
    ``?k=a,b``. Validates against ``allowed`` when given so a typo fails
    loudly instead of quietly matching nothing.
    """
    values = []
    for raw in request.args.getlist(name):
        values.extend(part for part in (item.strip() for item in raw.split(',')) if part)
    if allowed is not None:
        for value in values:
            if value not in allowed:
                abort(400, 'Invalid %s: %s. Allowed: %s'
                      % (name, value, ', '.join(sorted(allowed))))
    return values


def sort_position(value, order):
    """
    A sort key for Python-side ordering that keeps missing values last in
    both directions, rather than letting ``None`` sort as smallest.
    """
    missing = value is None
    if order == 'desc':
        # `sorted(reverse=True)` would flip the missing-last flag too, so
        # the comparison runs ascending on a negated value instead.
        return (missing, _negate(value))
    return (missing, value if not missing else 0)


def _negate(value):
    if value is None:
        return 0
    if isinstance(value, str):
        # Strings cannot be negated; invert the comparison by mapping each
        # character to its complement within the codepoint space.
        return [-ord(character) for character in value]
    return -value
