# Inline editing for the entity value catalogue

Date: 2026-07-29
Status: approved

## Problem

`EntityValues.jsx` (the Values table on an entity drill-in) currently edits a
value's name and its full synonym list through a shared modal: renaming opens
the modal with the value pre-filled, and synonyms are a single comma-separated
textarea that must be retyped in full to add or remove one term. That's slow
for the common case of fixing a typo or adding one synonym, and doesn't scale
well as a value accumulates synonyms.

## Design

### Value cell — inline edit

A small pencil icon in the Value cell toggles it into a `Form.Control`,
autofocus, save on blur or Enter, Escape cancels — the same interaction
`AnnotatedUtterance.jsx` already uses for editing utterance text. Saving calls
the existing `PUT /models/<modelId>/entities/<entityId>/values/<valueId>` with
`{ value }`. A duplicate or empty name comes back as a 400 and surfaces in the
component's existing top-of-page `alert` banner, same as every other error
path in this component.

### Synonyms cell — chips with remove, inline add

Replaces the static badge list with:

- Each synonym rendered as a badge with a small `×` (same remove-icon
  treatment as the annotation chips in `AnnotatedUtterance`). Clicking it
  removes that one synonym immediately.
- A compact `Form.Control size="sm"` plus a small "+" icon button appended
  inside the same `flex-wrap` group as the chips, so it flows after them and
  wraps to its own line on narrow viewports. Enter in the input also submits,
  so several synonyms can be added back-to-back without touching the mouse.
  The input clears after each successful add and stays focused.
- Both add and remove call the same `PUT .../values/<valueId>` endpoint with
  the full recomputed `synonyms` array (text strings) — `Value.from_dict`
  already replaces the synonym set wholesale, so no new backend endpoint is
  needed. A duplicate synonym comes back as a 400 and surfaces in the same
  `alert` banner; the input's text is preserved so the user can correct it.
- Each row tracks its own small pending flag while a synonym add/remove
  request is in flight, disabling that row's input/plus button and remove
  buttons so a slow request can't race a second click into an inconsistent
  local state.

**Responsiveness:** the chip container gets `max-height: 4.5rem` with
`overflow-y: auto` once its content overflows, so a value with many synonyms
scrolls within its own cell instead of stretching the row (and the table)
unboundedly. `flex-wrap` on the container already handles reflow at any
column width.

### Options column

Drops the "Edit" pencil button (editing now happens in-cell) and keeps only
Delete.

### Unchanged

The "Add value" button and its modal (value name + comma-separated synonyms
textarea) are untouched — this redesign only changes how an *existing* row is
edited. Creating a new value still goes through the modal as it does today.

## Data flow

No backend changes. All three interactions (rename, add synonym, remove
synonym) go through the existing `PUT /models/<modelId>/entities/<entityId>/values/<valueId>`
endpoint, sending only the field(s) that changed (`{ value }` or
`{ synonyms }`), and each refetches the value list on success the same way
the current modal-driven edit does.

## Out of scope

- Bulk/paste-many-synonyms-at-once entry (the create-value modal's textarea
  still covers that case for a brand-new value).
- Reordering synonyms.
- Editing a synonym's text in place (removing and re-adding covers typo
  fixes).
