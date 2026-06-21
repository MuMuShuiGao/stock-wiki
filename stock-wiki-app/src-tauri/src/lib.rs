use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize, Clone)]
struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct WorkspaceConfig {
    workspace_path: Option<String>,
}

fn get_config_path(app: &tauri::AppHandle) -> PathBuf {
    let data_dir = app
        .path()
        .app_data_dir()
        .expect("failed to resolve app data dir");
    fs::create_dir_all(&data_dir).ok();
    data_dir.join("config.json")
}

fn load_config(app: &tauri::AppHandle) -> WorkspaceConfig {
    let path = get_config_path(app);
    if path.exists() {
        let content = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or(WorkspaceConfig {
            workspace_path: None,
        })
    } else {
        WorkspaceConfig {
            workspace_path: None,
        }
    }
}

fn save_config(app: &tauri::AppHandle, config: &WorkspaceConfig) -> Result<(), String> {
    let path = get_config_path(app);
    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

fn sanitize_path(base: &Path, components: &[&str]) -> Result<PathBuf, String> {
    let mut resolved = base.to_path_buf();
    for c in components {
        let c = c.trim_matches(|ch: char| ch == '/' || ch == '\\' || ch == '.');
        if c.is_empty() || c.contains("..") {
            return Err("Invalid path component".into());
        }
        resolved.push(c);
    }
    // Ensure resolved path is under base
    if !resolved.starts_with(base) {
        return Err("Path traversal detected".into());
    }
    Ok(resolved)
}

// ── Workspace commands ──────────────────────────────────────────

#[tauri::command]
async fn select_workspace(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let path = app
        .dialog()
        .file()
        .blocking_pick_folder();

    if let Some(path) = path {
        let workspace = path.to_string();
        let mut config = load_config(&app);
        config.workspace_path = Some(workspace.clone());
        save_config(&app, &config)?;
        Ok(Some(workspace))
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn get_workspace(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let config = load_config(&app);
    Ok(config.workspace_path)
}

// ── Project commands ────────────────────────────────────────────

#[tauri::command]
fn list_projects(app: tauri::AppHandle) -> Result<Vec<FileEntry>, String> {
    let config = load_config(&app);
    let workspace = config
        .workspace_path
        .ok_or("No workspace configured")?;
    let ws_path = Path::new(&workspace);

    if !ws_path.exists() {
        return Ok(vec![]);
    }

    let mut entries = vec![];
    let dir = fs::read_dir(ws_path).map_err(|e| e.to_string())?;
    for entry in dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            entries.push(FileEntry {
                name: entry.file_name().to_string_lossy().to_string(),
                path: path.to_string_lossy().to_string(),
                is_dir: true,
            });
        }
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

#[tauri::command]
fn create_project(app: tauri::AppHandle, name: String) -> Result<FileEntry, String> {
    let config = load_config(&app);
    let workspace = config
        .workspace_path
        .ok_or("No workspace configured")?;
    let ws_path = Path::new(&workspace);
    let project_path = sanitize_path(ws_path, &[&name])?;

    fs::create_dir(&project_path).map_err(|e| e.to_string())?;

    Ok(FileEntry {
        name,
        path: project_path.to_string_lossy().to_string(),
        is_dir: true,
    })
}

#[tauri::command]
fn delete_project(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let config = load_config(&app);
    let workspace = config
        .workspace_path
        .ok_or("No workspace configured")?;
    let ws_path = Path::new(&workspace);
    let project_path = sanitize_path(ws_path, &[&name])?;

    fs::remove_dir_all(&project_path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn rename_project(app: tauri::AppHandle, old_name: String, new_name: String) -> Result<(), String> {
    let config = load_config(&app);
    let workspace = config
        .workspace_path
        .ok_or("No workspace configured")?;
    let ws_path = Path::new(&workspace);
    let old_path = sanitize_path(ws_path, &[&old_name])?;
    let new_path = sanitize_path(ws_path, &[&new_name])?;

    fs::rename(&old_path, &new_path).map_err(|e| e.to_string())?;
    Ok(())
}

// ── File / directory commands ───────────────────────────────────

#[tauri::command]
fn list_directory(dir_path: String) -> Result<Vec<FileEntry>, String> {
    let path = Path::new(&dir_path);
    if !path.exists() || !path.is_dir() {
        return Err("Directory does not exist".into());
    }

    let mut entries = vec![];
    let dir = fs::read_dir(path).map_err(|e| e.to_string())?;
    for entry in dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        entries.push(FileEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: path.to_string_lossy().to_string(),
            is_dir: path.is_dir(),
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
fn create_file(parent_dir: String, name: String, content: Option<String>) -> Result<FileEntry, String> {
    let parent = Path::new(&parent_dir);
    let file_path = sanitize_path(parent, &[&name])?;

    fs::write(&file_path, content.unwrap_or_default()).map_err(|e| e.to_string())?;

    Ok(FileEntry {
        name,
        path: file_path.to_string_lossy().to_string(),
        is_dir: false,
    })
}

#[tauri::command]
fn create_folder(parent_dir: String, name: String) -> Result<FileEntry, String> {
    let parent = Path::new(&parent_dir);
    let folder_path = sanitize_path(parent, &[&name])?;

    fs::create_dir(&folder_path).map_err(|e| e.to_string())?;

    Ok(FileEntry {
        name,
        path: folder_path.to_string_lossy().to_string(),
        is_dir: true,
    })
}

#[tauri::command]
fn read_file(file_path: String) -> Result<String, String> {
    fs::read_to_string(&file_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(file_path: String, content: String) -> Result<(), String> {
    fs::write(&file_path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_file(file_path: String) -> Result<(), String> {
    let path = Path::new(&file_path);
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|e| e.to_string())?;
    } else {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn rename_file(file_path: String, new_name: String) -> Result<String, String> {
    let path = Path::new(&file_path);
    let parent = path.parent().ok_or("Invalid path")?;
    let new_path = parent.join(&new_name);

    fs::rename(&path, &new_path).map_err(|e| e.to_string())?;

    Ok(new_path.to_string_lossy().to_string())
}

#[tauri::command]
fn move_file(source: String, dest_dir: String) -> Result<String, String> {
    let src = Path::new(&source);
    let dest = Path::new(&dest_dir);
    let name = src.file_name().ok_or("Invalid source path")?;
    let dest_path = dest.join(name);

    fs::rename(&src, &dest_path).map_err(|e| e.to_string())?;

    Ok(dest_path.to_string_lossy().to_string())
}

// ── App entry point ─────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            select_workspace,
            get_workspace,
            list_projects,
            create_project,
            delete_project,
            rename_project,
            list_directory,
            create_file,
            create_folder,
            read_file,
            write_file,
            delete_file,
            rename_file,
            move_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
