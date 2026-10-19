import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import { MotionConfig } from "motion/react";
import { Login } from "./components/Login";
import { Register } from "./components/Register";
import { PageLoader } from "./components/PageLoader";
import { PrereleaseNotice } from "./components/PrereleaseNotice";
import {
  AlertDialogProvider,
  GlobalAlertDialogBridge,
} from "./context/AlertDialogProvider";
import { AppUpdaterProvider } from "./context/AppUpdaterProvider";
import { AuthProvider } from "./context/AuthProvider";
import { DesktopProviders } from "./context/DesktopProviders";
import { DownloadProvider } from "./context/DownloadProvider";
import { GamepadProvider } from "./context/GamepadProvider";
import { IgnoreListProvider } from "./context/IgnoreListProvider";
import { OfflineProvider } from "./context/OfflineProvider";
import { UmuProvider } from "./context/UmuProvider";
// Global styles stay at this point of the import order (after the modules
// above, before the layouts) so the CSS cascade matches the original entry.
import "./index.css";
import DashboardLayout from "./layouts/DashboardLayout";
import FullscreenLayout from "./layouts/FullscreenLayout";
import ProtectedRoute from "./guards/ProtectedRoute";
import { PlaystashUserRoleEnum } from "./api";

// Route-level code splitting keeps the initial bundle small. Pages that are
// only reached after login (library, game view, settings, downloads, ...) are
// loaded lazily so the first paint is fast.
const Administration = lazy(() => import("./pages/Administration"));
const Community = lazy(() => import("./pages/Community"));
const Requests = lazy(() => import("./pages/Requests"));
const Chat = lazy(() => import("./pages/Chat"));
const Library = lazy(() => import("./pages/Library"));
const GameView = lazy(() => import("./pages/GameView"));
const UserProfile = lazy(() => import("./pages/UserProfile"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Settings = lazy(() => import("./pages/Settings"));
const Downloads = lazy(() => import("./pages/Downloads"));

/** The app's provider tree and routes, rendered by `main.tsx`. */
export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <OfflineProvider>
          <IgnoreListProvider>
            <DownloadProvider>
              <AlertDialogProvider>
                <AppUpdaterProvider>
                  <UmuProvider>
                    <GlobalAlertDialogBridge />
                    <PrereleaseNotice />
                    <BrowserRouter>
                      {/* App-wide providers and effects: see context/DesktopProviders.tsx */}
                      <DesktopProviders>
                        <GamepadProvider>
                          <Suspense fallback={<PageLoader />}>
                            <Routes>
                              <Route element={<FullscreenLayout />}>
                                <Route index element={<Login />} />
                                <Route path="register" element={<Register />} />
                              </Route>

                              <Route element={<DashboardLayout />}>
                                <Route
                                  index
                                  path="library"
                                  element={<Library />}
                                />
                                <Route
                                  path="library/:id"
                                  element={<GameView />}
                                />
                                <Route
                                  path="downloads"
                                  element={<Downloads />}
                                />
                                <Route
                                  path="community"
                                  element={<Community />}
                                />
                                <Route path="requests" element={<Requests />} />
                                <Route path="chat" element={<Chat />} />
                                <Route
                                  path="community/:id"
                                  element={<UserProfile />}
                                />
                                <Route path="settings" element={<Settings />} />
                                <Route
                                  path="admin"
                                  element={
                                    <ProtectedRoute
                                      guarded
                                      requiredRole={PlaystashUserRoleEnum._3}
                                    >
                                      <Administration />
                                    </ProtectedRoute>
                                  }
                                />
                              </Route>

                              <Route path="*" element={<NotFound />} />
                            </Routes>
                          </Suspense>
                        </GamepadProvider>
                      </DesktopProviders>
                    </BrowserRouter>
                  </UmuProvider>
                </AppUpdaterProvider>
              </AlertDialogProvider>
            </DownloadProvider>
          </IgnoreListProvider>
        </OfflineProvider>
      </AuthProvider>
    </MotionConfig>
  );
}
