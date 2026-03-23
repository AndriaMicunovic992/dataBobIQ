# Dashboard Redesign Plan

## Concept

Replace the broken waterfall-centric ScenarioView with a **dashboard system** built on top of the working pivot infrastructure.

### User Flow
1. **Actuals tab** — stays as-is for ad-hoc data exploration (FieldManager → PivotTable)
2. **Save to Dashboard** — user saves a pivot config as a named widget (table or card)
3. **Dashboard tab** — shows saved widgets in a grid layout
4. **Scenario overlay** — any widget can toggle a scenario to compare actuals vs scenario side-by-side
5. **Scenario management** — create/edit via AI chat (always available) or manual rule editing in a panel

### Widget Types
- **Table** — same as current PivotTable (rows, columns, measures, filters)
- **Card** — single aggregated value (one measure + optional filters), shows big number

---

## Implementation

### Phase 1: Backend — Dashboard Model + API

**New DB model: `DashboardWidget`** (in `models/metadata.py`)

```
id: UUID PK
model_id: FK → models
name: str (e.g. "Revenue by Region")
widget_type: str ("table" | "card")
config: JSONB  ← stores the full pivot config:
  {
    dataset_id, row_dimensions, column_dimension,
    measures: [{field, aggregation}],
    filters: {col: [vals]},
    join_dimensions: {field: dataset_id},
    sort_by, limit
  }
position: JSONB ← grid placement: {x, y, w, h}
created_at, updated_at
```

**New Alembic migration** for `dashboard_widgets` table.

**New API file: `api/dashboard.py`**
- `POST /models/{model_id}/dashboard/widgets` — create widget
- `GET /models/{model_id}/dashboard/widgets` — list all widgets
- `PUT /dashboard/widgets/{widget_id}` — update config or position
- `DELETE /dashboard/widgets/{widget_id}` — delete widget
- `PUT /models/{model_id}/dashboard/layout` — batch-update positions

**Widget data endpoint** — reuses existing `POST /pivot` endpoint. No new analytics endpoint needed. For scenario comparison, pass `scenario_ids` in the pivot request (already supported by the pivot engine).

### Phase 2: Frontend — Dashboard Tab

**New file: `components/DashboardView.jsx`**
- Grid layout (CSS Grid, simple row/col positioning from widget.position)
- Renders each widget as either `DashboardTable` or `DashboardCard`
- "Add Widget" button opens a config modal (reuses FieldManager + FilterManager)
- Each widget has a header bar with: name, edit button, scenario toggle dropdown, delete

**New file: `components/DashboardCard.jsx`**
- Calls `usePivot()` with the widget's config (no row_dimensions → returns single total row)
- Renders: big number + label + optional delta badge when scenario is active

**Reuse: `PivotTable.jsx`** for table widgets — pass `pivotData` directly

**Dashboard state:**
- `useDashboardWidgets(modelId)` hook — fetches widget list
- Each widget independently calls `usePivot(config)` to get its data
- Scenario selection is per-widget or global toggle

### Phase 3: Scenario Integration

**On any dashboard widget**, user can pick a scenario from a dropdown. This adds `scenario_ids: [selectedScenarioId]` to the widget's pivot request. The pivot engine already handles this — it creates a COALESCE merge CTE and adds `scenario_amount` + `variance_amount` columns to the response.

The existing ScenarioView sidebar (scenario list + rule form) becomes a **panel/drawer** accessible from the dashboard, not a separate tab. Or scenarios are created entirely via AI chat.

### Phase 4: Cleanup

- Remove the broken waterfall/variance endpoints and `WaterfallChart.jsx`
- Remove the old `ScenarioView.jsx` (replace with dashboard)
- Keep scenario CRUD + recompute endpoints (used by chat agent + dashboard)

---

## Files to Create/Modify

### Backend (create)
- `backend/app/models/metadata.py` — add `DashboardWidget` model
- `backend/app/schemas/dashboard.py` — request/response schemas
- `backend/app/api/dashboard.py` — CRUD endpoints
- `backend/alembic/versions/xxx_add_dashboard_widgets.py` — migration

### Backend (modify)
- `backend/app/main.py` — register dashboard router

### Frontend (create)
- `frontend/src/components/DashboardView.jsx` — main dashboard grid
- `frontend/src/components/DashboardCard.jsx` — single-value card widget
- `frontend/src/components/WidgetConfigModal.jsx` — config editor (reuses FieldManager/FilterManager)
- `frontend/src/hooks/useDashboard.js` — React Query hooks

### Frontend (modify)
- `frontend/src/App.jsx` — add Dashboard tab, wire routing
- `frontend/src/api.js` — add dashboard API functions
- `frontend/src/components/ScenarioView.jsx` — simplify to scenario list + rules panel only (no more waterfall/variance table)

---

## What This Solves

1. **Waterfall problem eliminated** — no custom variance SQL; reuses proven pivot engine with `scenario_ids`
2. **Cross-dataset JOINs just work** — pivot engine already handles `join_dimensions`
3. **Generic and composable** — any table/card config can show any scenario
4. **Persistent** — dashboard configs saved to DB, not lost on refresh
5. **Extensible** — easy to add chart widgets later (PivotChart already exists)
