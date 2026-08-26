import { Route, Routes } from "react-router";

import { AppLayout } from "./components/AppLayout";
import { HomeRoute } from "./routes/HomeRoute";
import { LoginRoute } from "./routes/LoginRoute";
import { RegisterRoute } from "./routes/RegisterRoute";

/**
 * Route table (React Router v7, declarative mode — the package is
 * `react-router`, not `react-router-dom`). Phase 1 adds the consultation,
 * catalogue and admin branches, plus `user`/`admin` guards as layout routes
 * nested under `AppLayout`.
 */
export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="login" element={<LoginRoute />} />
        <Route path="register" element={<RegisterRoute />} />
        <Route index element={<HomeRoute />} />
      </Route>
    </Routes>
  );
}
