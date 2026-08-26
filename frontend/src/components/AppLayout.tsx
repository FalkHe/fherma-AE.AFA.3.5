import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Divider from "@mui/material/Divider";
import Icon from "@mui/material/Icon";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink, Outlet } from "react-router";

import { useAuth, useLogout } from "../hooks/useAuth";
import { ThemeModeToggle } from "./ThemeModeToggle";

/**
 * Chrome shared by every route: the top bar and the main content container.
 * Routes render into the `Outlet`.
 *
 * Navigation and the account menu render only for a signed-in user, which is
 * what lets the public auth pages share this layout instead of needing one of
 * their own. Two destinations do not justify a drawer, so the nav is inline in
 * the toolbar and still fits a phone.
 */
export function AppLayout() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const logout = useLogout();
  const [accountAnchorEl, setAccountAnchorEl] = useState<HTMLElement | null>(null);

  function handleSignOut() {
    // Step 1.6 replaces the stub mutation with the real `POST /auth/logout` and
    // adds `queryClient.clear()` + `navigate("/login", { replace: true })` on
    // settle (success or 401), per ui-spec §4. Until then this is a no-op.
    logout.mutate();
    setAccountAnchorEl(null);
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <AppBar position="static">
        <Toolbar>
          <Typography
            variant="h6"
            component={RouterLink}
            to="/"
            sx={{ flexGrow: 1, color: "inherit", textDecoration: "none" }}
          >
            {t("app.name")}
          </Typography>
          {user !== null && (
            <Box sx={{ display: "flex", gap: 1, mr: 1 }}>
              <Button color="inherit" component={RouterLink} to="/">
                {t("nav.home")}
              </Button>
              {user.role === "admin" && (
                <Button color="inherit" component={RouterLink} to="/admin">
                  {t("nav.admin")}
                </Button>
              )}
            </Box>
          )}
          <ThemeModeToggle />
          {user !== null && (
            <>
              <Button
                color="inherit"
                aria-label={t("account.menuLabel")}
                aria-haspopup="menu"
                aria-expanded={accountAnchorEl !== null}
                startIcon={<Icon>account_circle</Icon>}
                endIcon={<Icon>arrow_drop_down</Icon>}
                onClick={(event) => setAccountAnchorEl(event.currentTarget)}
              >
                {/* Hidden on xs so the trigger degrades to icon-only; the menu
                    repeats the name for those viewports. */}
                <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
                  {user.username}
                </Box>
              </Button>
              <Menu
                anchorEl={accountAnchorEl}
                open={accountAnchorEl !== null}
                onClose={() => setAccountAnchorEl(null)}
                aria-label={t("account.menuLabel")}
              >
                <MenuItem disabled>
                  {t("account.signedInAs", { username: user.username })}
                </MenuItem>
                <Divider />
                <MenuItem onClick={handleSignOut} disabled={logout.isPending}>
                  <ListItemIcon>
                    <Icon fontSize="small">logout</Icon>
                  </ListItemIcon>
                  <ListItemText>{t("account.signOut")}</ListItemText>
                </MenuItem>
              </Menu>
            </>
          )}
        </Toolbar>
      </AppBar>
      <Container component="main" maxWidth="lg" sx={{ flexGrow: 1, py: 4 }}>
        <Outlet />
      </Container>
    </Box>
  );
}
