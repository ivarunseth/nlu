# Model Sub-Nav Hamburger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the model sub-nav (Build/History/Test/Publish/Analyse/Settings) collapse into a hamburger below `lg`, matching [Header.jsx](../../../src/layout/Header.jsx)'s existing collapse behavior, instead of becoming a horizontally-scrollable tab strip.

**Architecture:** Wrap the existing `Nav` in [Model.jsx](../../../src/routes/model/Model.jsx) with react-bootstrap's `Navbar`/`Navbar.Toggle`/`Navbar.Collapse`, driven by a shared `{key: {icon, label}}` section map that also feeds the collapsed toggle's active-section label. Align the breadcrumb/nav column breakpoints to `lg` so both halves of the row switch layout together.

**Tech Stack:** React 19, react-bootstrap (`Navbar`, `Nav`, `Row`, `Col`), react-bootstrap-icons. No new dependencies.

## Global Constraints

- Spec: [2026-07-26-model-subnav-hamburger-design.md](../specs/2026-07-26-model-subnav-hamburger-design.md)
- Scope is entirely [src/routes/model/Model.jsx](../../../src/routes/model/Model.jsx) — no other files change.
- This project has no meaningful Jest tests (per `CLAUDE.md`). Verify each task with `npm run build` (catches syntax/JSX errors) plus a visual check in the browser preview at both a wide (`≥1200px`) and a narrow (`<992px`) viewport. Do not write Jest tests for this change.
- Do not `git commit` — this repo's convention (confirmed with the user) is commits happen only when explicitly requested.

---

### Task 1: Replace the six hand-written `Nav.Item`s with a shared section map

Pure refactor, no visible behavior change. Makes the section data (icon + label per key) reusable so Task 2's collapsed toggle can read the active section's icon/label from the same place instead of duplicating it.

**Files:**
- Modify: `src/routes/model/Model.jsx:1-3` (imports — no new imports needed, `Navbar` and icons already imported at line 2-3), `src/routes/model/Model.jsx:20` (insert module-level constant after the lazy imports, before `ModelContent`), `src/routes/model/Model.jsx:153-215` (replace the six `Nav.Item` blocks with a `.map()`)

**Interfaces:**
- Produces: a module-level `SECTIONS` object, `{ [sectionKey]: { icon: <Icon />, label: string } }`, keys in the order `build, history, test, publish, analyse, settings` (this order is the render order of the tab strip — must match today's order exactly). Task 2 reads `SECTIONS[activeSection]` for the collapsed toggle.

- [ ] **Step 1: Add the `SECTIONS` constant**

Insert immediately after the `TrainingVersion` lazy-import block (after line 19, before `const ModelContent = () => {` on line 21) in `src/routes/model/Model.jsx`:

```jsx
const SECTIONS = {
    build: { icon: <Translate />, label: 'Build' },
    history: { icon: <ClockHistory />, label: 'History' },
    test: { icon: <ClipboardCheck />, label: 'Test' },
    publish: { icon: <RocketTakeoff />, label: 'Publish' },
    analyse: { icon: <Activity />, label: 'Analyse' },
    settings: { icon: <Gear />, label: 'Settings' },
};
```

- [ ] **Step 2: Replace the six `Nav.Item` blocks with a map**

In `src/routes/model/Model.jsx`, replace lines 160-213 (the six `<Nav.Item>...</Nav.Item>` blocks, from the `build` item through the `settings` item, inclusive) with:

```jsx
                        {Object.entries(SECTIONS).map(([key, { icon, label }]) => (
                            <Nav.Item key={key}>
                                <Nav.Link
                                    eventKey={key}
                                    as={Link}
                                    to={`${modelBasePath}/${key}`}
                                >
                                    {icon}&nbsp;{label}
                                </Nav.Link>
                            </Nav.Item>
                        ))}
```

The surrounding `<Nav fill variant='underline' activeKey={activeSection} className='justify-content-md-end flex-nowrap overflow-auto w-100'>` (line 154-159) and its closing `</Nav>` (line 214) stay unchanged in this task.

- [ ] **Step 3: Verify the build succeeds**

Run: `npm run build`
Expected: build completes with no errors (JSX/import errors would surface here — there are no other tests to run).

- [ ] **Step 4: Visual check — no behavior change**

Start the dev server (`npm run dev` or the project's preview tooling) and open any model's `build`/`history`/`test`/`publish`/`analyse`/`settings` page at a wide viewport (`≥1200px`). Confirm the tab strip looks and behaves exactly as before: same six tabs, same icons, same order, same active-tab underline, same navigation on click. No visual diff is expected from this task.

---

### Task 2: Wrap the sub-nav in `Navbar` so it collapses into a hamburger below `lg`

**Files:**
- Modify: `src/routes/model/Model.jsx:104` (breadcrumb `Col` breakpoint), `src/routes/model/Model.jsx:153-216` (nav `Col`: wrap `Nav` in `Navbar`/`Navbar.Toggle`/`Navbar.Collapse`), `src/routes/model/Model.jsx:2` (add `Navbar` to the react-bootstrap import)

**Interfaces:**
- Consumes: `SECTIONS` (module-level object from Task 1, `{ [key]: { icon, label } }`), `activeSection` (existing local variable in `ModelContent`, a string key into `SECTIONS`).

- [ ] **Step 1: Import `Navbar`**

In `src/routes/model/Model.jsx:2`, change:

```jsx
import { Container, Row, Col, Nav } from 'react-bootstrap';
```

to:

```jsx
import { Container, Row, Col, Nav, Navbar } from 'react-bootstrap';
```

- [ ] **Step 2: Move the breadcrumb column's breakpoint from `md` to `lg`**

In `src/routes/model/Model.jsx:104`, change:

```jsx
                <Col xs={12} md={4} xl={5} className='d-flex align-items-center'>
```

to:

```jsx
                <Col xs={12} lg={4} xl={5} className='d-flex align-items-center'>
```

- [ ] **Step 3: Wrap the nav column's `Nav` in `Navbar`**

In `src/routes/model/Model.jsx`, replace the nav `Col` block (originally lines 153-215, i.e. from `<Col xs={12} md={8} xl={7} ...>` through its closing `</Col>` — after Task 1's Step 2 edit this is the `<Col>` immediately following the breadcrumb `Col>` closing tag) with:

```jsx
                <Col xs={12} lg={8} xl={7} className='d-flex align-items-center'>
                    <Navbar expand='lg' collapseOnSelect className='p-0 w-100'>
                        <Navbar.Toggle aria-controls='model-subnav-collapse' className='border-0 ms-auto'>
                            <span className='navbar-toggler-icon' />
                            {' '}
                            {SECTIONS[activeSection]?.icon}
                            {' '}
                            {SECTIONS[activeSection]?.label}
                        </Navbar.Toggle>
                        <Navbar.Collapse id='model-subnav-collapse'>
                            <Nav
                                fill
                                variant='underline'
                                activeKey={activeSection}
                                className='justify-content-lg-end flex-nowrap overflow-auto w-100'
                            >
                                {Object.entries(SECTIONS).map(([key, { icon, label }]) => (
                                    <Nav.Item key={key}>
                                        <Nav.Link
                                            eventKey={key}
                                            as={Link}
                                            to={`${modelBasePath}/${key}`}
                                        >
                                            {icon}&nbsp;{label}
                                        </Nav.Link>
                                    </Nav.Item>
                                ))}
                            </Nav>
                        </Navbar.Collapse>
                    </Navbar>
                </Col>
```

This changes the `Col` breakpoint from `md`/`xl` to `lg`/`xl` (matching Step 2's breadcrumb column and the `Navbar expand='lg'`), replaces `justify-content-md-end` with `justify-content-lg-end`, and wraps the pre-existing `Nav` (unchanged internally from Task 1) in `Navbar` / `Navbar.Toggle` / `Navbar.Collapse`.

- [ ] **Step 4: Verify the build succeeds**

Run: `npm run build`
Expected: build completes with no errors.

- [ ] **Step 5: Visual check — wide viewport unchanged**

Open a model page at `≥1200px` width. Confirm: breadcrumb on the left, tab strip inline on the right, no hamburger button visible, tabs behave exactly as before (this is the same check as Task 1 Step 4, re-run because the column breakpoints changed).

- [ ] **Step 6: Visual check — narrow viewport shows the hamburger**

Resize the browser (or use the preview tool's `resize_window`) to `<992px` width (e.g. `768px`) on a model page, e.g. the `analyse` section. Confirm:
- The inline tab strip is gone, replaced by a single toggle button showing a hamburger icon plus the active section's icon and label (e.g. "☰ 📊 Analyse").
- Clicking the toggle expands a vertically-stacked list of all six tabs (Build/History/Test/Publish/Analyse/Settings), each with its icon and label.
- Clicking a different tab (e.g. "Build") navigates to that section, the collapse closes (`collapseOnSelect`), and the toggle's label now reads "☰ 🌐 Build".
- The breadcrumb above still reads correctly and independently of the collapse state.

- [ ] **Step 7: Visual check — behavior matches the main header's hamburger**

On the same narrow viewport, compare against the main app header's hamburger (top of any page). Confirm both use the same interaction pattern: tap to open, vertical list, tap a link to navigate and auto-close. Take a screenshot of both (header collapsed-open, sub-nav collapsed-open) to confirm visual consistency (spacing/icon style may differ slightly since they're separate `Navbar`s, but the *interaction* should feel identical).

---

## Self-Review Notes

- **Spec coverage:** Toggle behavior (✅ Task 2 Steps 3-7), section data map (✅ Task 1), breakpoint alignment (✅ Task 2 Steps 2-3), scope contained to `Model.jsx` (✅ no other files touched). All three spec sections have a corresponding task.
- **Placeholders:** none — every step has literal code and exact line ranges.
- **Type/name consistency:** `SECTIONS` is defined once in Task 1 Step 1 and consumed identically (`SECTIONS[activeSection]?.icon`/`.label`, `Object.entries(SECTIONS)`) in Task 1 Step 2 and Task 2 Step 3 — no renaming across tasks.
