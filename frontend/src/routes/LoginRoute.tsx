import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import CircularProgress from "@mui/material/CircularProgress";
import FormControlLabel from "@mui/material/FormControlLabel";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router";

import { useLogin } from "../hooks/useAuth";

/** General errors this screen can show; the status-code mapping lands in 1.6. */
type GeneralErrorKey = "auth.errors.invalidCredentials" | "auth.errors.serverError";

/**
 * Sign-in screen, public route inside `AppLayout`.
 *
 * Client-side validation is deliberately limited to the browser-level
 * `required` prop: length and charset rules are the server's call on login, so
 * a stricter client check could only ever reject a credential the backend would
 * have accepted. Registration is where the pinned rules are mirrored.
 */
export function LoginRoute() {
  const { t } = useTranslation();
  const login = useLogin();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [generalError, setGeneralError] = useState<GeneralErrorKey | null>(null);

  const isPending = login.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGeneralError(null);
    login.mutate({ username, password, rememberMe });
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
            {t("auth.login.title")}
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
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <TextField
            label={t("auth.fields.password")}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            fullWidth
            disabled={isPending}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <FormControlLabel
            control={
              <Checkbox
                name="rememberMe"
                checked={rememberMe}
                disabled={isPending}
                onChange={(event) => setRememberMe(event.target.checked)}
              />
            }
            label={t("auth.login.rememberMe")}
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
            {t("auth.login.submit")}
          </Button>
          <Typography variant="body2">
            {t("auth.login.noAccount")}{" "}
            <Link component={RouterLink} to="/register">
              {t("auth.login.registerLink")}
            </Link>
          </Typography>
        </Stack>
      </Paper>
    </Box>
  );
}
