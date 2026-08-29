// LocalDictate is a tray utility. Use the GUI subsystem in debug and release
// builds so launching the executable never opens a companion console window.
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use clap::Parser;
use localdictate_app_lib::CliArgs;

#[cfg(all(target_os = "windows", dev))]
fn is_localdictate_vite_server(address: &std::net::SocketAddr) -> bool {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::time::Duration;

    const OWNER_TOKEN: &str = "localdictate-vite-owner-v1";
    const PROBE: &[u8] = b"GET /__localdictate_dev_owner__ HTTP/1.1\r\nHost: localhost:1420\r\nConnection: close\r\n\r\n";

    let Ok(mut stream) = TcpStream::connect_timeout(address, Duration::from_millis(250)) else {
        return false;
    };
    if stream
        .set_read_timeout(Some(Duration::from_millis(500)))
        .is_err()
        || stream
            .set_write_timeout(Some(Duration::from_millis(500)))
            .is_err()
        || stream.write_all(PROBE).is_err()
    {
        return false;
    }

    let mut response = Vec::with_capacity(1024);
    if stream.take(4096).read_to_end(&mut response).is_err() {
        return false;
    }
    let Ok(response) = std::str::from_utf8(&response) else {
        return false;
    };
    let Some((headers, body)) = response.split_once("\r\n\r\n") else {
        return false;
    };

    headers
        .lines()
        .next()
        .is_some_and(|status| status.starts_with("HTTP/1.1 200 "))
        && body.trim() == OWNER_TOKEN
}

#[cfg(all(target_os = "windows", dev))]
fn require_tauri_dev_server() {
    use std::net::SocketAddr;
    use windows::core::w;
    use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};

    let vite_addresses = [
        SocketAddr::from(([127, 0, 0, 1], 1420)),
        SocketAddr::from(([0, 0, 0, 0, 0, 0, 0, 1], 1420)),
    ];
    let vite_is_available = vite_addresses.iter().any(is_localdictate_vite_server);

    if vite_is_available {
        return;
    }

    // A `tauri dev` executable has no embedded frontend. Fail before WebView2
    // can render its generic Microsoft Edge connection-error document.
    unsafe {
        let _ = MessageBoxW(
            None,
            w!("This is LocalDictate's development executable, and its Vite server is not running.\n\nStart it with scripts\\windows.ps1 dev, or launch the installed LocalDictate application."),
            w!("LocalDictate development server is offline"),
            MB_OK | MB_ICONERROR,
        );
    }
    std::process::exit(2);
}

fn main() {
    #[cfg(all(target_os = "windows", dev))]
    require_tauri_dev_server();

    let cli_args = CliArgs::parse();

    #[cfg(target_os = "linux")]
    {
        // DMABUF renderer causes crashes on various GPU/display server configurations
        // See: https://github.com/tauri-apps/tauri/issues/9394
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    localdictate_app_lib::run(cli_args)
}
