# Frontend Vite/workspace migration plan

## Context

PR #21 introduced `frontend-shared` for non-React constants/API helpers. Keep it non-React during the CRA-to-Vite migration to avoid duplicate React/dispatcher issues from symlinked local packages.

## Decisions

- Use root npm workspaces for `dashboard`, `network-survey`, `frontend-shared`, and `api`.
- Migrate `network-survey` first because it is the smaller respondent app.
- Preserve local ports: API 3000, dashboard 3001, survey 3002.
- Preserve existing CRA API env names (`REACT_APP_API_PROTOCOL/HOST/PORT`) during transition. Vite configs expose both `VITE_*` and `REACT_APP_*` prefixes.
- Keep `frontend-shared` non-React. Convert it to ESM so Vite can consume it safely as workspace source.
- Add `resolve.dedupe` for `react` and `react-dom` in Vite apps before moving any React code into shared packages.

## Phases

1. Workspace foundation
   - Add root npm workspaces.
   - Keep existing root scripts working.
   - Include `api` only as a workspace package; do not change backend behavior.

2. Migrate `network-survey` from CRA to Vite ✅
   - Replace CRA scripts with Vite scripts.
   - Add `vite.config.mjs` with port 3002, `REACT_APP_` env prefix support, React dedupe, and SVGR for existing SVG component imports.
   - Add project-root `index.html` equivalent to the CRA template.
   - Pass Vite env values into the shared API helper instead of reading `process.env` in browser code.
   - Validated build/test placeholder and smoke-tested the dev server.

3. Migrate `dashboard` from CRA to Vite ✅
   - Repeat Vite setup on port 3001.
   - Handle Toolpad/MUI/SurveyJS Creator/D3/DataGrid compatibility.
   - Consider manual chunking for heavy dependencies only if needed for build stability/performance; avoid feature rewrites.
   - Validated dashboard build/tests, survey build, and full local dev startup with dashboard and survey on Vite.

4. Shared frontend unification
   - Only after both Vite apps build/run under workspaces, cautiously evaluate moving React components/helpers with React dedupe verified.
