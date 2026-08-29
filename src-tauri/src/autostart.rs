//! Launch-at-login (autostart) handling.
//!
//! All platforms apply the setting through tauri-plugin-autostart, except
//! macOS 13+ where the app registers itself as a login item via
//! `SMAppService`. The plugin's launch agent plist carries no app
//! association, so the System Settings Login Items pane attributes it to the
//! code-signing certificate's developer name instead of the app (#337).
//! `SMAppService` login items are attributed to the app bundle itself and
//! appear under "Open at Login" with the app's name and icon.

use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AutostartAction {
    Enable,
    Disable,
    CleanCurrentDevRegistration,
}

fn autostart_action(requested: bool, is_tauri_dev: bool) -> AutostartAction {
    match (is_tauri_dev, requested) {
        (true, _) => AutostartAction::CleanCurrentDevRegistration,
        (false, true) => AutostartAction::Enable,
        (false, false) => AutostartAction::Disable,
    }
}

#[cfg(any(test, all(target_os = "windows", dev)))]
fn autostart_command_targets_executable(command: &str, executable: &str) -> bool {
    let command = command.trim().to_lowercase();
    let executable = executable.trim().trim_matches('"').to_lowercase();
    let remainder = if let Some(remainder) = command.strip_prefix(&executable) {
        remainder
    } else if let Some(remainder) = command.strip_prefix(&format!("\"{executable}\"")) {
        remainder
    } else {
        return false;
    };

    remainder.is_empty() || remainder.starts_with(char::is_whitespace)
}

#[cfg(all(target_os = "windows", dev))]
fn clean_current_windows_dev_registration(app: &AppHandle) -> Result<bool, String> {
    use std::io::ErrorKind;
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE};
    use winreg::RegKey;

    const RUN_KEY: &str = "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run";

    let current_executable = std::env::current_exe()
        .map_err(|error| format!("failed to resolve current executable: {error}"))?;
    let current_executable = current_executable.to_string_lossy();
    let value_name = &app.package_info().name;
    let current_user = RegKey::predef(HKEY_CURRENT_USER);
    let run_key = current_user
        .open_subkey_with_flags(RUN_KEY, KEY_READ | KEY_SET_VALUE)
        .map_err(|error| format!("failed to open Windows Run key: {error}"))?;
    let command: String = match run_key.get_value(value_name) {
        Ok(command) => command,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(format!("failed to read Windows Run entry: {error}")),
    };

    if !autostart_command_targets_executable(&command, &current_executable) {
        return Ok(false);
    }

    run_key
        .delete_value(value_name)
        .map_err(|error| format!("failed to remove development Run entry: {error}"))?;
    Ok(true)
}

/// Apply the user's autostart preference using the best mechanism for the
/// current platform.
///
/// Callers decide whether a failure is fatal. Interactive settings changes
/// return the error to the frontend, while startup logs it and continues.
pub fn apply_autostart(app: &AppHandle, enabled: bool) -> Result<(), String> {
    match autostart_action(enabled, cfg!(dev)) {
        AutostartAction::CleanCurrentDevRegistration => {
            #[cfg(all(target_os = "windows", dev))]
            {
                match clean_current_windows_dev_registration(app)? {
                    true => log::info!(
                    "Removed the server-dependent development executable from Windows autostart"
                ),
                    false => log::info!(
                    "Preserved autostart because it does not target this development executable"
                ),
                }
            }

            #[cfg(not(all(target_os = "windows", dev)))]
            log::info!("Skipped autostart registration for the development executable");
            return Ok(());
        }
        AutostartAction::Enable => {}
        AutostartAction::Disable => {}
    }

    #[cfg(target_os = "macos")]
    if macos::login_item_api_available() {
        macos::remove_plugin_launch_agent(app)?;
        return macos::set_login_item(enabled);
    }

    let manager = app.autolaunch();
    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
    result.map_err(|error| {
        let action = if enabled { "enable" } else { "disable" };
        format!("failed to {action} launch at login: {error}")
    })
}

#[cfg(test)]
mod tests {
    use super::{autostart_action, autostart_command_targets_executable, AutostartAction};

    #[test]
    fn tauri_dev_selectively_cleans_its_server_dependent_executable() {
        assert_eq!(
            autostart_action(true, true),
            AutostartAction::CleanCurrentDevRegistration
        );
        assert_eq!(
            autostart_action(false, true),
            AutostartAction::CleanCurrentDevRegistration
        );
    }

    #[test]
    fn standalone_builds_follow_the_saved_preference() {
        assert_eq!(autostart_action(true, false), AutostartAction::Enable);
        assert_eq!(autostart_action(false, false), AutostartAction::Disable);
    }

    #[test]
    fn dev_cleanup_matches_only_the_current_executable() {
        let current = r"G:\Software\LocalDictate\target\debug\localdictate.exe";
        assert!(autostart_command_targets_executable(current, current));
        assert!(autostart_command_targets_executable(
            &format!(r#""{current}" --start-hidden"#),
            current
        ));
        assert!(!autostart_command_targets_executable(
            r"C:\Program Files\LocalDictate\localdictate.exe",
            current
        ));
        assert!(!autostart_command_targets_executable(
            &format!("{current}.backup"),
            current
        ));
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::path::{Path, PathBuf};

    use objc2::runtime::AnyClass;
    use objc2_service_management::{SMAppService, SMAppServiceStatus};
    use tauri::{AppHandle, Manager};

    /// `SMAppService` requires macOS 13. The ServiceManagement framework is
    /// linked unconditionally (it has existed since 10.6), so looking up the
    /// class doubles as the OS version check: present exactly when the API is
    /// usable.
    pub fn login_item_api_available() -> bool {
        AnyClass::get(c"SMAppService").is_some()
    }

    /// Register or unregister the app as a login item, skipping the call when
    /// the service is already in the requested state (unregistering a
    /// never-registered service returns an error on every launch otherwise).
    pub fn set_login_item(enabled: bool) -> Result<(), String> {
        let service = unsafe { SMAppService::mainAppService() };
        let status = unsafe { service.status() };

        if enabled {
            if status == SMAppServiceStatus::Enabled {
                return Ok(());
            }
            // Fails in dev (no signed app bundle) and when the user has
            // switched the item off in System Settings, which apps are
            // not allowed to override.
            unsafe { service.registerAndReturnError() }
                .map_err(|error| format!("failed to register launch at login: {error}"))?;
            log::info!("Registered login item via SMAppService");
        } else {
            if status == SMAppServiceStatus::NotRegistered || status == SMAppServiceStatus::NotFound
            {
                return Ok(());
            }
            unsafe { service.unregisterAndReturnError() }
                .map_err(|error| format!("failed to unregister launch at login: {error}"))?;
            log::info!("Unregistered login item via SMAppService");
        }

        Ok(())
    }

    /// Remove the launch agent plist that tauri-plugin-autostart (via the
    /// auto-launch crate) wrote on older versions, so login doesn't start the
    /// app twice after migrating to `SMAppService`. Runs on every launch;
    /// missing file is the normal case.
    pub fn remove_plugin_launch_agent(app: &AppHandle) -> Result<(), String> {
        let home = app
            .path()
            .home_dir()
            .map_err(|error| format!("failed to resolve home directory: {error}"))?;
        remove_launch_agent_file(&plugin_launch_agent_path(&home, &app.package_info().name))
    }

    /// Path of the plist the auto-launch crate writes:
    /// `~/Library/LaunchAgents/{app name}.plist`.
    fn plugin_launch_agent_path(home: &Path, app_name: &str) -> PathBuf {
        home.join("Library")
            .join("LaunchAgents")
            .join(format!("{}.plist", app_name))
    }

    fn remove_launch_agent_file(path: &Path) -> Result<(), String> {
        match std::fs::remove_file(path) {
            Ok(()) => {
                log::info!("Removed legacy autostart launch agent {:?}", path);
                Ok(())
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!(
                "failed to remove legacy launch agent {path:?}: {error}"
            )),
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        /// Validates the assumption `login_item_api_available` rests on: the
        /// ServiceManagement framework is linked into the binary, so the
        /// class lookup finds `SMAppService` whenever the host is macOS 13+
        /// (which anything able to build this crate is).
        #[test]
        fn sm_app_service_class_resolves() {
            assert!(login_item_api_available());
        }

        #[test]
        fn launch_agent_path_matches_auto_launch_crate() {
            let path = plugin_launch_agent_path(Path::new("/Users/someone"), "Handy");
            assert_eq!(
                path,
                Path::new("/Users/someone/Library/LaunchAgents/Handy.plist")
            );
        }

        #[test]
        fn removes_existing_launch_agent() {
            let dir = tempfile::tempdir().unwrap();
            let plist = dir.path().join("Handy.plist");
            std::fs::write(&plist, "<plist/>").unwrap();

            remove_launch_agent_file(&plist).unwrap();
            assert!(!plist.exists());
        }

        #[test]
        fn missing_launch_agent_is_a_no_op() {
            let dir = tempfile::tempdir().unwrap();
            remove_launch_agent_file(&dir.path().join("Handy.plist")).unwrap();
        }
    }
}
