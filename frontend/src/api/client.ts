import createClient from "openapi-fetch";

import type { paths } from "./schema";

/**
 * Typed HTTP client for the backend API.
 *
 * Every path, parameter and response body is inferred from `schema.d.ts`,
 * which is generated from the backend's own OpenAPI document (`pnpm
 * generate:api`). Hand-written request/response types are therefore never
 * needed — and a backend change that the frontend has not followed shows up as
 * a type error rather than a runtime surprise.
 */

// Cross-origin in development (Vite on :5173 calling the API on :8000), same
// origin in production. Missing here means "same origin", which is the correct
// production default.
const baseUrl = import.meta.env.VITE_API_URL ?? "";

export const apiClient = createClient<paths>({
  baseUrl,
  // Session authentication is cookie-based (see architecture.md), so the
  // cookie must ride along on cross-origin development calls as well. Set as
  // a client default rather than in the middleware below because `credentials`
  // is immutable on an already-constructed `Request`: mutating it would mean
  // rebuilding every request object, including ones carrying a body.
  credentials: "include",
});

apiClient.use({
  onRequest() {
    // Phase 1 slot: read the CSRF cookie and set the matching request header
    // on unsafe methods here, e.g.
    //   if (!SAFE_METHODS.has(request.method)) {
    //     request.headers.set("X-CSRF-Token", readCsrfCookie());
    //   }
    //   return request;
    // Returning nothing leaves the request untouched.
  },
});
