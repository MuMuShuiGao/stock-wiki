use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

// ── Data types ──────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct LlmConfig {
    base_url: Option<String>,
    api_key: Option<String>,
}

impl Default for LlmConfig {
    fn default() -> Self {
        Self {
            base_url: Some("https://api.deepseek.com".into()),
            api_key: None,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct AppConfig {
    #[serde(default)]
    workspace_path: Option<String>,
    #[serde(default)]
    llm: LlmConfig,
}

impl AppConfig {
    fn with_defaults() -> Self {
        Self {
            workspace_path: None,
            llm: LlmConfig::default(),
        }
    }
}

// ── Config persistence ──────────────────────────────────────────

fn get_config_path(app: &tauri::AppHandle) -> PathBuf {
    let data_dir = app
        .path()
        .app_data_dir()
        .expect("failed to resolve app data dir");
    fs::create_dir_all(&data_dir).ok();
    data_dir.join("config.json")
}

fn load_config(app: &tauri::AppHandle) -> AppConfig {
    let path = get_config_path(app);
    if path.exists() {
        let content = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_else(|_| AppConfig::with_defaults())
    } else {
        AppConfig::with_defaults()
    }
}

fn save_config(app: &tauri::AppHandle, config: &AppConfig) -> Result<(), String> {
    let path = get_config_path(app);
    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Path safety ─────────────────────────────────────────────────

fn sanitize_path(base: &Path, components: &[&str]) -> Result<PathBuf, String> {
    let mut resolved = base.to_path_buf();
    for c in components {
        let c = c.trim_matches(|ch: char| ch == '/' || ch == '\\' || ch == '.');
        if c.is_empty() || c.contains("..") {
            return Err("Invalid path component".into());
        }
        resolved.push(c);
    }
    if !resolved.starts_with(base) {
        return Err("Path traversal detected".into());
    }
    Ok(resolved)
}

fn get_workspace_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config = load_config(app);
    let ws = config
        .workspace_path
        .ok_or("No workspace configured")?;
    Ok(PathBuf::from(&ws))
}

// ── File format extraction ──────────────────────────────────────

fn extract_pdf_text(file_path: &Path) -> Result<String, String> {
    let bytes = fs::read(file_path).map_err(|e| format!("Failed to read PDF: {}", e))?;
    let text = pdf_extract::extract_text_from_mem(&bytes)
        .map_err(|e| format!("Failed to extract PDF text: {}", e))?;
    Ok(text)
}

fn extract_excel_text(file_path: &Path) -> Result<String, String> {
    use calamine::{open_workbook, Reader, Xlsx};
    let mut workbook: Xlsx<_> =
        open_workbook(file_path).map_err(|e| format!("Failed to open Excel: {}", e))?;

    let sheet_names = workbook.sheet_names().to_vec();
    let mut output = String::new();

    for sheet_name in &sheet_names {
        if let Ok(range) = workbook.worksheet_range(sheet_name) {
            output.push_str(&format!("# {}\n\n", sheet_name));
            let mut rows_iter = range.rows();
            // First row as header
            if let Some(header) = rows_iter.next() {
                let headers: Vec<String> = header.iter().map(|c| c.to_string()).collect();
                output.push_str(&format!("| {} |\n", headers.join(" | ")));
                output.push_str(&format!(
                    "| {} |\n",
                    headers.iter().map(|_| "---").collect::<Vec<_>>().join(" | ")
                ));
            }
            // Data rows
            for row in rows_iter {
                let cells: Vec<String> = row.iter().map(|c| c.to_string()).collect();
                output.push_str(&format!("| {} |\n", cells.join(" | ")));
            }
            output.push('\n');
        }
    }
    if output.is_empty() {
        return Err("No readable sheets found in Excel file".into());
    }
    Ok(output)
}

fn extract_csv_text(file_path: &Path) -> Result<String, String> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_path(file_path)
        .map_err(|e| format!("Failed to read CSV: {}", e))?;

    let headers: Vec<String> = reader
        .headers()
        .map_err(|e| format!("CSV header error: {}", e))?
        .iter()
        .map(|h| h.to_string())
        .collect();

    let mut output = String::new();
    output.push_str(&format!("| {} |\n", headers.join(" | ")));
    output.push_str(&format!(
        "| {} |\n",
        headers.iter().map(|_| "---").collect::<Vec<_>>().join(" | ")
    ));

    for result in reader.records() {
        let record = result.map_err(|e| format!("CSV row error: {}", e))?;
        let cells: Vec<String> = record.iter().map(|c| c.to_string()).collect();
        output.push_str(&format!("| {} |\n", cells.join(" | ")));
    }

    if headers.is_empty() {
        // Fallback: read as plain text if no headers
        return Ok(fs::read_to_string(file_path)
            .map_err(|e| format!("Failed to read CSV: {}", e))?);
    }
    Ok(output)
}

fn extract_md_text(file_path: &Path) -> Result<String, String> {
    fs::read_to_string(file_path).map_err(|e| format!("Failed to read file: {}", e))
}

// ── Workspace commands ──────────────────────────────────────────

#[tauri::command]
async fn select_workspace(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let path = app.dialog().file().blocking_pick_folder();

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

// ── File extraction command ─────────────────────────────────────

#[tauri::command]
fn extract_text(file_path: String) -> Result<String, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err("File does not exist".into());
    }

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "pdf" => extract_pdf_text(path),
        "xlsx" | "xls" => extract_excel_text(path),
        "csv" => extract_csv_text(path),
        "md" | "markdown" | "txt" => extract_md_text(path),
        _ => {
            // Try reading as plain text for unknown extensions
            fs::read_to_string(path)
                .map_err(|e| format!("Unsupported file type '{}': {}", ext, e))
        }
    }
}

// ── LLM config commands ────────────────────────────────────────

#[tauri::command]
fn get_llm_config(app: tauri::AppHandle) -> Result<LlmConfig, String> {
    let config = load_config(&app);
    Ok(config.llm)
}

#[tauri::command]
fn set_llm_config(app: tauri::AppHandle, base_url: Option<String>, api_key: Option<String>) -> Result<(), String> {
    let mut config = load_config(&app);
    if let Some(url) = base_url {
        config.llm.base_url = Some(url);
    }
    if let Some(key) = api_key {
        config.llm.api_key = Some(key);
    }
    save_config(&app, &config)
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
    let ws_path = get_workspace_path(&app)?;
    let project_path = sanitize_path(&ws_path, &[&name])?;

    fs::create_dir(&project_path).map_err(|e| e.to_string())?;

    // Create raw/ and wiki/ subdirectories
    fs::create_dir(project_path.join("raw")).map_err(|e| e.to_string())?;
    let wiki_base = project_path.join("wiki");
    fs::create_dir(&wiki_base).map_err(|e| e.to_string())?;
    for sub_dir in &["股票", "概念", "模式"] {
        fs::create_dir(wiki_base.join(sub_dir)).map_err(|e| e.to_string())?;
    }

    Ok(FileEntry {
        name,
        path: project_path.to_string_lossy().to_string(),
        is_dir: true,
    })
}

#[tauri::command]
fn delete_project(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let ws_path = get_workspace_path(&app)?;
    let project_path = sanitize_path(&ws_path, &[&name])?;

    fs::remove_dir_all(&project_path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn rename_project(app: tauri::AppHandle, old_name: String, new_name: String) -> Result<(), String> {
    let ws_path = get_workspace_path(&app)?;
    let old_path = sanitize_path(&ws_path, &[&old_name])?;
    let new_path = sanitize_path(&ws_path, &[&new_name])?;

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

// ── Wiki commands ───────────────────────────────────────────────

#[tauri::command]
fn check_wiki_exists(app: tauri::AppHandle, project_name: String, wiki_type: String, title: String) -> Result<Option<String>, String> {
    let ws_path = get_workspace_path(&app)?;
    let wiki_path = ws_path
        .join(&project_name)
        .join("wiki")
        .join(&wiki_type)
        .join(format!("{}.md", &title));

    if wiki_path.exists() {
        Ok(Some(wiki_path.to_string_lossy().to_string()))
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn read_wiki(file_path: String) -> Result<String, String> {
    if !Path::new(&file_path).exists() {
        return Err("Wiki page does not exist".into());
    }
    fs::read_to_string(&file_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_wiki(
    app: tauri::AppHandle,
    project_name: String,
    wiki_type: String,
    title: String,
    content: String,
) -> Result<String, String> {
    let ws_path = get_workspace_path(&app)?;
    let wiki_base = ws_path.join(&project_name).join("wiki");

    // Sanitize title: reject path traversal attempts
    if title.is_empty()
        || title.contains("..")
        || title.contains('/')
        || title.contains('\\')
        || title.contains(':')
        || title.contains('*')
        || title.contains('?')
        || title.contains('"')
        || title.contains('<')
        || title.contains('>')
        || title.contains('|')
    {
        return Err(format!("Invalid title for wiki page: '{}'", title));
    }

    let wiki_dir = wiki_base.join(&wiki_type);
    fs::create_dir_all(&wiki_dir).map_err(|e| e.to_string())?;

    let safe_filename = format!("{}.md", &title);
    let file_path = wiki_dir.join(&safe_filename);

    // Extra guard: ensure resolved path is under wiki base
    let canonical_base = wiki_base.canonicalize().unwrap_or(wiki_base.clone());
    let canonical_file = file_path.canonicalize().unwrap_or(file_path.clone());
    if !canonical_file.starts_with(&canonical_base) {
        return Err("Path traversal detected in wiki path".into());
    }

    fs::write(&file_path, &content).map_err(|e| e.to_string())?;

    Ok(file_path.to_string_lossy().to_string())
}

// ── Import file ──────────────────────────────────────────────────

#[tauri::command]
fn import_file(source_path: String, dest_dir: String) -> Result<FileEntry, String> {
    let src = Path::new(&source_path);
    if !src.exists() {
        return Err(format!("Source file does not exist: {}", source_path));
    }
    let name = src
        .file_name()
        .ok_or("Invalid source path")?
        .to_string_lossy()
        .to_string();

    let dest = Path::new(&dest_dir);
    let mut final_path = dest.join(&name);

    // If a file with the same name already exists, append a counter suffix
    let stem = src
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("");
    let mut counter = 1;
    while final_path.exists() {
        let new_name = if ext.is_empty() {
            format!("{} ({})", stem, counter)
        } else {
            format!("{} ({}).{}", stem, counter, ext)
        };
        final_path = dest.join(&new_name);
        counter += 1;
    }

    fs::copy(&src, &final_path).map_err(|e| format!("Failed to copy file: {}", e))?;

    let final_name = final_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    Ok(FileEntry {
        name: final_name,
        path: final_path.to_string_lossy().to_string(),
        is_dir: false,
    })
}

// ── Ensure wiki directories exist in project ────────────────────

#[tauri::command]
fn ensure_wiki_dirs(app: tauri::AppHandle, project_name: String) -> Result<(), String> {
    let ws_path = get_workspace_path(&app)?;
    let project_base = ws_path.join(&project_name);

    // Ensure raw/ directory
    fs::create_dir_all(project_base.join("raw")).map_err(|e| e.to_string())?;

    // Ensure wiki/ subdirectories
    let wiki_base = project_base.join("wiki");
    for sub_dir in &["股票", "概念", "模式"] {
        fs::create_dir_all(wiki_base.join(sub_dir)).map_err(|e| e.to_string())?;
    }
    Ok(())
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
            // Workspace
            select_workspace,
            get_workspace,
            // File extraction
            extract_text,
            // LLM config
            get_llm_config,
            set_llm_config,
            // Projects
            list_projects,
            create_project,
            delete_project,
            rename_project,
            // Files
            list_directory,
            create_file,
            create_folder,
            read_file,
            write_file,
            delete_file,
            rename_file,
            move_file,
            import_file,
            // Wiki
            check_wiki_exists,
            read_wiki,
            write_wiki,
            ensure_wiki_dirs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
