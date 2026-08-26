// STUB — replaced wholesale in step 1.6. Shape is pinned by
// docs/roadmap/phase-1/shared-knowledge.md; do not change it.
//
// Steps 1.2/1.4 build the auth screens and guards against this file so the
// frontend track needs no backend. Step 1.6 swaps the internals for real
// `openapi-fetch` calls against `/auth/*` — the exported names, call
// signatures and return shapes below are the contract that makes that swap
// invisible to components.

import { useMutation, type UseMutationResult } from "@tanstack/react-query";

/** `UserResponse` from the pinned auth API contract. */
export interface AuthUser {
  id: string;
  username: string;
  role: "user" | "admin";
}

/** Request body of `POST /auth/login`. */
export interface LoginInput {
  username: string;
  password: string;
  rememberMe: boolean;
}

/** Request body of `POST /auth/register`. */
export interface RegisterInput {
  username: string;
  password: string;
}

const STUB_USER = { id: "0".repeat(26), username: "dev", role: "user" as const };

/**
 * Signed-in user. Backed by the `["auth", "me"]` query from step 1.6; the stub
 * resolves synchronously to a fixed user so guards and layouts can be built
 * and exercised without a backend.
 */
export function useAuth(): {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
} {
  return { user: STUB_USER, isLoading: false, isAuthenticated: true };
}

/**
 * Signs in. A real mutation object (not a hand-rolled fake), so consumers get
 * a truthful `isPending` and step 1.6 only replaces the `mutationFn`.
 */
export function useLogin(): UseMutationResult<AuthUser, Error, LoginInput> {
  return useMutation<AuthUser, Error, LoginInput>({
    mutationFn: () => Promise.resolve(STUB_USER),
  });
}

/**
 * Registers and — from step 1.6 — chains the automatic login with the same
 * credentials (`rememberMe: false`) that the UI spec requires, which is why
 * this resolves to the authenticated user rather than the created one. All
 * request logic lives here; the screens only await this mutation.
 */
export function useRegister(): UseMutationResult<AuthUser, Error, RegisterInput> {
  return useMutation<AuthUser, Error, RegisterInput>({
    mutationFn: () => Promise.resolve(STUB_USER),
  });
}

/** Signs out. Cache clearing and navigation stay with the caller. */
export function useLogout(): UseMutationResult<void, Error, void> {
  return useMutation<void, Error, void>({
    mutationFn: () => Promise.resolve(),
  });
}
