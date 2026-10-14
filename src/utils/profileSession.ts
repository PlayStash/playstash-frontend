import { isTauriApp } from "@/utils/tauri";

/**
 * Native clean-up when the active desktop profile ends (logout, Change
 * Profile, switching to another profile):
 * - `desktop_commands_not_ready`: CLI/deep-link commands queue again until
 *   the next login (WP1)
 * - `reset_jump_list_games`: the jump list must not show the previous
 *   account's games (WP1)
 * - `stop_game_time_tracker`: playtime is credited to the logged-in account
 * - `kill_child_processes`: helper processes (Ludusavi) of the old session
 * - `discord_clear_presence`: no "playing" status for a signed-out account
 *
 * Together with the React effects that follow the signed-in user (community
 * socket, Discord presence, jump list, download cancellation in
 * `SessionEndEffect`) this mirrors the WPF `MainWindow.Dispose`. Failures are
 * ignored (simulated desktop mode).
 */
export async function runProfileSwitchEffects(): Promise<void> {
  if (!isTauriApp()) return;
  let invoke: typeof import("@tauri-apps/api/core").invoke;
  try {
    ({ invoke } = await import("@tauri-apps/api/core"));
  } catch {
    return;
  }
  const calls: [string, Record<string, unknown>?][] = [
    ["desktop_commands_not_ready"],
    ["reset_jump_list_games"],
    ["stop_game_time_tracker", { reason: "profile switch or logout" }],
    ["kill_child_processes"],
    ["discord_clear_presence"],
  ];
  for (const [command, args] of calls) {
    try {
      await invoke(command, args);
    } catch {
      /* simulated desktop mode */
    }
  }
}
