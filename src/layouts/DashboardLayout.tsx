import { Navbar } from "@components/Navbar";
import { Sidebar } from "@components/Sidebar";
import { LibraryRail } from "@components/LibraryRail";
import { SidebarLayout } from "@tw/sidebar-layout";
import { PageLoader } from "@/components/PageLoader";
import { Suspense } from "react";
import { matchPath, useLocation, useOutlet } from "react-router";
import ProtectedRoute from "../guards/ProtectedRoute";
import { useGameTimeTracker } from "@/hooks/useGameTimeTracker";
import { BigPictureShell } from "@/components/BigPicture";
import { useBigPicture } from "@/utils/bigPicture";

interface DashboardLayoutProps {
  guarded?: boolean; // optional boolean to toggle guarding, default true
}

export default function DashboardLayout({
  guarded = true,
}: DashboardLayoutProps) {
  const location = useLocation();
  const bigPicture = useBigPicture();
  // Keep navigation immediate; the library rail lives outside this outlet.
  const outlet = useOutlet();
  const isGameViewRoute = Boolean(
    matchPath({ path: "/library/:id" }, location.pathname),
  );
  const isFullBleed = isGameViewRoute;
  const isLibraryRoute = location.pathname === "/library" || isGameViewRoute;

  useGameTimeTracker();

  if (bigPicture)
    return (
      <ProtectedRoute guarded={guarded}>
        <BigPictureShell>
          <Suspense fallback={<PageLoader />}>{outlet}</Suspense>
        </BigPictureShell>
      </ProtectedRoute>
    );

  return (
    <ProtectedRoute guarded={guarded}>
      <SidebarLayout
        sidebar={<Sidebar />}
        navbar={<Navbar />}
        secondaryNavigation={isLibraryRoute ? <LibraryRail /> : undefined}
        fullWidth={isFullBleed}
        fullBleed={isFullBleed}
      >
        <div key={location.pathname} className="min-h-full">
          <Suspense fallback={<PageLoader />}>{outlet}</Suspense>
        </div>
      </SidebarLayout>
    </ProtectedRoute>
  );
}
