import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";

import { HealthStatus } from "../components/HealthStatus";

/**
 * Placeholder home route, currently the shell plus the backend health widget.
 * The consultation entry point replaces the placeholder copy in Phase 1.
 */
export function HomeRoute() {
  const { t } = useTranslation();

  return (
    <Stack spacing={2} alignItems="flex-start">
      <Typography variant="h4" component="h1">
        {t("home.heading")}
      </Typography>
      <Typography color="text.secondary">{t("app.tagline")}</Typography>
      <Typography>{t("home.body")}</Typography>
      <HealthStatus />
    </Stack>
  );
}
