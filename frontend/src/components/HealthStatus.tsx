import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Icon from "@mui/material/Icon";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";

import { useHealth } from "../hooks/useHealth";

/**
 * Backend liveness indicator.
 *
 * Also the first consumer of the generated API client, so it doubles as the
 * end-to-end proof of the schema → types → typed call → UI loop, including the
 * cross-origin CORS path the cookie session needs in Phase 1.
 */
export function HealthStatus() {
  const { t } = useTranslation();
  const { isPending, isError } = useHealth();

  if (isPending) {
    return (
      <Chip
        variant="outlined"
        icon={<CircularProgress size={14} aria-hidden />}
        label={t("health.checking")}
        role="status"
      />
    );
  }

  if (isError) {
    return (
      <Stack spacing={0.5} alignItems="flex-start">
        <Chip
          color="error"
          variant="outlined"
          icon={
            <Icon fontSize="small" aria-hidden>
              error
            </Icon>
          }
          label={t("health.unreachable")}
          role="status"
        />
        <Typography variant="body2" color="text.secondary">
          {t("health.unreachableHint")}
        </Typography>
      </Stack>
    );
  }

  return (
    <Chip
      color="success"
      variant="outlined"
      icon={
        <Icon fontSize="small" aria-hidden>
          check_circle
        </Icon>
      }
      label={t("health.ok")}
      role="status"
    />
  );
}
