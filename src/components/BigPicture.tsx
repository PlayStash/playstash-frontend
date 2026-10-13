import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useGamepad } from "@/context/GamepadContext";
import { setBigPicture, useBigPicture } from "@/utils/bigPicture";
import { Button } from "./tailwind/button";
import { Logo } from "./Logo";
export function BigPictureButton() {
  const active = useBigPicture();
  const [error, setError] = useState("");
  return (
    <div className="space-y-1">
      <Button
        outline
        onClick={() =>
          void setBigPicture(!active).catch(() =>
            setError(
              "Fullscreen is unavailable. Big Picture layout is still active.",
            ),
          )
        }
      >
        {active ? "Exit Big Picture" : "Big Picture"}
      </Button>
      {error && (
        <p role="status" className="text-xs text-ps-muted">
          {error}
        </p>
      )}
    </div>
  );
}
export function BigPictureShell({ children }: { children: ReactNode }) {
  const { connected } = useGamepad();
  return (
    <div
      data-big-picture="true"
      className="flex h-full flex-col bg-ps-bg text-ps-text"
    >
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-ps-line px-5 py-4">
        <Logo variant="sidebar" height="h-6" />
        <nav
          aria-label="Big Picture navigation"
          className="flex flex-wrap gap-3"
        >
          {[
            ["/library", "Library"],
            ["/downloads", "Downloads"],
            ["/requests", "Requests"],
            ["/chat", "Chat"],
            ["/settings", "Settings"],
          ].map(([href, label]) => (
            <Button key={href} outline href={href}>
              {label}
            </Button>
          ))}
          <BigPictureButton />
        </nav>
      </header>
      <div className="flex-1 overflow-auto p-4 sm:p-8" data-scroll-container="">
        {children}
      </div>
      <footer className="flex flex-wrap justify-between gap-3 border-t border-ps-line px-5 py-3 text-sm text-ps-muted">
        <span>
          {connected
            ? "Controller connected"
            : "Connect a controller or use the keyboard"}
        </span>
        <span>
          D-pad / left stick: navigate · A: select · B: back · Right stick:
          scroll · Start: exit
        </span>
        <Link to="/library" className="text-ps-accent-strong">
          Library
        </Link>
      </footer>
    </div>
  );
}
