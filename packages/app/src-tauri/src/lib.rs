#[cfg(not(debug_assertions))]
use tauri::Manager;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandChild;
use std::sync::Mutex;

struct ServerProcess(Mutex<Option<CommandChild>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(ServerProcess(Mutex::new(None)))
        .setup(|app| {
            // dev 模式由 beforeDevCommand 启动服务，仅 release 时 spawn sidecar
            #[cfg(not(debug_assertions))]
            {
                let sidecar = app.shell().sidecar("the-next-core")
                    .expect("failed to create sidecar command");
                let (_rx, child) = sidecar.spawn()
                    .expect("failed to spawn sidecar");

                let state: tauri::State<'_, ServerProcess> = app.state();
                *state.0.lock().unwrap() = Some(child);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
