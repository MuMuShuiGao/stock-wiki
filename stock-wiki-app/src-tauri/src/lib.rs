use log::{error, info};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
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
    #[serde(default = "default_provider")]
    provider: String,
    #[serde(default)]
    model: Option<String>,
}

fn default_provider() -> String {
    "deepseek".into()
}

impl Default for LlmConfig {
    fn default() -> Self {
        Self {
            base_url: Some("https://api.deepseek.com".into()),
            api_key: None,
            provider: "deepseek".into(),
            model: None,
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

const WIKI_TYPES: &[&str] = &["股票", "概念", "模式", "市场环境", "总结"];

fn create_wiki_dirs(project_path: &Path) -> Result<(), String> {
    fs::create_dir_all(project_path.join("raw")).map_err(|e| e.to_string())?;
    let wiki_base = project_path.join("wiki");
    for sub_dir in WIKI_TYPES {
        fs::create_dir_all(wiki_base.join(sub_dir)).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(wiki_base.join("logs")).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Workspace commands ──────────────────────────────────────────

#[tauri::command]
async fn select_workspace(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let path = app.dialog().file().blocking_pick_folder();

    if let Some(path) = path {
        let workspace = path.to_string();
        info!("工作区已选择: {}", workspace);
        let mut config = load_config(&app);
        config.workspace_path = Some(workspace.clone());
        save_config(&app, &config)?;
        Ok(Some(workspace))
    } else {
        info!("工作区选择已取消");
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
        error!("提取文本失败: 文件不存在 - {}", file_path);
        return Err("File does not exist".into());
    }

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    info!("开始提取文本: {} (类型: {})", file_path, ext);
    let result = match ext.as_str() {
        "pdf" => extract_pdf_text(path),
        "xlsx" | "xls" => extract_excel_text(path),
        "csv" => extract_csv_text(path),
        "md" | "markdown" | "txt" => {
            fs::read_to_string(path).map_err(|e| format!("Failed to read file: {}", e))
        }
        _ => {
            // Try reading as plain text for unknown extensions
            fs::read_to_string(path)
                .map_err(|e| format!("Unsupported file type '{}': {}", ext, e))
        }
    };
    match &result {
        Ok(_) => info!("文本提取成功: {}", file_path),
        Err(e) => error!("文本提取失败: {}", e),
    }
    result
}

// ── LLM config commands ────────────────────────────────────────

#[tauri::command]
fn get_llm_config(app: tauri::AppHandle) -> Result<LlmConfig, String> {
    let config = load_config(&app);
    Ok(config.llm)
}

#[tauri::command]
fn set_llm_config(
    app: tauri::AppHandle,
    base_url: Option<String>,
    api_key: Option<String>,
    provider: Option<String>,
    model: Option<String>,
) -> Result<(), String> {
    info!("更新 LLM 配置: base_url={:?}, provider={:?}, model={:?}", base_url, provider, model);
    let mut config = load_config(&app);
    if let Some(url) = base_url {
        config.llm.base_url = Some(url);
    }
    if let Some(key) = api_key {
        config.llm.api_key = Some(key);
    }
    if let Some(p) = provider {
        config.llm.provider = p;
    }
    config.llm.model = model;
    save_config(&app, &config)?;
    info!("LLM 配置已保存");
    Ok(())
}

// ── Project commands ────────────────────────────────────────────

#[tauri::command]
fn list_projects(app: tauri::AppHandle) -> Result<Vec<FileEntry>, String> {
    let config = load_config(&app);
    let workspace = config
        .workspace_path
        .ok_or("No workspace configured")?;
    info!("列出工作区项目: {}", workspace);
    let ws_path = Path::new(&workspace);

    if !ws_path.exists() {
        info!("工作区目录不存在，返回空列表");
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
    info!("找到 {} 个项目", entries.len());
    Ok(entries)
}

#[tauri::command]
fn create_project(app: tauri::AppHandle, name: String) -> Result<FileEntry, String> {
    let ws_path = get_workspace_path(&app)?;
    info!("创建项目: {}", name);
    let project_path = sanitize_path(&ws_path, &[&name])?;

    fs::create_dir(&project_path).map_err(|e| e.to_string())?;
    create_wiki_dirs(&project_path)?;

    info!("项目创建成功: {} (路径: {})", name, project_path.display());
    Ok(FileEntry {
        name,
        path: project_path.to_string_lossy().to_string(),
        is_dir: true,
    })
}

#[tauri::command]
fn delete_project(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let ws_path = get_workspace_path(&app)?;
    info!("删除项目: {}", name);
    let project_path = sanitize_path(&ws_path, &[&name])?;

    fs::remove_dir_all(&project_path).map_err(|e| e.to_string())?;
    info!("项目已删除: {}", name);
    Ok(())
}

// ── File / directory commands ───────────────────────────────────

#[tauri::command]
fn list_directory(dir_path: String) -> Result<Vec<FileEntry>, String> {
    let path = Path::new(&dir_path);
    if !path.exists() || !path.is_dir() {
        error!("列出目录失败: 路径不存在或不是目录 - {}", dir_path);
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
    info!("创建文件: {}", file_path.display());

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
    info!("创建文件夹: {}", folder_path.display());

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
    if let Some(parent) = Path::new(&file_path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    info!("写入文件: {}", file_path);
    fs::write(&file_path, content).map_err(|e| {
        error!("写入文件失败: {} - {}", file_path, e);
        e.to_string()
    })
}

#[tauri::command]
fn delete_file(file_path: String) -> Result<(), String> {
    let path = Path::new(&file_path);
    info!("删除: {}", file_path);
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|e| e.to_string())?;
    } else {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
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
    fs::read_to_string(&file_path).map_err(|e| {
        error!("读取 Wiki 失败: {} - {}", file_path, e);
        e.to_string()
    })
}

// ── Frontmatter 规范化 ────────────────────────────────────────────

/// 字段规范顺序（schema 定义 + 常见可选字段）
const FRONTMATTER_ORDER: &[&str] = &[
    "schema_version", "title", "type", "summary",
    "created", "updated", "last_reviewed",
    "code", "industry", "concepts",
    "parent", "catalysts",
    "aliases", "tags", "related", "sources",
];

/// 按规范顺序重新序列化 JSON 对象，返回 pretty-printed JSON 字符串。
fn serialize_ordered_json(obj: &serde_json::Map<String, serde_json::Value>) -> Result<String, String> {
    let mut ordered = serde_json::Map::new();
    let mut handled = HashSet::new();

    for &key in FRONTMATTER_ORDER {
        if let Some(value) = obj.get(key) {
            ordered.insert(key.to_string(), value.clone());
            handled.insert(key.to_string());
        }
    }

    // 未在规范顺序中的字段追加到末尾
    for (key, value) in obj {
        if !handled.contains(key) {
            ordered.insert(key.clone(), value.clone());
        }
    }

    serde_json::to_string_pretty(&serde_json::Value::Object(ordered))
        .map_err(|e| e.to_string())
}

/// 规范化 Wiki 页面的 frontmatter（---json 格式）。
/// 解析 JSON → 按规范顺序重排 → 输出。解析失败直接报错。
fn normalize_frontmatter(content: &str, wiki_type: &str, title: &str) -> Result<String, String> {
    let content = content.trim_start();

    let after_open = content.strip_prefix("---json")
        .ok_or_else(|| format!("[{} / {}] 缺少 frontmatter：内容未以 '---json' 开头", wiki_type, title))?;

    let close_idx = after_open.find("\n---")
        .ok_or_else(|| format!("[{} / {}] JSON frontmatter 格式错误：找不到结束定界符 '\\n---'", wiki_type, title))?;

    let json_str = after_open[..close_idx].trim();
    let body = after_open[close_idx + "\n---".len()..]
        .trim_start_matches('\n')
        .trim_start();

    if json_str.is_empty() {
        return Err(format!("[{} / {}] JSON frontmatter 为空", wiki_type, title));
    }

    let value: serde_json::Value = serde_json::from_str(json_str)
        .map_err(|e| format!("[{} / {}] JSON frontmatter 解析失败: {}", wiki_type, title, e))?;

    let mapping = match value {
        serde_json::Value::Object(m) => m,
        _ => return Err(format!("[{} / {}] JSON frontmatter 格式错误：顶层必须是对象", wiki_type, title)),
    };

    let clean = serialize_ordered_json(&mapping)?;
    Ok(format!("---json\n{}\n---\n\n{}", clean, body))
}

#[tauri::command]
fn write_wiki(
    app: tauri::AppHandle,
    project_name: String,
    wiki_type: String,
    title: String,
    content: String,
) -> Result<String, String> {
    if !WIKI_TYPES.contains(&wiki_type.as_str()) {
        error!("写入 Wiki 失败: 无效类型 '{}'", wiki_type);
        return Err(format!("Invalid wiki type: '{}'", wiki_type));
    }

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
        error!("写入 Wiki 失败: 无效标题 '{}'", title);
        return Err(format!("Invalid title for wiki page: '{}'", title));
    }

    let wiki_dir = wiki_base.join(&wiki_type);
    fs::create_dir_all(&wiki_dir).map_err(|e| e.to_string())?;

    let safe_filename = format!("{}.md", &title);
    let file_path = wiki_dir.join(&safe_filename);

    info!("写入 Wiki: {}/{} — 规范化 frontmatter...", wiki_type, title);

    let normalized = normalize_frontmatter(&content, &wiki_type, &title)?;

    fs::write(&file_path, &normalized).map_err(|e| {
        error!("写入 Wiki 失败: {}", e);
        e.to_string()
    })?;

    info!("Wiki 已保存: {}", file_path.display());
    Ok(file_path.to_string_lossy().to_string())
}

// ── Import file ──────────────────────────────────────────────────

#[tauri::command]
fn import_file(source_path: String, dest_dir: String) -> Result<FileEntry, String> {
    let src = Path::new(&source_path);
    if !src.exists() {
        error!("导入失败: 源文件不存在 - {}", source_path);
        return Err(format!("Source file does not exist: {}", source_path));
    }
    let name = src
        .file_name()
        .ok_or("Invalid source path")?
        .to_string_lossy()
        .to_string();

    info!("导入文件: {} -> {}", source_path, dest_dir);

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

    info!("文件导入完成: {}", final_path.display());
    Ok(FileEntry {
        name: final_name,
        path: final_path.to_string_lossy().to_string(),
        is_dir: false,
    })
}

// ── Append wiki index ────────────────────────────────────────────

#[tauri::command]
fn append_wiki_index(
    app: tauri::AppHandle,
    project_name: String,
    wiki_type: String,
    title: String,
    summary: String,
) -> Result<(), String> {
    if !WIKI_TYPES.contains(&wiki_type.as_str()) {
        error!("追加索引失败: 无效类型 '{}'", wiki_type);
        return Err(format!("Invalid wiki type: '{}'", wiki_type));
    }
    let ws_path = get_workspace_path(&app)?;
    let index_path = ws_path.join(&project_name).join("wiki").join("index.md");

    let existing = std::fs::read_to_string(&index_path).unwrap_or_default();
    let new_entry = if summary.is_empty() {
        format!("- [[{}/{}]]", wiki_type, title)
    } else {
        format!("- [[{}/{}]] — {}", wiki_type, title, summary)
    };

    // 将现有内容按节解析为 Vec<(section_header, Vec<entry>)>
    let mut sections: Vec<(String, Vec<String>)> = Vec::new();
    let mut current_section: Option<String> = None;
    let mut current_entries: Vec<String> = Vec::new();

    for line in existing.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("## ") {
            // 保存上一节
            if let Some(sec) = current_section.take() {
                sections.push((sec, std::mem::take(&mut current_entries)));
            }
            current_section = Some(trimmed.to_string());
        } else if trimmed.starts_with("- [[") && current_section.is_some() {
            current_entries.push(trimmed.to_string());
        }
        // 空行和非条目行直接跳过
    }
    if let Some(sec) = current_section.take() {
        sections.push((sec, current_entries));
    }

    // 提取已有条目的 wikilink 前缀（去掉 " — summary" 部分），用于去重
    let wikilink_prefix = format!("[[{}/{}]]", wiki_type, title);
    let is_dup = |entry: &str| -> bool {
        let link_part = entry.trim_start_matches("- ").split(" — ").next().unwrap_or("");
        link_part == wikilink_prefix
    };

    // 找到目标节（不存在则创建）
    let target_header = format!("## {}", wiki_type);
    let target_idx = sections.iter().position(|(h, _)| h == &target_header);

    match target_idx {
        Some(idx) => {
            let entries = &mut sections[idx].1;
            // 去重：已有相同 wikilink 则跳过
            if entries.iter().any(|e| is_dup(e)) {
                info!("索引条目已存在，跳过: {} / {}", wiki_type, title);
                return Ok(());
            }
            // 按 title 字母序插入（按 wikilink 前缀排序，忽略 summary）
            let sort_key = format!("- {}", wikilink_prefix);
            let insert_pos = entries
                .binary_search_by(|e| e.split(" — ").next().unwrap_or("").cmp(&sort_key))
                .unwrap_or_else(|pos| pos);
            entries.insert(insert_pos, new_entry);
        }
        None => {
            // 新建节，插入到正确位置
            let insert_pos = WIKI_TYPES
                .iter()
                .position(|&s| s == wiki_type)
                .unwrap_or(WIKI_TYPES.len());
            // 找到应插入的 section 位置
            let mut section_pos = sections.len();
            for (i, (header, _)) in sections.iter().enumerate() {
                let sec_name = header.trim_start_matches("## ");
                if let Some(pos) = WIKI_TYPES.iter().position(|&s| s == sec_name) {
                    if pos > insert_pos {
                        section_pos = i;
                        break;
                    }
                }
            }
            sections.insert(
                section_pos,
                (target_header, vec![new_entry]),
            );
        }
    }

    // 重建 index.md 内容，按 WIKI_TYPES 顺序排列
    let mut section_map: std::collections::BTreeMap<usize, Vec<String>> = std::collections::BTreeMap::new();
    for (header, entries) in &sections {
        let sec_name = header.trim_start_matches("## ");
        let order = WIKI_TYPES.iter().position(|&s| s == sec_name).unwrap_or(99);
        let mut lines = vec![header.clone()];
        lines.extend(entries.iter().cloned());
        lines.push(String::new()); // 末尾空行
        section_map.entry(order).or_default().extend(lines);
    }

    let mut output = String::new();
    for (_order, lines) in section_map {
        for line in lines {
            output.push_str(&line);
            output.push('\n');
        }
    }

    std::fs::write(&index_path, output).map_err(|e| e.to_string())?;

    info!("已追加索引: {} / {}", wiki_type, title);
    Ok(())
}

// ── Ensure wiki directories exist in project ────────────────────

#[tauri::command]
fn ensure_wiki_dirs(app: tauri::AppHandle, project_name: String) -> Result<(), String> {
    let ws_path = get_workspace_path(&app)?;
    let project_base = ws_path.join(&project_name);
    info!("确保 Wiki 目录结构存在: {}", project_name);
    create_wiki_dirs(&project_base)
}

// ── App entry point ─────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;
            info!("stock-wiki 后端已启动");
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
            // Files
            list_directory,
            create_file,
            create_folder,
            read_file,
            write_file,
            delete_file,
            import_file,
            // Wiki
            check_wiki_exists,
            read_wiki,
            write_wiki,
            ensure_wiki_dirs,
            append_wiki_index,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
