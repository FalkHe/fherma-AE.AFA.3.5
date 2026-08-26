import Alert from "@mui/material/Alert";
import Icon from "@mui/material/Icon";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink, Outlet, useLocation } from "react-router";

import { useServerEventsStatus } from "../hooks/useServerEvents";

/**
 * How long the event stream may be down before the admin is told about it.
 *
 * The status starts out `false` (nothing is connected until the stream opens)
 * and a network blip reconnects on its own within a second or two, so warning
 * immediately would mean a banner flashing on every page load.
 */
const DISCONNECT_GRACE_MS = 5_000;

/**
 * The "live updates are down" warning, after the grace period has passed.
 *
 * The grace timer lives in a component that the layout mounts only while the
 * stream is down, which is what resets it: a reconnect unmounts this and takes
 * the elapsed grace with it, so the next interruption is granted its own five
 * seconds of silence.
 */
function LiveDisconnectAlert() {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setIsVisible(true), DISCONNECT_GRACE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  if (!isVisible) {
    return null;
  }

  return (
    <Alert severity="warning" icon={<Icon>sync_problem</Icon>} sx={{ mb: 2 }}>
      {t("admin.live.disconnected")}
    </Alert>
  );
}

/**
 * Chrome for the `/admin` subtree, rendered into `AppLayout`'s outlet: a
 * heading plus a secondary tab bar. Admin has one section — the review screen
 * is a drill-down of the backlog, not a section of its own — so the single tab
 * stays selected across `/admin` and `/admin/models/:id`.
 */
export function AdminLayout() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { connected } = useServerEventsStatus();

  // Prefix match rather than an exact path: every admin screen is reached from
  // the backlog, so the tab must stay lit on the review drill-down too.
  const tabValue = pathname.startsWith("/admin") ? "backlog" : false;

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
      {!connected && <LiveDisconnectAlert />}
      <Outlet />
    </>
  );
}
