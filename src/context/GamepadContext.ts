import { createContext, useContext } from "react";

export interface GamepadContextValue {
  /** Whether at least one gamepad is currently connected. */
  connected: boolean;
}

export const GamepadContext = createContext<GamepadContextValue | null>(null);

export function useGamepad(): GamepadContextValue {
  const context = useContext(GamepadContext);
  if (!context) {
    throw new Error("useGamepad must be used within a GamepadProvider");
  }
  return context;
}
