// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  // Parses the command line; forwards it to a running instance and exits, or
  // keeps it as the startup command of this instance.
  app_lib::cli_predispatch();
  app_lib::run();
}
