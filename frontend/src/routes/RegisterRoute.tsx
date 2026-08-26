import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router";

import { useRegister } from "../hooks/useAuth";

/** General errors this screen can show; the status-code mapping lands in 1.6. */
type GeneralErrorKey = "auth.errors.serverError";

/** Field-level errors the client can detect on its own. */
type FieldErrorKey =
  | "auth.errors.usernameInvalid"
  | "auth.errors.passwordTooShort"
  | "auth.errors.passwordMismatch";

/** Mirrors the pinned username rule, applied to the lowercase-folded value. */
const USERNAME_PATTERN = /^[a-z0-9_.-]+$/;
const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 32;
const PASSWORD_MIN_LENGTH = 8;

function isUsernameValid(value: string): boolean {
  // The backend stores `username.strip().lower()`, so the folded form — not
  // what was typed — is what has to satisfy the rule.
  const normalized = value.trim().toLowerCase();

  return (
    normalized.length >= USERNAME_MIN_LENGTH &&
    normalized.length <= USERNAME_MAX_LENGTH &&
    USERNAME_PATTERN.test(normalized)
  );
}

/**
 * Registration screen, public route inside `AppLayout`.
 *
 * Validation runs on submit only — no blur or keystroke checks — which keeps
 * the controlled inputs trivial and avoids scolding someone mid-word. The first
 * invalid field takes focus so keyboard users land on the problem.
 */
export function RegisterRoute() {
  const { t } = useTranslation();
  const register = useRegister();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [generalError, setGeneralError] = useState<GeneralErrorKey | null>(null);
  const [usernameError, setUsernameError] = useState<FieldErrorKey | null>(null);
  const [passwordError, setPasswordError] = useState<FieldErrorKey | null>(null);
  const [confirmPasswordError, setConfirmPasswordError] = useState<FieldErrorKey | null>(
    null,
  );

  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);

  const isPending = register.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGeneralError(null);

    const nextUsernameError: FieldErrorKey | null = isUsernameValid(username)
      ? null
      : "auth.errors.usernameInvalid";
    const nextPasswordError: FieldErrorKey | null =
      password.length >= PASSWORD_MIN_LENGTH ? null : "auth.errors.passwordTooShort";
    const nextConfirmPasswordError: FieldErrorKey | null =
      confirmPassword === password ? null : "auth.errors.passwordMismatch";

    setUsernameError(nextUsernameError);
    setPasswordError(nextPasswordError);
    setConfirmPasswordError(nextConfirmPasswordError);

    if (nextUsernameError !== null) {
      usernameRef.current?.focus();
      return;
    }
    if (nextPasswordError !== null) {
      passwordRef.current?.focus();
      return;
    }
    if (nextConfirmPasswordError !== null) {
      confirmPasswordRef.current?.focus();
      return;
    }

    register.mutate({ username, password });
  }

  return (
    <Box sx={{ display: "flex", justifyContent: "center", pt: { xs: 2, sm: 8 } }}>
      <Paper
        component="form"
        onSubmit={handleSubmit}
        sx={{ p: 4, width: "100%", maxWidth: 400 }}
      >
        <Stack spacing={3}>
          <Typography variant="h5" component="h1">
            {t("auth.register.title")}
          </Typography>
          {generalError !== null && <Alert severity="error">{t(generalError)}</Alert>}
          <TextField
            label={t("auth.fields.username")}
            name="username"
            autoComplete="username"
            autoFocus
            required
            fullWidth
            disabled={isPending}
            error={usernameError !== null}
            helperText={
              usernameError !== null ? t(usernameError) : t("auth.register.usernameHint")
            }
            inputRef={usernameRef}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <TextField
            label={t("auth.fields.password")}
            name="password"
            type="password"
            autoComplete="new-password"
            required
            fullWidth
            disabled={isPending}
            error={passwordError !== null}
            helperText={
              passwordError !== null ? t(passwordError) : t("auth.register.passwordHint")
            }
            inputRef={passwordRef}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <TextField
            label={t("auth.fields.confirmPassword")}
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            fullWidth
            disabled={isPending}
            error={confirmPasswordError !== null}
            helperText={
              confirmPasswordError !== null ? t(confirmPasswordError) : undefined
            }
            inputRef={confirmPasswordRef}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
          <Button
            type="submit"
            variant="contained"
            fullWidth
            disabled={isPending}
            startIcon={
              isPending ? <CircularProgress size={20} color="inherit" /> : undefined
            }
          >
            {t("auth.register.submit")}
          </Button>
          <Typography variant="body2">
            {t("auth.register.haveAccount")}{" "}
            <Link component={RouterLink} to="/login">
              {t("auth.register.loginLink")}
            </Link>
          </Typography>
        </Stack>
      </Paper>
    </Box>
  );
}
