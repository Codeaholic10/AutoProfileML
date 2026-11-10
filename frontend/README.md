# AutoProfileML — Frontend

Next.js 16 (App Router, Turbopack) dashboard for the AutoProfileML API. Product scope,
architecture, and the phase-by-phase roadmap live at the repo root: [PRD.md](../PRD.md),
[ARCHITECTURE.md](../ARCHITECTURE.md), [PLAN.md](../PLAN.md). Contributor rules are in
[CLAUDE.md](../CLAUDE.md).

## Commands

```bash
npm install
npm run dev          # http://localhost:3000
npm run lint
npm run typecheck
npm test             # vitest run
npm run test:watch
npm run build
```

The backend must be running at `http://localhost:8000` for data views (phase 3 onward).

## Configuration

Copy [.env.local.example](.env.local.example) to `.env.local`. Only `NEXT_PUBLIC_*` variables
reach the browser — never put secrets here.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` | FastAPI base URL |
| `NEXT_PUBLIC_MAX_UPLOAD_MB` | `200` | Client-side upload ceiling; keep it equal to the backend's `AUTOPROFILEML_MAX_UPLOAD_MB` |

## Toolchain note: TypeScript 7 and ESLint

The project pins TypeScript `7.0.2`, which ships the native compiler without the compiler API
that `typescript-eslint` needs. The two are installed side-by-side per the TypeScript 7
release notes:

- `@typescript/native` (aliased to `typescript@7.0.2`) provides the `tsc` binary used by
  `npm run typecheck` and `next build`.
- `typescript` (aliased to `@typescript/typescript6`) provides the 6.0 compiler API that
  `eslint-config-next` loads.

Do not replace either alias with a plain `typescript` version — `npm run lint` or
`npm run typecheck` will break.
