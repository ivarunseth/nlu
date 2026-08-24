# Collapse the model sub-nav into a hamburger

Date: 2026-07-26
Status: approved

## Problem

Inside a model, [Model.jsx](../../../src/routes/model/Model.jsx) renders a
`page-context-bar` row: a breadcrumb on the left, and a six-item tab strip
(Build / History / Test / Publish / Analyse / Settings) on the right. On
narrow screens the tab strip doesn't collapse — it becomes a horizontally
scrollable row of tabs below the breadcrumb, so a user has to scroll
sideways to find a hidden tab. The main app header
([Header.jsx](../../../src/layout/Header.jsx)) already solves this same
problem with a react-bootstrap `Navbar` that collapses into a hamburger
below `lg`. The sub-nav should behave the same way.

## Design

### Toggle behavior

Wrap the existing `<Nav>` in `<Navbar expand="lg" collapseOnSelect>`, in the
same right-hand column it lives in today:

- **`≥ lg`**: renders exactly as today — the six tabs inline, right-aligned
  next to the breadcrumb.
- **`< lg`**: `Navbar.Toggle` replaces the tab strip with a single button
  showing the hamburger icon plus the *active* section's icon and label
  (e.g. "☰ 📊 Analyse"), so the current section is visible without opening
  the menu. Tapping it opens `Navbar.Collapse`, which stacks the six tabs
  vertically. `collapseOnSelect` (matching `Header.jsx`) auto-closes it once
  a tab is picked.

### Section data

Replace the six hand-written `Nav.Item` blocks with a single ordered map:

```js
const SECTIONS = {
    build: { icon: <Translate />, label: 'Build' },
    history: { icon: <ClockHistory />, label: 'History' },
    test: { icon: <ClipboardCheck />, label: 'Test' },
    publish: { icon: <RocketTakeoff />, label: 'Publish' },
    analyse: { icon: <Activity />, label: 'Analyse' },
    settings: { icon: <Gear />, label: 'Settings' },
};
```

The tab strip is built with `Object.entries(SECTIONS).map(...)`, and the
toggle's active-label reads `SECTIONS[activeSection]`. This is the single
source of truth for both places that need a section's icon/label, so the
new toggle doesn't need its own copy.

### Layout breakpoint alignment

The breadcrumb/nav columns currently switch from stacked to side-by-side at
`md` (`Col xs={12} md={4} xl={5}` and `Col xs={12} md={8} xl={7}`). Move
that switch to `lg` (`Col xs={12} lg={4} xl={5}` / `Col xs={12} lg={8}
xl={7}`) so both columns change layout at the same breakpoint the nav bar
itself uses — otherwise there's an in-between width (`md`–`lg`) where the
breadcrumb is already inline but the nav is still collapsed into a
hamburger sitting in a narrow column.

## Scope

Entirely contained to [Model.jsx](../../../src/routes/model/Model.jsx); no
other files change. No new dependencies — `Navbar` is already used
elsewhere in the app (`Header.jsx`).
