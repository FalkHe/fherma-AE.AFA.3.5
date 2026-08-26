import Icon from "@mui/material/Icon";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";

/**
 * Backlog section of the admin area — an empty state until the catalogue-gap
 * reports exist.
 *
 * This is the reusable empty-state pattern for the whole app: centred stack,
 * 56px icon in `text.secondary`, `h6` title, `body2` body capped near 440px,
 * optional action button last (unused here).
 */
export function AdminHomeRoute() {
  const { t } = useTranslation();

  return (
    <Stack
      spacing={1}
      alignItems="center"
      sx={{ py: 8, textAlign: "center", color: "text.secondary" }}
    >
      <Icon sx={{ fontSize: 56 }}>pending_actions</Icon>
      <Typography variant="h6" component="h2" color="text.primary">
        {t("admin.backlog.emptyTitle")}
      </Typography>
      <Typography variant="body2" sx={{ maxWidth: 440 }}>
        {t("admin.backlog.emptyBody")}
      </Typography>
    </Stack>
  );
}
