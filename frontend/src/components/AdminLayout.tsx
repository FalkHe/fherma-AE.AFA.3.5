import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import { Link as RouterLink, Outlet, useLocation } from "react-router";

/**
 * Tab value per admin path. The selected tab is derived from the URL rather
 * than held in state, so deep links and the back button stay correct. Phase 2
 * adds `"/admin/review": "review"`.
 */
const tabValueByPath: Record<string, string> = {
  "/admin": "backlog",
};

/**
 * Chrome for the `/admin` subtree, rendered into `AppLayout`'s outlet: a
 * heading plus a secondary tab bar. Admin has two planned sections, which tabs
 * cover with no responsive work and no drawer plumbing.
 */
export function AdminLayout() {
  const { t } = useTranslation();
  const { pathname } = useLocation();

  // `false` (no tab selected) rather than a fallback tab: a path with no tab of
  // its own must not light up an unrelated section.
  const tabValue = tabValueByPath[pathname] ?? false;

  return (
    <>
      <Typography variant="h4" component="h1" gutterBottom>
        {t("admin.title")}
      </Typography>
      <Tabs
        value={tabValue}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{ borderBottom: 1, borderColor: "divider", mb: 3 }}
      >
        <Tab
          value="backlog"
          label={t("admin.tabs.backlog")}
          component={RouterLink}
          to="/admin"
        />
      </Tabs>
      <Outlet />
    </>
  );
}
