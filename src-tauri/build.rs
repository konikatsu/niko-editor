fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&["open_document", "save_document", "open_work_document", "save_work_document", "close_editor"]),
    ))
    .expect("Could not prepare the desktop app");
}
