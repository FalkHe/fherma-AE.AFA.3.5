import { Route, Routes } from "react-router";

import { AdminLayout } from "./components/AdminLayout";
import { AppLayout } from "./components/AppLayout";
import { AdminHomeRoute } from "./routes/admin/AdminHomeRoute";
import { HomeRoute } from "./routes/HomeRoute";
import { LoginRoute } from "./routes/LoginRoute";
import { RegisterRoute } from "./routes/RegisterRoute";
import { RequireAdmin } from "./routes/RequireAdmin";
import { RequireAuth } from "./routes/RequireAuth";

/**
 * Route table (React Router v7, declarative mode — the package is
 * `react-router`, not `react-router-dom`).
 *
 * A single `AppLayout` wraps everything, including the public auth pages, so
 * the AppBar and theme toggle never disappear; `AppLayout` decides for itself
 * whether to show the nav and account block. The guards are layout routes, so
 * every screen nested under them inherits the loading spinner and the redirect
 * without repeating either. Phase 1 adds the consultation and catalogue
 * branches under `RequireAuth`.
 */
export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="login" element={<LoginRoute />} />
        <Route path="register" element={<RegisterRoute />} />
        <Route element={<RequireAuth />}>
          <Route index element={<HomeRoute />} />
          <Route element={<RequireAdmin />}>
            <Route path="admin" element={<AdminLayout />}>
              <Route index element={<AdminHomeRoute />} />
            </Route>
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}
