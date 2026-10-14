//! Helper child processes (ludusavi for cloud saves) that must never outlive
//! PlayStash, the counterpart of the WPF client's `ProcessShepherd`.
//!
//! - Windows: every child is assigned to one job object created with
//!   `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. The handle is only closed when
//!   PlayStash exits (normally or by a crash), which kills the children.
//! - Linux: children get `PR_SET_PDEATHSIG = SIGKILL`.
//! - All platforms: children are registered by pid. `kill_all()` kills them
//!   (exit and logout paths call it), and on Unix it also runs from an
//!   `atexit` handler, which covers macOS where no parent-death signal exists.

use std::collections::HashSet;
use std::process::{Command, Output, Stdio};
use std::sync::{Mutex, OnceLock};

fn registry() -> &'static Mutex<HashSet<u32>> {
  static REGISTRY: OnceLock<Mutex<HashSet<u32>>> = OnceLock::new();
  REGISTRY.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Tracks a child process so `kill_all()` can stop it.
pub(crate) fn register(pid: u32) {
  if let Ok(mut pids) = registry().lock() {
    pids.insert(pid);
  }
}

/// Stops tracking a child that exited on its own.
pub(crate) fn unregister(pid: u32) {
  if let Ok(mut pids) = registry().lock() {
    pids.remove(&pid);
  }
}

/// Kills every tracked child process (best effort, never panics).
pub(crate) fn kill_all() {
  let pids: Vec<u32> = match registry().lock() {
    Ok(mut pids) => pids.drain().collect(),
    Err(_) => return,
  };
  for pid in pids {
    kill_pid(pid);
  }
}

#[cfg(windows)]
fn kill_pid(pid: u32) {
  use windows_sys::Win32::Foundation::CloseHandle;
  use windows_sys::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};
  // SAFETY: plain Win32 calls on a handle we open and close here.
  unsafe {
    let handle = OpenProcess(PROCESS_TERMINATE, 0, pid);
    if !handle.is_null() {
      TerminateProcess(handle, 1);
      CloseHandle(handle);
    }
  }
}

#[cfg(unix)]
fn kill_pid(pid: u32) {
  if let Ok(pid) = i32::try_from(pid) {
    // SAFETY: kill(2) has no memory-safety preconditions.
    unsafe {
      libc::kill(pid, libc::SIGKILL);
    }
  }
}

#[cfg(windows)]
fn kill_on_close_job() -> Option<isize> {
  use windows_sys::Win32::System::JobObjects::{
    CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
  };
  static JOB: OnceLock<Option<isize>> = OnceLock::new();
  *JOB.get_or_init(|| {
    // SAFETY: the job handle is created once and intentionally never closed,
    // so the kernel closes it (and kills the children) when PlayStash exits.
    unsafe {
      let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
      if job.is_null() {
        log::warn!("children: CreateJobObjectW failed: {}", std::io::Error::last_os_error());
        return None;
      }
      let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
      info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
      let ok = SetInformationJobObject(
        job,
        JobObjectExtendedLimitInformation,
        &info as *const _ as *const std::ffi::c_void,
        std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
      );
      if ok == 0 {
        log::warn!("children: SetInformationJobObject failed: {}", std::io::Error::last_os_error());
        return None;
      }
      Some(job as isize)
    }
  })
}

#[cfg(windows)]
fn attach_to_job(child: &std::process::Child) {
  use std::os::windows::io::AsRawHandle;
  use windows_sys::Win32::System::JobObjects::AssignProcessToJobObject;
  if let Some(job) = kill_on_close_job() {
    // SAFETY: both handles are valid for the duration of the call.
    let ok = unsafe { AssignProcessToJobObject(job as _, child.as_raw_handle() as _) };
    if ok == 0 {
      log::warn!("children: AssignProcessToJobObject failed: {}", std::io::Error::last_os_error());
    }
  }
}

#[cfg(unix)]
fn install_exit_handler() {
  extern "C" fn kill_children_at_exit() {
    kill_all();
  }
  static INSTALLED: OnceLock<()> = OnceLock::new();
  INSTALLED.get_or_init(|| {
    // SAFETY: registering a plain `extern "C"` function without arguments.
    unsafe {
      libc::atexit(kill_children_at_exit);
    }
  });
}

/// Prepares `command` to run hidden (no console window on Windows) and to die
/// together with PlayStash on Linux.
#[cfg_attr(not(any(windows, target_os = "linux")), allow(unused_variables))]
fn prepare(command: &mut Command) {
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
  }
  #[cfg(target_os = "linux")]
  {
    use std::os::unix::process::CommandExt;
    // SAFETY: prctl is async-signal-safe and touches no Rust state. Best
    // effort: a failure only loses the parent-death signal.
    unsafe {
      command.pre_exec(|| {
        // Variadic: pass full-width arguments, the kernel reads `unsigned long`.
        let signal = libc::SIGKILL as libc::c_ulong;
        let unused: libc::c_ulong = 0;
        libc::prctl(libc::PR_SET_PDEATHSIG, signal, unused, unused, unused);
        Ok(())
      });
    }
  }
  #[cfg(unix)]
  install_exit_handler();
}

/// Runs `command` to completion as a tracked, hidden child with stdin closed
/// and stdout/stderr captured. Blocking: call it from `spawn_blocking`.
pub(crate) fn run_tracked(command: &mut Command) -> std::io::Result<Output> {
  prepare(command);
  command
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
  let child = command.spawn()?;
  let pid = child.id();
  register(pid);
  #[cfg(windows)]
  attach_to_job(&child);
  let result = child.wait_with_output();
  unregister(pid);
  result
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn registry_tracks_and_forgets_pids() {
    register(4_000_001);
    assert!(registry().lock().unwrap().contains(&4_000_001));
    unregister(4_000_001);
    assert!(!registry().lock().unwrap().contains(&4_000_001));
  }

  #[test]
  fn runs_a_child_and_captures_its_output() {
    #[cfg(windows)]
    let mut command = {
      let mut command = Command::new("cmd");
      command.args(["/C", "echo playstash"]);
      command
    };
    #[cfg(unix)]
    let mut command = {
      let mut command = Command::new("sh");
      command.args(["-c", "echo playstash"]);
      command
    };
    let output = run_tracked(&mut command).expect("child runs");
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("playstash"));
  }
}
