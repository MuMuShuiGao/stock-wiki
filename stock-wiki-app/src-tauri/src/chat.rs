use std::fs;
use std::path::{Path, PathBuf};

use log::info;

// ── Types ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ConversationMeta {
    pub id: String,
    pub title: String,
    pub created: String,
    pub updated: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ChatMessage {
    pub role: String, // "user" | "assistant"
    pub content: String,
    #[serde(default)]
    pub references: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub created: String,
    pub updated: String,
    pub messages: Vec<ChatMessage>,
}

const MAX_MESSAGES: usize = 100;

// ── Path helpers ───────────────────────────────────────────────────

fn get_llm_wiki_dir(ws_path: &Path, project_name: &str) -> PathBuf {
    ws_path.join(project_name).join(".llm-wiki")
}

fn get_chats_dir(ws_path: &Path, project_name: &str) -> PathBuf {
    get_llm_wiki_dir(ws_path, project_name).join("chats")
}

fn get_conversations_file(ws_path: &Path, project_name: &str) -> PathBuf {
    get_llm_wiki_dir(ws_path, project_name).join("conversations.json")
}

fn get_conv_file(ws_path: &Path, project_name: &str, conv_id: &str) -> PathBuf {
    get_chats_dir(ws_path, project_name).join(format!("{}.json", conv_id))
}

fn ensure_dirs(ws_path: &Path, project_name: &str) -> Result<(), String> {
    let chats = get_chats_dir(ws_path, project_name);
    fs::create_dir_all(&chats).map_err(|e| e.to_string())
}

fn generate_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("conv_{:x}", ts)
}

// ── CRUD ───────────────────────────────────────────────────────────

/// 列出项目所有对话
pub fn list_conversations(ws_path: &Path, project_name: &str) -> Result<Vec<ConversationMeta>, String> {
    Ok(read_conversations_file(ws_path, project_name))
}

/// 读取对话完整内容
pub fn get_conversation(ws_path: &Path, project_name: &str, conv_id: &str) -> Result<Conversation, String> {
    let file = get_conv_file(ws_path, project_name, conv_id);
    if !file.exists() {
        return Err(format!("对话不存在: {}", conv_id));
    }
    let content = fs::read_to_string(&file).map_err(|e| e.to_string())?;
    let conv: Conversation = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(conv)
}

/// 创建新对话
pub fn create_conversation(ws_path: &Path, project_name: &str, title: &str) -> Result<Conversation, String> {
    ensure_dirs(ws_path, project_name)?;

    let id = generate_id();
    let now = super::chrono_now();
    let conv = Conversation {
        id: id.clone(),
        title: title.to_string(),
        created: now.clone(),
        updated: now,
        messages: vec![],
    };

    // 写对话文件
    let file = get_conv_file(ws_path, project_name, &id);
    let content = serde_json::to_string_pretty(&conv).map_err(|e| e.to_string())?;
    fs::write(&file, content).map_err(|e| e.to_string())?;

    // 更新 conversations.json 列表
    let meta = ConversationMeta {
        id: id.clone(),
        title: title.to_string(),
        created: conv.created.clone(),
        updated: conv.updated.clone(),
    };
    append_to_conversations_list(ws_path, project_name, meta)?;

    info!("创建对话: {} - {}", id, title);
    Ok(conv)
}

/// 保存（更新）对话
pub fn save_conversation(
    ws_path: &Path,
    project_name: &str,
    conv_id: &str,
    messages: &[ChatMessage],
    new_title: Option<&str>,
) -> Result<(), String> {
    let file = get_conv_file(ws_path, project_name, conv_id);
    if !file.exists() {
        return Err(format!("对话不存在: {}", conv_id));
    }

    let content = fs::read_to_string(&file).map_err(|e| e.to_string())?;
    let mut conv: Conversation = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    // 截断最近 100 条
    let start = if messages.len() > MAX_MESSAGES {
        messages.len() - MAX_MESSAGES
    } else {
        0
    };
    conv.messages = messages[start..].to_vec();

    let now = super::chrono_now();
    conv.updated = now.clone();

    if let Some(t) = new_title {
        conv.title = t.to_string();
    }

    let updated = serde_json::to_string_pretty(&conv).map_err(|e| e.to_string())?;
    fs::write(&file, updated).map_err(|e| e.to_string())?;

    // 更新 conversations.json 中的时间戳
    update_conversation_meta(ws_path, project_name, conv_id, &now, new_title)?;

    Ok(())
}

/// 删除对话
pub fn delete_conversation(ws_path: &Path, project_name: &str, conv_id: &str) -> Result<(), String> {
    let file = get_conv_file(ws_path, project_name, conv_id);
    if file.exists() {
        fs::remove_file(&file).map_err(|e| e.to_string())?;
    }

    // 从 conversations.json 中移除
    remove_from_conversations_list(ws_path, project_name, conv_id)?;

    info!("已删除对话: {}", conv_id);
    Ok(())
}

// ── Internal helpers ───────────────────────────────────────────────

fn read_conversations_file(ws_path: &Path, project_name: &str) -> Vec<ConversationMeta> {
    let file = get_conversations_file(ws_path, project_name);
    if !file.exists() {
        return vec![];
    }
    let content = fs::read_to_string(&file).unwrap_or_default();
    serde_json::from_str(&content).unwrap_or_default()
}

fn write_conversations_file(
    ws_path: &Path,
    project_name: &str,
    list: &[ConversationMeta],
) -> Result<(), String> {
    ensure_dirs(ws_path, project_name)?;
    let file = get_conversations_file(ws_path, project_name);
    let content = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    fs::write(&file, content).map_err(|e| e.to_string())
}

fn append_to_conversations_list(
    ws_path: &Path,
    project_name: &str,
    meta: ConversationMeta,
) -> Result<(), String> {
    let mut list = read_conversations_file(ws_path, project_name);
    list.push(meta);
    write_conversations_file(ws_path, project_name, &list)
}

fn update_conversation_meta(
    ws_path: &Path,
    project_name: &str,
    conv_id: &str,
    updated: &str,
    new_title: Option<&str>,
) -> Result<(), String> {
    let mut list = read_conversations_file(ws_path, project_name);
    for m in &mut list {
        if m.id == conv_id {
            m.updated = updated.to_string();
            if let Some(t) = new_title {
                m.title = t.to_string();
            }
            break;
        }
    }
    write_conversations_file(ws_path, project_name, &list)
}

fn remove_from_conversations_list(
    ws_path: &Path,
    project_name: &str,
    conv_id: &str,
) -> Result<(), String> {
    let mut list = read_conversations_file(ws_path, project_name);
    list.retain(|m| m.id != conv_id);
    write_conversations_file(ws_path, project_name, &list)
}
