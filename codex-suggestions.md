# UX Improvement Suggestions

## Executive Summary

The Oracle Plan Visualizer already has strong analytical depth: multiple plan
views, comparisons, filters, annotations, metadata, keyboard shortcuts, and
export and sharing features. The main UX opportunity is therefore not adding
more capabilities. It is turning the current feature-dense workbench into a
guided diagnostic workflow.

The recommended first implementation slice is:

1. Add an analysis overview with prioritized findings after parsing.
2. Make the three-panel workspace responsive.
3. Protect annotations and plan input from accidental loss.
4. Fix accessible names, focus states, table interactions, and dialogs.
5. Separate "Reset Filters" from "Reset View."

## Prioritized Improvements

### 1. Add an Analysis Overview After Parsing

After a plan is parsed, show the three most important findings before asking
the user to choose among visualization modes. Each finding should explain:

- what was detected;
- why it matters;
- which operation is affected;
- what evidence supports the conclusion; and
- the next useful action, such as focusing the operation, attaching metadata,
  or comparing another plan.

The current details sidebar already contains findings, slowest operations, and
highest-cost operations, but users must discover that panel and interpret the
separate sections themselves. The overview should reuse those calculations and
provide a clear starting point, not introduce a second analysis engine.

Suggested workflow:

1. Observe the top finding.
2. Focus the affected operation in the current visualization.
3. Inspect supporting predicates, estimates, and runtime statistics.
4. Attach metadata when stronger evidence is needed.
5. Compare the result with another plan.

### 2. Make the Workspace Responsive

The loaded-plan layout currently reserves minimum widths for the filters,
visualization, and details panels. Together, those minimums require roughly
950 pixels before accounting for borders and browser chrome. The root layout
also suppresses page scrolling, making narrow viewports particularly fragile.

Recommended behavior:

- At desktop widths, retain the current resizable three-panel workspace.
- At narrower laptop widths, automatically collapse one or both side panels.
- Present filters as a left drawer when there is insufficient horizontal room.
- Present node details as a right drawer or bottom sheet on mobile.
- Allow the header and view navigation to collapse into overflow menus.
- Preserve visible labels or accessible names when controls become icon-only.
- Store user-adjusted panel widths so the workspace remains consistent between
  sessions.

### 3. Reduce Peer-Level Navigation Choices

The navigation ribbon currently exposes Tree, Compare, Tabular, Sankey, Flame,
Plan Text, SQL, Metadata, Monitor, and Experimental as equal choices. This
makes the interface harder to scan and does not communicate which view answers
which question.

Group views by user intent:

- **Analyze:** Tree, Table, Flame, and Sankey
- **Compare:** comparison dashboard and side-by-side modes
- **Evidence:** SQL, Plan Text, Monitor, and Metadata
- **More:** Experimental views

Tree can remain the default visualization, while the new Analysis Overview
provides the default diagnostic entry point. Views unavailable for the current
input format should explain what data is missing and how to obtain it.

### 4. Protect User Work

Clearing a plan or removing a plan tab currently discards raw input, parsed
state, selection, and annotations immediately. This is especially risky
because the save control communicates unsaved state primarily through color.

Recommended behavior:

- Show an explicit "Unsaved annotations" status.
- Ask for confirmation only when a destructive action would discard unsaved
  annotations or other user-authored work.
- Alternatively, provide a short undo window after clearing or removing a
  plan.
- Warn before closing or navigating away when unsaved annotations exist.
- Keep confirmation copy specific, for example: "Remove Plan B and its 4
  annotations?"

### 5. Separate Filtering From View Customization

The current Reset action clears search and thresholds, but also resets display
options and animation behavior. That is broader than the label suggests and
can unexpectedly change a carefully configured visualization.

Split the actions into:

- **Reset Filters:** search, operation types, predicate types, and thresholds
- **Reset View:** node fields, warning badges, animation, and layout behavior
- **Clear Search:** a local action beside the search field

Additional improvements:

- Add direct numeric entry alongside range sliders.
- Offer presets such as "Top 10% by cost," "Cardinality mismatch at least 3x,"
  and "Only operations with findings."
- Consider logarithmic or percentile-based sliders when a single outlier makes
  most of the linear range unusable.
- Announce the number of visible operations after a filter changes.
- Make pressed and selected states programmatically available, not only
  visually distinct.

### 6. Make Keyboard and Screen-Reader Use First-Class

Accessibility improvements here also benefit expert keyboard users working
with large plans.

Priority fixes:

- Give every icon-only control an accessible name; `title` alone is not a
  reliable label.
- Preserve accessible view names when visible labels are hidden at smaller
  breakpoints.
- Add consistent, high-contrast `:focus-visible` styling.
- Make sortable table headers keyboard-operable and expose sort direction with
  `aria-sort`.
- Make selectable table rows focusable and operable without a pointer.
- Add semantic captions and column scopes to data tables.
- Provide keyboard alternatives for panel and table-column resizing.
- Scope tree arrow-key handling to the focused visualization instead of using
  global navigation.
- Use native modal dialogs where practical, or correctly contain and restore
  focus for custom dialogs.
- Give the command palette dialog, combobox, listbox, active option, and result
  count semantics.
- Associate every textarea, search input, range input, and select with a
  persistent label.
- Announce parse errors and attachment results through a restrained live
  region.
- Respect `prefers-reduced-motion` and replace broad `transition-all`
  declarations with explicit properties.

These recommendations align with the current
[Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md),
including accessible names, visible focus, semantic controls, keyboard
alternatives, reduced motion, and live feedback.

### 7. Share the Analysis Context, Not Only the Plan

Shared links currently preserve plan input and annotations, but not the active
view, selected operation, filters, comparison configuration, or expanded
panels. A recipient therefore receives the data without necessarily seeing the
finding the sender intended to discuss.

Include a small, versioned workspace state in shared links:

- active plan and view;
- selected operation or finding;
- active filters;
- compared plan pair and metric;
- relevant expanded section; and
- optional presentation settings when they materially affect interpretation.

Keep purely personal preferences, such as theme, local unless explicitly
requested.

### 8. Simplify Plan Input and Error Recovery

The main textarea currently uses a long placeholder as its documentation. The
instructions disappear as soon as the user types and do not provide a stable
accessible label.

Recommended behavior:

- Add a persistent "Execution plan" label and short helper text.
- Provide explicit Paste, Upload, and Load Example actions.
- Keep drag-and-drop, but give it a visible drop-zone affordance.
- Show the detected source format before parsing when possible.
- Move the supported-format list into an expandable help section.
- Explain parse errors with the likely cause and a corrective next step.
- Distinguish plan input from metadata-bundle input even if automatic routing
  remains supported.
- Define Oracle abbreviations such as E-Rows, A-Rows, A-Time, PHV, DOP, and SPM
  on first use and in persistent help text rather than relying on hover-only
  tooltips.

### 9. Improve Large-Plan Performance and Orientation

Large plans make both interaction speed and spatial orientation part of the
user experience.

Recommended behavior:

- Virtualize the tabular view above a practical row threshold.
- Keep the operation name and essential identifiers sticky while scrolling.
- Show scroll affordances where panels contain additional content.
- Add a compact minimap or breadcrumb path for the selected tree operation.
- Preserve zoom and position when switching temporarily to details or evidence
  views.
- Provide a reliable "Return to selected operation" action.

## Quick Wins

The following changes are relatively small but immediately valuable:

- Add accessible names to header and ribbon icon buttons.
- Add consistent `focus-visible` rings.
- Label the plan textarea, search field, sliders, and palette selector.
- Split Reset Filters from Reset View.
- Guard clearing and removing annotated plans.
- Show explicit unsaved-annotation text.
- Replace `...` with the ellipsis character where appropriate.
- Add live announcements for parse and metadata-attachment results.
- Replace the placeholder page title and Vite favicon with product identity.
- Add reduced-motion handling.

## Suggested Delivery Sequence

### Phase 1: Safety and Accessibility

- Protect unsaved work.
- Correct accessible names, labels, focus states, and dialog behavior.
- Make the table fully keyboard-operable.
- Separate filter and view resets.

### Phase 2: Guided Diagnosis

- Introduce the Analysis Overview.
- Promote prioritized findings and evidence-driven next actions.
- Improve terminology and input feedback.

### Phase 3: Responsive Workspace

- Add drawer and bottom-sheet behavior.
- Simplify view navigation.
- Persist panel dimensions and improve narrow-screen behavior.

### Phase 4: Collaboration and Scale

- Share reproducible analysis context.
- Virtualize large tables.
- Improve orientation and scroll affordances for large plans.

## Audit Scope and Limitation

These suggestions are based on a source and interaction-structure review of the
current React application. The collaborative preview reached the running app,
but its screenshot and evaluation bridge timed out during the audit. A separate
visual pass is therefore still needed to validate spacing, contrast, touch
targets, responsive breakpoints, and keyboard behavior in a real browser.
