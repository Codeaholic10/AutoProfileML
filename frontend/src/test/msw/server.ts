/** Shared MSW server for Vitest. Lifecycle is wired in `src/test/setup.ts`. */

import { setupServer } from "msw/node";

import { handlers } from "./handlers";

export const server = setupServer(...handlers);
