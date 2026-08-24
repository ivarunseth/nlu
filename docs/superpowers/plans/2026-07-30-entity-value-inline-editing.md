# Entity Value Inline Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the modal-driven rename/synonym-textarea editing of an existing value in the entity value catalogue with inline editing directly in the table row.

**Architecture:** All changes are confined to `src/routes/model/routes/studio/components/EntityValues.jsx`. The Value cell gets a click-to-edit `Form.Control` (mirroring the pattern already used in `AnnotatedUtterance.jsx`). The Synonyms cell gets removable chips plus an inline add-input/button. Both call the existing `PUT /models/<modelId>/entities/<entityId>/values/<valueId>` endpoint with only the changed field (`{ value }` or `{ synonyms }`) — no backend changes. The "Add value" creation modal is untouched.

**Tech Stack:** React 19, react-bootstrap, axios.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-29-entity-value-inline-editing-design.md` — every requirement in it must be covered by a task below.
- No backend changes — `Value.from_dict` (`server/database/value.py`) already applies `value` and `synonyms` as independent partial updates.
- This frontend has no meaningful Jest suite (confirmed in `CLAUDE.md`: "the frontend Jest config exists but there are effectively no meaningful tests"). Per this project's established convention (also followed earlier in this same work), verification is `npm run build` (must complete with `✓ built` and no new errors) plus a manual QA description in each task, in place of the write-test/run-test steps in the default template.
- Follow the existing codebase's icon/button conventions exactly: `react-bootstrap-icons` for all icons, `variant="light"` + `className="border"` for icon buttons, `size="sm"` for in-row controls.
- Never leave the app without a working way to rename a value or manage its synonyms between tasks — order tasks so the old (modal) path is only removed after the new (inline) path fully replaces it.

---

## Task 1: Value cell — inline rename

**Files:**
- Modify: `src/routes/model/routes/studio/components/EntityValues.jsx`

**Interfaces:**
- Produces: `editingId` (number|null, id of the value row mid-rename), `valueDraft` (string), `startEditingValue(value)`, `cancelEditingValue()`, `saveValueEdit(value)` — all used only within this file; Task 3 references `editingId`'s absence to confirm no dead references remain.

- [ ] **Step 1: Add the `Check2` icon import**

Modify the icon import (currently line 4):

```jsx
import { BookmarkStar, InfoCircle, Option, Pen, PlusLg, Quote, Tags, Trash } from "react-bootstrap-icons";
```

to:

```jsx
import { BookmarkStar, Check2, InfoCircle, Option, Pen, PlusLg, Quote, Tags, Trash } from "react-bootstrap-icons";
```

- [ ] **Step 2: Add rename state**

Modify the state block (currently lines 45-50):

```jsx
    const [showForm, setShowForm] = useState(false);
    const [current, setCurrent] = useState(null);
    const [valueText, setValueText] = useState("");
    const [synonymsText, setSynonymsText] = useState("");
    const [toDelete, setToDelete] = useState(null);
    const [submitting, setSubmitting] = useState(false);
```

to:

```jsx
    const [showForm, setShowForm] = useState(false);
    const [current, setCurrent] = useState(null);
    const [valueText, setValueText] = useState("");
    const [synonymsText, setSynonymsText] = useState("");
    const [toDelete, setToDelete] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [valueDraft, setValueDraft] = useState("");
```

- [ ] **Step 3: Add the rename handlers**

Insert immediately after the `useEffect` that calls `getValues` (currently lines 74-76, right before `const closeForm = () => {`):

```jsx
    // Renaming a value is edited in place in its table row; the modal is
    // reserved for creating a brand-new value.
    const startEditingValue = (value) => {
        setEditingId(value.id);
        setValueDraft(value.value);
    };

    const cancelEditingValue = () => {
        setEditingId(null);
    };

    const saveValueEdit = async (value) => {
        const trimmed = valueDraft.trim();
        // No real change — close without a round trip.
        if (!trimmed || trimmed === value.value) {
            setEditingId(null);
            return;
        }
        try {
            await axios.put(
                `/api/models/${modelId}/entities/${entityId}/values/${value.id}`,
                { value: trimmed }, { headers }
            );
            setEditingId(null);
            getValues();
        } catch (error) {
            // Stay in edit mode with the draft intact so the user can fix it
            // (e.g. a duplicate-name 400 surfaced in the alert banner above).
            showError(error);
        }
    };
```

- [ ] **Step 4: Replace the Value cell markup**

Modify the Value `<td>` (currently line 202):

```jsx
                                <td className="ps-3 text-break fw-medium">{value.value}</td>
```

to:

```jsx
                                <td className="ps-3 text-break fw-medium" style={{ minWidth: "10rem" }}>
                                    <div className="d-flex align-items-center gap-2">
                                        {editingId === value.id ? (
                                            <Form.Control
                                                size="sm"
                                                className="flex-grow-1"
                                                value={valueDraft}
                                                autoFocus
                                                onChange={(e) => setValueDraft(e.target.value)}
                                                onBlur={() => saveValueEdit(value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter") {
                                                        e.preventDefault();
                                                        saveValueEdit(value);
                                                    } else if (e.key === "Escape") {
                                                        cancelEditingValue();
                                                    }
                                                }}
                                            />
                                        ) : (
                                            <span className="flex-grow-1">{value.value}</span>
                                        )}
                                        {editingId === value.id ? (
                                            <Button
                                                variant="light"
                                                size="sm"
                                                className="border text-success d-inline-flex align-items-center flex-shrink-0"
                                                title="Save value"
                                                aria-label="Save value"
                                                onMouseDown={(e) => e.preventDefault()}
                                                onClick={() => saveValueEdit(value)}
                                            >
                                                <Check2 />
                                            </Button>
                                        ) : (
                                            <Button
                                                variant="light"
                                                size="sm"
                                                className="border d-inline-flex align-items-center flex-shrink-0"
                                                title={`Edit ${value.value}`}
                                                aria-label={`Edit ${value.value}`}
                                                onClick={() => startEditingValue(value)}
                                            >
                                                <Pen />
                                            </Button>
                                        )}
                                    </div>
                                </td>
```

Note: the `onMouseDown={(e) => e.preventDefault()}` on the save button matches the identical trick already used in `AnnotatedUtterance.jsx` — it stops the input's `onBlur` (which also calls save) from unmounting the button before its `onClick` fires.

The Options column's old "Edit" button (which opens the modal pre-filled) still exists after this step — it is removed in Task 3, once the inline path fully replaces it. Both will work simultaneously for now.

- [ ] **Step 5: Verify**

Run: `npm run build`
Expected: `✓ built in ...ms`, no new errors.

Manual QA (dev server, `npm run dev`, navigate to an entity's value catalogue):
- Click the pencil on a value → it becomes an input, focused, with existing text selected for editing.
- Type a change, press Enter → saves, input closes, new value shown.
- Click the pencil, type a change, click elsewhere (blur) → saves the same way.
- Click the pencil, type a change, press Escape → reverts, no request sent.
- Click the pencil, clear the field entirely, press Enter → closes without a request (empty is a no-op, not an error).
- Rename a value to a name that collides with another value in the same entity → the top alert banner shows the server's 400 message, and the row stays in edit mode with your typed text still there.

- [ ] **Step 6: Commit**

```bash
git add src/routes/model/routes/studio/components/EntityValues.jsx
git commit -m "Add inline rename for entity catalogue values"
```

---

## Task 2: Synonyms cell — removable chips + inline add

**Files:**
- Modify: `src/routes/model/routes/studio/components/EntityValues.jsx`

**Interfaces:**
- Consumes: `headers`, `getValues()`, `showError(error)` (all already defined in the component).
- Produces: `pendingIds` (Set of value ids with an in-flight synonym request), `isPending(id)`, `synonymDrafts` (object keyed by value id), `synonymDraft(id)`, `setSynonymDraft(id, text)`, `saveSynonyms(value, terms)` (returns `Promise<boolean>`), `handleAddSynonym(value)`, `handleRemoveSynonym(value, synonymId)`.

- [ ] **Step 1: Add the `XLg` icon import**

Modify the icon import (as left by Task 1):

```jsx
import { BookmarkStar, Check2, InfoCircle, Option, Pen, PlusLg, Quote, Tags, Trash } from "react-bootstrap-icons";
```

to:

```jsx
import { BookmarkStar, Check2, InfoCircle, Option, Pen, PlusLg, Quote, Tags, Trash, XLg } from "react-bootstrap-icons";
```

- [ ] **Step 2: Add synonym-editing state**

Modify the state added by Task 1:

```jsx
    const [editingId, setEditingId] = useState(null);
    const [valueDraft, setValueDraft] = useState("");
```

to:

```jsx
    const [editingId, setEditingId] = useState(null);
    const [valueDraft, setValueDraft] = useState("");
    // Ids of rows with an in-flight synonym add/remove — disables that row's
    // controls so a slow request can't race a second click.
    const [pendingIds, setPendingIds] = useState(() => new Set());
    // The "add synonym" input text, per value id.
    const [synonymDrafts, setSynonymDrafts] = useState({});
```

- [ ] **Step 3: Add the synonym handlers**

Insert immediately after the `saveValueEdit` function added in Task 1 (before `const closeForm = () => {`):

```jsx
    const isPending = (id) => pendingIds.has(id);

    const setPending = (id, isSet) => {
        setPendingIds((previous) => {
            const next = new Set(previous);
            if (isSet) next.add(id); else next.delete(id);
            return next;
        });
    };

    // Shared by add and remove: both send the full recomputed synonym text
    // list, since the API replaces the set wholesale (Value.from_dict).
    // Returns whether it succeeded, so callers can decide what to reset.
    const saveSynonyms = async (value, terms) => {
        setPending(value.id, true);
        try {
            await axios.put(
                `/api/models/${modelId}/entities/${entityId}/values/${value.id}`,
                { synonyms: terms }, { headers }
            );
            getValues();
            return true;
        } catch (error) {
            showError(error);
            return false;
        } finally {
            setPending(value.id, false);
        }
    };

    const synonymDraft = (id) => synonymDrafts[id] || "";

    const setSynonymDraft = (id, text) => {
        setSynonymDrafts((previous) => ({ ...previous, [id]: text }));
    };

    const handleAddSynonym = async (value) => {
        const term = synonymDraft(value.id).trim();
        if (!term) return;
        const terms = [...value.synonyms.map((synonym) => synonym.text), term];
        const ok = await saveSynonyms(value, terms);
        // On failure (e.g. duplicate-term 400) keep the typed text so the
        // user can fix it instead of retyping it.
        if (ok) setSynonymDraft(value.id, "");
    };

    const handleRemoveSynonym = (value, synonymId) => {
        const terms = value.synonyms
            .filter((synonym) => synonym.id !== synonymId)
            .map((synonym) => synonym.text);
        saveSynonyms(value, terms);
    };
```

- [ ] **Step 4: Replace the Synonyms cell markup**

Modify the Synonyms `<td>` (currently lines 203-215):

```jsx
                                <td>
                                    {value.synonyms.length > 0 ? (
                                        <div className="d-flex flex-wrap gap-1">
                                            {value.synonyms.map((synonym) => (
                                                <Badge key={synonym.id} bg="light" text="dark" className="border fw-normal">
                                                    {synonym.text}
                                                </Badge>
                                            ))}
                                        </div>
                                    ) : (
                                        <span className="text-muted small">—</span>
                                    )}
                                </td>
```

to:

```jsx
                                <td>
                                    <div
                                        className="d-flex flex-wrap align-items-center gap-1"
                                        style={{ maxHeight: "4.5rem", overflowY: "auto" }}
                                    >
                                        {value.synonyms.map((synonym) => (
                                            <Badge
                                                key={synonym.id}
                                                bg="light"
                                                text="dark"
                                                className="border fw-normal d-inline-flex align-items-center gap-1"
                                            >
                                                {synonym.text}
                                                <XLg
                                                    role="button"
                                                    aria-label={`Remove synonym ${synonym.text}`}
                                                    size={10}
                                                    style={{
                                                        cursor: isPending(value.id) ? "default" : "pointer",
                                                        opacity: isPending(value.id) ? 0.5 : 1,
                                                        pointerEvents: isPending(value.id) ? "none" : "auto"
                                                    }}
                                                    onClick={() => handleRemoveSynonym(value, synonym.id)}
                                                />
                                            </Badge>
                                        ))}
                                        <Form.Control
                                            size="sm"
                                            placeholder="add synonym..."
                                            value={synonymDraft(value.id)}
                                            disabled={isPending(value.id)}
                                            style={{ width: "9rem" }}
                                            onChange={(e) => setSynonymDraft(value.id, e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    handleAddSynonym(value);
                                                }
                                            }}
                                        />
                                        <Button
                                            variant="light"
                                            size="sm"
                                            className="border d-inline-flex align-items-center"
                                            title="Add synonym"
                                            aria-label="Add synonym"
                                            disabled={isPending(value.id) || !synonymDraft(value.id).trim()}
                                            onClick={() => handleAddSynonym(value)}
                                        >
                                            <PlusLg />
                                        </Button>
                                    </div>
                                </td>
```

This drops the old "—" empty-synonyms placeholder — with the add input always present in the cell, there's no empty state to label; the affordance to add the first synonym is right there.

- [ ] **Step 5: Verify**

Run: `npm run build`
Expected: `✓ built in ...ms`, no new errors.

Manual QA (dev server):
- Type a synonym in a value's add-input, press Enter → chip appears, input clears and stays focused, ready for the next one.
- Type a synonym, click the "+" button → same result.
- Click "+" or press Enter with the input empty → nothing happens (button is disabled when the input is blank).
- Click the × on a chip → it's removed immediately.
- Try adding a synonym that duplicates an existing value/synonym in the same entity → the top alert shows the server's 400 message, and your typed text stays in the input (not cleared).
- On a value with many synonyms (add ~15 in dev tools or via import), confirm the chip area caps its height and scrolls internally instead of growing the table row indefinitely.
- Narrow the browser window (or resize to mobile width) and confirm the add-input/button wraps onto its own line below the chips instead of overflowing.

- [ ] **Step 6: Commit**

```bash
git add src/routes/model/routes/studio/components/EntityValues.jsx
git commit -m "Add inline synonym add/remove for entity catalogue values"
```

---

## Task 3: Remove the old per-row Edit path

**Files:**
- Modify: `src/routes/model/routes/studio/components/EntityValues.jsx`

**Interfaces:**
- Consumes: `editingId`/`valueDraft`/`pendingIds`/`synonymDrafts` and their handlers (Tasks 1-2) — this task only removes now-dead code, it does not add anything new.

- [ ] **Step 1: Drop the `current` state**

Modify (currently lines 45-46, unchanged since Task 1):

```jsx
    const [showForm, setShowForm] = useState(false);
    const [current, setCurrent] = useState(null);
    const [valueText, setValueText] = useState("");
```

to:

```jsx
    const [showForm, setShowForm] = useState(false);
    const [valueText, setValueText] = useState("");
```

- [ ] **Step 2: Simplify `closeForm`/`handleOpenCreate`, drop `handleOpenEdit`, simplify `handleSubmit`**

Modify:

```jsx
    const closeForm = () => {
        setShowForm(false);
        setCurrent(null);
        setSubmitting(false);
    };

    const handleOpenCreate = () => {
        setCurrent(null);
        setValueText("");
        setSynonymsText("");
        setShowForm(true);
    };

    const handleOpenEdit = (value) => {
        setCurrent(value);
        setValueText(value.value);
        setSynonymsText(value.synonyms.map((synonym) => synonym.text).join(", "));
        setShowForm(true);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const payload = { value: valueText.trim(), synonyms: parseSynonyms(synonymsText) };
        if (!payload.value) return;
        try {
            setSubmitting(true);
            if (current) {
                await axios.put(
                    `/api/models/${modelId}/entities/${entityId}/values/${current.id}`,
                    payload, { headers }
                );
            } else {
                await axios.post(
                    `/api/models/${modelId}/entities/${entityId}/values`,
                    payload, { headers }
                );
            }
            closeForm();
            getValues();
        } catch (error) {
            setSubmitting(false);
            showError(error);
        }
    };
```

to:

```jsx
    const closeForm = () => {
        setShowForm(false);
        setSubmitting(false);
    };

    const handleOpenCreate = () => {
        setValueText("");
        setSynonymsText("");
        setShowForm(true);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const payload = { value: valueText.trim(), synonyms: parseSynonyms(synonymsText) };
        if (!payload.value) return;
        try {
            setSubmitting(true);
            await axios.post(
                `/api/models/${modelId}/entities/${entityId}/values`,
                payload, { headers }
            );
            closeForm();
            getValues();
        } catch (error) {
            setSubmitting(false);
            showError(error);
        }
    };
```

- [ ] **Step 3: Remove the Options column's "Edit" button**

Modify the Options `<td>` (currently lines 221-242):

```jsx
                                <td className="text-center">
                                    <Button
                                        variant="light"
                                        size="sm"
                                        className="border me-1"
                                        title={`Edit ${value.value}`}
                                        aria-label={`Edit ${value.value}`}
                                        onClick={() => handleOpenEdit(value)}
                                    >
                                        <Pen />
                                    </Button>
                                    <Button
                                        variant="light"
                                        size="sm"
                                        className="border text-danger"
                                        title={`Delete ${value.value}`}
                                        aria-label={`Delete ${value.value}`}
                                        onClick={() => setToDelete(value)}
                                    >
                                        <Trash />
                                    </Button>
                                </td>
```

to:

```jsx
                                <td className="text-center">
                                    <Button
                                        variant="light"
                                        size="sm"
                                        className="border text-danger"
                                        title={`Delete ${value.value}`}
                                        aria-label={`Delete ${value.value}`}
                                        onClick={() => setToDelete(value)}
                                    >
                                        <Trash />
                                    </Button>
                                </td>
```

- [ ] **Step 4: Make the modal title static**

Modify:

```jsx
                        <Modal.Title>{current ? "Edit value" : "Add value"}</Modal.Title>
```

to:

```jsx
                        <Modal.Title>Add value</Modal.Title>
```

- [ ] **Step 5: Verify**

Run: `npm run build`
Expected: `✓ built in ...ms`, no new errors, no unused-variable warnings for `current`/`handleOpenEdit`.

Manual QA (dev server):
- The Options column now shows only the trash icon.
- "add value" still opens a modal titled "Add value" with an empty name field and empty synonyms textarea, and creates a new row on submit.
- Renaming and synonym add/remove from Tasks 1-2 still work exactly as before (this task only deletes the old modal-edit path, it doesn't touch the inline handlers).

- [ ] **Step 6: Commit**

```bash
git add src/routes/model/routes/studio/components/EntityValues.jsx
git commit -m "Remove the modal-based edit path for entity catalogue values"
```

---

## Task 4: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Clean build**

Run: `npm run build`
Expected: `✓ built in ...ms`, no errors or warnings.

- [ ] **Step 2: End-to-end manual QA on a real entity**

On `npm run dev`, open a model's Build page, go to Entities, drill into an entity with several values (or create a few via "add value"), and walk through:
1. Rename a value inline (pencil → edit → Enter) — persists after a page refresh.
2. Add three synonyms to a value via Enter each time — all three persist after refresh.
3. Remove one synonym via its × — gone after refresh, the other two remain.
4. Trigger a duplicate-name and a duplicate-synonym error — both show in the alert banner, and the field involved keeps your input instead of clearing.
5. Paginate to a second page of values (10+ values) and confirm inline rename/synonym add/remove work identically there.
6. Resize to a narrow/mobile width and confirm the table still scrolls horizontally (`Table responsive`) without the synonym add-input overflowing its cell.

- [ ] **Step 3: Confirm spec coverage**

Re-read `docs/superpowers/specs/2026-07-29-entity-value-inline-editing-design.md` section by section and confirm each point maps to a task above:
- Value cell inline edit → Task 1.
- Synonym chips with remove + inline add → Task 2.
- Responsiveness (max-height/scroll, flex-wrap) → Task 2, Step 4.
- Options column drops Edit → Task 3, Step 3.
- Create-value modal unchanged → confirmed untouched in Tasks 1-3 (only its title and internal state wiring were simplified, not its fields or behavior).

- [ ] **Step 4: Commit (if Step 3 uncovered any gap fixes)**

Only run this if Step 3 required a code change beyond Tasks 1-3:

```bash
git add src/routes/model/routes/studio/components/EntityValues.jsx
git commit -m "Address spec-coverage gap in entity value inline editing"
```
