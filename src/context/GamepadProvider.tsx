import { useEffect, useMemo, useState, type ReactNode } from "react";
import GamepadNavigator from "@/components/GamepadNavigator";
import {
  startGamepadInput,
  stopGamepadInput,
  subscribeGamepadConnection,
} from "@/utils/gamepad";
import { GamepadContext } from "@/context/GamepadContext";

/**
 * Polls the Web Gamepad API for the app's lifetime and mounts the global
 * navigation engine. Must live inside the router so the engine can navigate.
 */
export function GamepadProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeGamepadConnection(setConnected);
    startGamepadInput();
    return () => {
      unsubscribe();
      stopGamepadInput();
    };
  }, []);

  const value = useMemo(() => ({ connected }), [connected]);

  return (
    <GamepadContext.Provider value={value}>
      <GamepadNavigator />
      {children}
    </GamepadContext.Provider>
  );
}
