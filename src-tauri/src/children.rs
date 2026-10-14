//! Child processes PlayStash must not leave behind when it exits (WP1).
//!
//! Long-running helpers (for example the Ludusavi sidecar from WP3) register
//! their process id here. [`kill_all`] runs on every app exit path that WP1
//! owns (tray Exit, jump-list Exit, the exit confirmation).

use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

static CHILDREN: OnceLock<Mutex<HashSet<u32>>> = OnceLock::new();

fn children() -> &'static Mutex<HashSet<u32>> {
  CHILDREN.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Tracks a child process so it is killed when PlayStash exits.
#[allow(dead_code)] // Used by the feature packages (WP3 ludusavi).
pub(crate) fn register(pid: u32) {
  if let Ok(mut set) = children().lock() {
    set.insert(pid);
  }
}

/// Stops tracking a child process (call it once the process has exited, so
/// a recycled process id is never killed).
#[allow(dead_code)] // Used by the feature packages (WP3 ludusavi).
pub(crate) fn unregister(pid: u32) {
  if let Ok(mut set) = children().lock() {
    set.remove(&pid);
  }
}

/// Kills every tracked child process. Errors are ignored.
pub(crate) fn kill_all() {
  let pids: Vec<u32> = match children().lock() {
    Ok(mut set) => set.drain().collect(),
    Err(_) => return,
  };
  if pids.is_empty() {
    return;
  }
  let targets: Vec<sysinfo::Pid> = pids.iter().map(|pid| sysinfo::Pid::from_u32(*pid)).collect();
  let mut system = sysinfo::System::new();
  system.refresh_processes(sysinfo::ProcessesToUpdate::Some(&targets), true);
  for pid in targets {
    if let Some(process) = system.process(pid) {
      if !process.kill() {
        log::warn!("[children] failed to kill child process {pid}");
      }
    }
  }
}
