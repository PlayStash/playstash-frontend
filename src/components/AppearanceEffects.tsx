import { useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  reapplyStoredTheme,
  setShowDefaultTheme,
  useActiveTheme,
} from "@/themes/themeManager";
import {
  PROFILE_CHANGED_EVENT,
  profileIdFromEvent,
  setActiveProfileId,
} from "@/utils/profileScope";
import { playStartupSound, stopStartupSound } from "@/utils/startupSound";

/**
 * App-wide appearance effects (mounted through DesktopProviders):
 * - re-applies the profile's theme on `playstash:profile-changed`
 * - shows the default theme after logout and the stored one after login
 * - plays the startup sound once after the first login of the session
 */
export function AppearanceEffects() {
  const { user, bootstrapping } = useAuth();
  const wasLoggedInRef = useRef(false);
  const soundPlayedRef = useRef(false);

  useEffect(() => {
    const onProfileChanged = (event: Event) => {
      setActiveProfileId(profileIdFromEvent(event));
      void reapplyStoredTheme();
    };
    window.addEventListener(PROFILE_CHANGED_EVENT, onProfileChanged);
    return () =>
      window.removeEventListener(PROFILE_CHANGED_EVENT, onProfileChanged);
  }, []);

  useEffect(() => {
    if (bootstrapping) return;
    const loggedIn = !!user;
    if (loggedIn && !wasLoggedInRef.current) {
      setShowDefaultTheme(false);
      if (!soundPlayedRef.current) {
        soundPlayedRef.current = true;
        void playStartupSound();
      }
    } else if (!loggedIn && wasLoggedInRef.current) {
      // Logout resets to the default theme; the stored theme is kept.
      setShowDefaultTheme(true);
      void stopStartupSound();
    }
    wasLoggedInRef.current = loggedIn;
  }, [user, bootstrapping]);

  return <ThemeOverlay />;
}

/** The active theme's overlay image (bottom-right, 300×300, 15 % opacity). */
export function ThemeOverlay() {
  const { overlayUrl } = useActiveTheme();
  if (!overlayUrl) return null;
  return (
    <img
      src={overlayUrl}
      alt=""
      aria-hidden="true"
      draggable={false}
      className="pointer-events-none fixed right-0 bottom-0 z-40 size-[300px] object-contain opacity-15 select-none"
    />
  );
}
