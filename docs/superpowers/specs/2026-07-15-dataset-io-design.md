# Dataset import/export optimization — design

**Date:** 2026-07-15
**Status:** Approved design, pending implementation plan

## Problem

Dataset import and export currently materialize everything in memory and
insert one ORM object per row:

- `Model.read` / `Intent.read` — classification CSV/TSV import via pandas,
  one `db.session.add` per utterance.
- `Model.write` / `Intent.write` — classification CSV export built fully
  in-memory in a `BytesIO` via a pandas DataFrame.
- `Model.export_annotations` / `Model.import_annotations` — NER/NLU datasets
  (inline / json / csv), all rows loaded and serialized as one string.
- `Training.start` — `_utterances_csv` / `_classification_csv` build the whole
  training dataset in memory before `store.put`.

For large datasets this is slow and memory-bound. PostgreSQL's native `COPY`
can stream tabular data far faster on both directions.

## Decisions (from brainstorming)

1. **Postgres fast-path + fallback.** `COPY` via the psycopg2 cursor when
   `db.engine.dialect.name == 'postgresql'`; DB-agnostic streamed queries /
   batched inserts otherwise. Dev on SQLite keeps working.
2. **All four surfaces** route through the generalized methods.
3. **Stream to caller, store optional.** Export writes to a temp file; with an
   `object_name` it uploads via `store` and deletes the temp file, otherwise it
   returns an open (already-unlinked) handle for `send_file`.
4. **Keep the existing `read` / `write` method names** as the generalized
   surface — no new `import_data` / `export_data` names. The annotation
   methods and Training's private CSV builders fold into them.
5. **Primitives live in `server/utils/io.py`** (not under `server/database/`).
6. **Drop the per-span entity from the interchange.** `Utterance.nlu_spans` is
   removed; annotated import/export carries only `(start, end, name)` spans
   (the trained tag: slot for NLU, entity for NER) plus, for NLU, the record's
   intent. The `{slot@entity: value}` inline carrier, the JSON `entity` field,
   the CSV `# slots:` legend, and the dual `serialize_nlu_*` code paths all go
   away, unifying NER and NLU onto one path that differs only by the intent
   field. **`Slot.entity` stays in the DB** (training augmentation still needs
   it, via `slots.json` / `entities.json`); only the file interchange stops
   carrying it. On import, each slot resolves to a same-named entity
   (auto-created, `Slot.entity_id` is `NOT NULL`), so a slot→entity remapping
   is a UI-only operation and no longer round-trips through files. This is a
   scope addition from the original design: `server/utils/dataset.py` is now
   edited (simplified), not merely reused.

## Architecture

### `server/utils/io.py` — backend-aware streaming primitives

Two primitives, no Flask views or model imports (only `db`, `store`, config —
mirroring `server/utils/dataset.py`'s role):

- `stream_to_file(select, out_path, transform=None, header=None)`
  - **Postgres, no transform:** `cursor.copy_expert("COPY (<select>) TO STDOUT
    WITH (FORMAT csv, HEADER)", f)` on the session's raw DBAPI connection.
  - **Otherwise:** execute the select with `yield_per(DATASET_IO_BATCH_SIZE)`
    and write rows with `csv.writer` (or via `transform`, which maps a row
    batch to output lines — used by the annotated formats).
  - Constant memory in every mode.
- `bulk_insert(table, rows, returning=None)`
  - **Postgres, `returning is None`:** `COPY <table> (<cols>) FROM STDIN` fed
    from the accumulated batch (rows have no dependents, e.g. classification
    utterances).
  - **Otherwise:** SQLAlchemy 2.0 batched `insert()` (insertmanyvalues), with
    `.returning(<returning>)` when generated ids are needed (utterance ids for
    tags). `COPY FROM` cannot return ids, so batched inserts are the path
    wherever dependent rows follow — faster than per-object ORM adds and safe.
  - Always runs on the session's connection/transaction so a later `abort`
    rolls everything back.
- Shared temp-file helper: `tempfile.NamedTemporaryFile(delete=False)`;
  callers either upload + delete, or open-then-unlink and return the live
  handle (POSIX keeps it readable until closed — no leaked files on crash).

### `Model.write(fmt='csv', object_name=None)` — generalized export

Dispatch on `self.kind` + `fmt`:

- **Plain tabular** (classification `csv` / `tsv`): one SQL join
  (`utterances × intents` filtered by model) streamed by native `COPY TO`
  (fallback: chunked select). Replaces the pandas body of `Model.write`.
- **Annotated formats** (`inline` / `json` / `conll` / `csv` on NER/NLU):
  utterances streamed in batches (`yield_per`), each record formatted through
  the per-record functions in `server/utils/dataset.py` (the single source of
  truth for the markup) and written as it goes — no giant string. Spans come
  from `Utterance.spans` (`(start, end, name)`); NLU additionally prefixes /
  columns the utterance's intent. Replaces `export_annotations`.
- **`fmt='training'`**: the training dataset layout (`utterances` inline
  column, `labels` intent column when the kind carries intents; plain
  `utterances,labels` for classification). Replaces `Training._utterances_csv`
  and `_classification_csv`; `Training.start` calls
  `self.model.write(fmt='training', object_name=f'models/{self.path}/data/utterances.csv')`.
- **Destination:** `object_name` given → `store.put`, delete temp file, return
  the object path. Otherwise return the unlinked open handle; views pass it to
  `send_file` unchanged.

`Intent.write()` keeps its signature and delegates to the same primitives
scoped by `intent_id`.

### `Model.read(source, fmt=None, header=0)` — generalized import

`source` is a file-like upload or decoded string; `fmt` defaults from the
filename for csv/tsv and is required for annotated formats (views already
carry it).

- **Classification CSV/TSV:** parsed in chunks
  (`pandas.read_csv(chunksize=DATASET_IO_BATCH_SIZE)`); intents resolved /
  auto-created once and flushed for ids; utterance rows loaded via
  `bulk_insert` (native `COPY FROM` on Postgres — no dependent rows).
- **Annotated formats:** the parse → validate → resolve pipeline is kept
  intact as the safety layer, now over `(start, end, name)` spans (no carried
  entity). Only materialization changes: instead of per-object `session.add`,
  resolvers accumulate row dicts; utterances flush per batch via
  `bulk_insert(..., returning=Utterance.id)` and tags follow with the returned
  ids. Registry rows (intents / entities / slots) stay ORM — they are few and
  their validation lives there. NLU resolves each slot to a same-named entity
  (auto-created); the old "slot mapped to a different entity" conflict check
  goes away with the entity carrier.
- **Return value:** always the summary dict `{'imported', 'created',
  'errors'}` (the classification path gains it; today it returns nothing).

`Intent.read()` keeps its signature and uses the same chunked parse +
`bulk_insert`.

### Removals and call sites

- Removed: `Model.export_annotations`, `Model.import_annotations`,
  `Training._utterances_csv`, `Training._classification_csv`,
  `Utterance.nlu_spans`. `Training._put_data` stays — it still uploads the
  `entities.json` / `slots.json` sidecar files (which are training inputs, not
  dataset exports, and still carry the slot→entity map for augmentation).
- Simplified in `server/utils/dataset.py`: drop the per-span entity from every
  format (`format_inline_nlu`, `parse_inline_record`, `format_json_nlu`,
  `parse_json_record`, `serialize_nlu_csv`, `_parse_csv_dataset`,
  `_parse_conll_dataset`) so `parse_dataset` yields `(start, end, name)` spans;
  remove `format_slot_legend` / `parse_slot_legend` (dead once the legend is
  gone).
- Updated callers: `server/views/api/models.py`, `server/views/api/intents.py`,
  `server/views/api/tags.py`, `Training.start`.
- New config: `DATASET_IO_BATCH_SIZE` (default 5000) in `server/config.py`,
  read via the `Config` classes per repo convention.

## Error handling

- Import batches run inside the request's session transaction; any
  `flask.abort` mid-import rolls back all batches (same semantics as today).
- Per-record errors on annotated import keep the current contract: the record
  is skipped and reported in `errors`, never failing the whole file.
- Export temp files are unlinked immediately after opening (download path) or
  deleted in a `finally` (store path), so failures never leak files.

## Testing / verification

No meaningful test suite exists (per CLAUDE.md). Verification:

- `python -m py_compile` over every touched file; `npm run build` for any
  frontend-visible change.
- A scratchpad round-trip script: synthetic dataset → `write` → `read` into a
  fresh model → compare utterance/span/registry counts, against SQLite (the
  fallback path). If a local Postgres is available, the same script pointed at
  it exercises the `COPY` fast paths.

## Rejected alternatives

- **All-SQL annotated export** (`string_agg` + offset splicing in the COPY
  query): duplicates the tagging round-trip logic that
  `server/utils/dataset.py` owns, and Unicode offset splicing in SQL is
  fragile.
- **Optimizing each method in place** without a generalized surface: least
  churn, but leaves four divergent implementations.
- **`COPY FROM` for annotated import:** cannot return generated utterance ids
  that tags need; batched `insert().returning()` is nearly as fast and safe.
