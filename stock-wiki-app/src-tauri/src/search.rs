use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::sync::OnceLock;

use log::info;

// ── Types ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SearchResult {
    pub path: String,
    pub title: String,
    pub wiki_type: String,
    pub score: f64,
    pub content: String,
}

// ── Constants ──────────────────────────────────────────────────────

const MAX_RESULTS: usize = 20;
const WIKI_TYPES: &[&str] = &["股票", "概念", "模式", "市场环境", "总结"];

/// 每页的命中信息（内部使用，最终不对外暴露）
struct PageHitInfo {
    path: String,
    title: String,
    wiki_type: String,
    content: String,
    score: f64,
}

// ── CJK detection ──────────────────────────────────────────────────

/// 检测字符是否属于 CJK（中日韩统一表意文字）区块。
/// 覆盖基本区及常用扩展区。
fn is_cjk(c: char) -> bool {
    matches!(
        c as u32,
        0x4E00..=0x9FFF   // CJK Unified Ideographs
        | 0x3400..=0x4DBF // CJK Unified Ideographs Extension A
        | 0x20000..=0x2A6DF // CJK Unified Ideographs Extension B
        | 0xF900..=0xFAFF // CJK Compatibility Ideographs
        | 0x2F800..=0x2FA1F // CJK Compatibility Ideographs Supplement
        | 0x3000..=0x303F // CJK Symbols and Punctuation
        | 0xFF00..=0xFFEF // Halfwidth and Fullwidth Forms (contains CJK)
    )
}

// ── N-gram generation ──────────────────────────────────────────────

/// 将文本拆为原子序列：
/// - 每个 CJK 字符独立成一个原子
/// - 连续的非 CJK 字符合并为一个原子
fn atomize(text: &str) -> Vec<String> {
    let mut atoms: Vec<String> = Vec::new();
    let mut buf = String::new();

    for c in text.chars() {
        if c.is_whitespace() {
            // whitespace 作为原子边界：先提交 buf，再丢弃空格本身
            if !buf.is_empty() {
                atoms.push(std::mem::take(&mut buf));
            }
            continue;
        }
        if is_cjk(c) {
            if !buf.is_empty() {
                atoms.push(std::mem::take(&mut buf));
            }
            atoms.push(c.to_string());
        } else {
            buf.push(c);
        }
    }
    if !buf.is_empty() {
        atoms.push(buf);
    }
    atoms
}

/// 从原子序列生成 1/2/3/full 四档 n-gram。
/// 返回去重后的 (token, gram_size) 列表。gram_size: 1=1-gram, 2=2-gram, 3=3-gram, 4+=full。
fn generate_ngrams(atoms: &[String]) -> Vec<(String, usize)> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut results: Vec<(String, usize)> = Vec::new();
    let max_n = atoms.len();

    let mut push = |token: String, n: usize| {
        if seen.insert(token.clone()) {
            results.push((token, n));
        }
    };

    // 1-gram
    for i in 0..max_n {
        push(atoms[i].clone(), 1);
    }
    // 2-gram
    if max_n >= 2 {
        for i in 0..=(max_n - 2) {
            let token: String = atoms[i..i + 2].concat();
            push(token, 2);
        }
    }
    // 3-gram
    if max_n >= 3 {
        for i in 0..=(max_n - 3) {
            let token: String = atoms[i..i + 3].concat();
            push(token, 3);
        }
    }
    // full (4+)
    for n in 4..=max_n {
        for i in 0..=(max_n - n) {
            let token: String = atoms[i..i + n].concat();
            push(token, n);
        }
    }
    results
}

// ── Token weight tables ────────────────────────────────────────────

fn evidence_tokens() -> &'static HashSet<&'static str> {
    static TOKENS: OnceLock<HashSet<&'static str>> = OnceLock::new();
    TOKENS.get_or_init(|| {
        vec![
            "订单", "量价", "产能", "毛利率", "净利率", "营收", "估值", "市盈率", "市净率",
            "现金流", "研发", "专利", "产能利用率", "市场份额", "合同负债", "存货周转",
            "分红", "回购", "定增", "质押", "减持", "增持", "ROE", "ROA", "EBITDA",
            "净利润", "同比增长", "环比增长", "出货量", "订单量", "在手订单",
            "开工率", "库存", "价格", "开工", "产线", "良率", "销量", "吨价", "单价",
            "毛利率趋势", "净利率趋势", "盈利", "盈亏", "拐点", "翻倍",
        ]
        .into_iter()
        .collect()
    })
}

fn time_tokens() -> &'static HashSet<&'static str> {
    static TOKENS: OnceLock<HashSet<&'static str>> = OnceLock::new();
    TOKENS.get_or_init(|| {
        vec![
            "最近", "本周", "上周", "本月", "上月", "今年", "去年", "近期", "昨日",
            "今日", "明天", "下周", "下月", "季度", "半年", "全年", "昨天", "前天",
            "后天", "当前", "目前", "过去", "未来", "历史", "往年",
        ]
        .into_iter()
        .collect()
    })
}

fn generic_tokens() -> &'static HashSet<&'static str> {
    static TOKENS: OnceLock<HashSet<&'static str>> = OnceLock::new();
    TOKENS.get_or_init(|| {
        vec![
            "方向", "投资", "交易", "市场", "公司", "行业", "分析", "风险", "收益",
            "策略", "机会", "趋势", "数据", "报告", "观点", "建议", "关注", "预期",
            "增长", "变化", "影响", "因素", "情况", "持续", "短期", "中期", "长期",
            "整体", "表现", "走势", "发展", "空间", "逻辑", "主线", "赛道",
            "结构", "格局", "节奏", "催化", "驱动", "核心", "关键", "重点", "标的",
            "弹性", "安全边际", "景气度", "确定性",
        ]
        .into_iter()
        .collect()
    })
}

// ── Token weight ───────────────────────────────────────────────────

/// 计算单个 token 的权重。
///
/// 优先级：人工标注 > 硬规则。
/// 人工标注三类精确匹配后直接返回，不继续往下落。
pub fn token_weight(token: &str) -> f64 {
    // 1. 人工标注：EVIDENCE（证据词，强区分度）
    if evidence_tokens().contains(token) {
        return 2.4;
    }
    // 2. 人工标注：TIME（时间词，弱区分度）
    if time_tokens().contains(token) {
        return 0.2;
    }
    // 3. 人工标注：GENERIC（泛化词，极弱区分度）
    if generic_tokens().contains(token) {
        return 0.15;
    }
    // 4. 硬规则：单字 CJK
    if token.chars().count() == 1 {
        if let Some(c) = token.chars().next() {
            if is_cjk(c) {
                return 0.05;
            }
        }
    }
    let char_count = token.chars().count();
    // 5. 硬规则：4 字及以上长词
    if char_count >= 4 {
        return 2.4;
    }
    // 6. 硬规则：三字词
    if char_count == 3 {
        return 1.7;
    }
    // 7. 默认（2 字 bigram）
    1.0
}

// ── Text matching helpers ──────────────────────────────────────────

/// 在文本中搜索 token（忽略大小写）。
/// CJK token 直接子串匹配，ASCII token 不区分大小写匹配。
fn token_in_text(token: &str, text: &str) -> bool {
    // 先尝试直接子串匹配（CJK 及大部分场景）
    if text.contains(token) {
        return true;
    }
    // 不区分大小写匹配（针对 ASCII 混合 token 如 "ROE", "EBITDA"）
    text.to_lowercase().contains(&token.to_lowercase())
}

// ── Scoring ────────────────────────────────────────────────────────

/// topicCoverageBonus：高权重 token 在一段文本中的共现加成。
///
/// 返回 (累加得分, matchedCount)：
/// - 高权重 token 命中累加 token_weight × 1.8
/// - matchedCount >= 2 → +6
/// - matchedCount >= 4 → +6
fn topic_coverage_bonus(text: &str, tokens: &[(String, usize)]) -> (f64, usize) {
    let mut score = 0.0;
    let mut matched: Vec<String> = Vec::new();

    for (token, _gram_size) in tokens {
        let w = token_weight(token);
        if w < 1.0 {
            continue; // 仅高权重 token（threshold >= 1.0）参与
        }
        if token_in_text(token, text) {
            score += w * 1.8;
            matched.push(token.clone());
        }
    }

    let match_count = matched.len();
    if match_count >= 2 {
        score += 6.0;
    }
    if match_count >= 4 {
        score += 6.0;
    }

    (score, match_count)
}

/// 计算单个 wiki 页面对一条查询的得分。
fn score_page(
    path: &str,
    title: &str,
    wiki_type: &str,
    fm_json_text: &str,
    body: &str,
    query_ngrams: &[(String, usize)],
) -> PageHitInfo {
    let mut total_score = 0.0;

    // ── 标题 ──
    let mut title_hit = false;
    let mut title_score = 0.0_f64;
    for (token, _gram_size) in query_ngrams {
        if token_in_text(token, title) {
            title_hit = true;
            title_score += token_weight(token);
        }
    }
    if title_hit {
        total_score += 10.0; // TITLE_BONUS
    }
    total_score += title_score;

    // ── 正文 ──
    let mut content_score = 0.0_f64;
    for (token, _gram_size) in query_ngrams {
        if token_in_text(token, body) {
            content_score += token_weight(token);
        }
    }
    total_score += content_score;

    // ── FM（frontmatter JSON 全文） ──
    let mut fm_score = 0.0_f64;
    for (token, _gram_size) in query_ngrams {
        if token_in_text(token, fm_json_text) {
            fm_score += token_weight(token);
        }
    }
    total_score += fm_score * 4.0;

    // ── topicCoverageBonus：FM 共现 ──
    let (fm_bonus, _fm_count) = topic_coverage_bonus(fm_json_text, query_ngrams);
    total_score += fm_bonus;

    // ── topicCoverageBonus：正文共现 ──
    let (body_bonus, _body_count) = topic_coverage_bonus(body, query_ngrams);
    total_score += body_bonus;

    PageHitInfo {
        path: path.to_string(),
        title: title.to_string(),
        wiki_type: wiki_type.to_string(),
        content: String::new(), // 稍后回填
        score: total_score,
    }
}

// ── Parse frontmatter ──────────────────────────────────────────────

/// 从 wiki 页面内容中提取 frontmatter 部分（`---json` 到 `\n---`）的原始 JSON 文本。
/// 用于 FM 命中打分。返回 (fm_json_text, body_text, title)。
fn parse_wiki_page(content: &str) -> (String, String, String) {
    let content = content.trim_start();
    let (fm_text, body) = if let Some(after_open) = content.strip_prefix("---json") {
        if let Some(close_idx) = after_open.find("\n---") {
            let json_str = after_open[..close_idx].trim();
            let body_text = after_open[close_idx + "\n---".len()..]
                .trim_start_matches('\n')
                .to_string();
            (json_str.to_string(), body_text)
        } else {
            (String::new(), content.to_string())
        }
    } else {
        (String::new(), content.to_string())
    };

    // 从 FM JSON 中提取 title
    let title = if !fm_text.is_empty() {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&fm_text) {
            value
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    (fm_text, body, title)
}

// ── Search entry point ─────────────────────────────────────────────

/// 在项目 wiki 目录中检索与 query 最相关的页面。
///
/// 流程：
/// 1. 对 query 生成 1/2/3/full 四档 n-gram
/// 2. 遍历所有 wiki .md 文件，计算每页得分
/// 3. 按 score 降序排序，返回 Top MAX_RESULTS
pub fn search_wiki_in_project(project_path: &Path, query: &str) -> Result<Vec<SearchResult>, String> {
    let wiki_base = project_path.join("wiki");
    if !wiki_base.exists() {
        return Ok(vec![]);
    }

    let query_atoms = atomize(query);
    let query_ngrams = generate_ngrams(&query_atoms);

    if query_ngrams.is_empty() {
        return Ok(vec![]);
    }

    let mut hits: Vec<PageHitInfo> = Vec::new();

    for wiki_type in WIKI_TYPES {
        let type_dir = wiki_base.join(wiki_type);
        if !type_dir.exists() {
            continue;
        }

        let dir = match fs::read_dir(&type_dir) {
            Ok(d) => d,
            Err(_) => continue,
        };

        for entry in dir {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            let path = entry.path();

            if !path.is_file() {
                continue;
            }

            let file_name = entry.file_name().to_string_lossy().to_string();
            if !file_name.ends_with(".md")
                || file_name.starts_with("index.")
                || file_name.starts_with("log-")
            {
                continue;
            }

            let content = match fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            let file_title = file_name.trim_end_matches(".md").to_string();
            let (fm_json_text, body, fm_title) = parse_wiki_page(&content);

            // title 优先取 frontmatter 中的，没有则用文件名
            let title = if fm_title.is_empty() {
                file_title.clone()
            } else {
                fm_title.clone()
            };

            let path_str = path.to_string_lossy().to_string();

            let mut hit = score_page(&path_str, &title, wiki_type, &fm_json_text, &body, &query_ngrams);
            // 回填完整内容（用于 LLM 喂入）
            hit.content = content;
            hits.push(hit);
        }
    }

    // 按 score 降序排序
    hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    // 截断 top MAX_RESULTS
    let results: Vec<SearchResult> = hits
        .into_iter()
        .take(MAX_RESULTS)
        .map(|h| SearchResult {
            path: h.path,
            title: h.title,
            wiki_type: h.wiki_type,
            score: h.score,
            content: h.content,
        })
        .collect();

    info!(
        "search_wiki: 查询 '{}' → {} 个 n-gram，命中 {} 篇",
        query,
        query_ngrams.len(),
        results.len()
    );

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_cjk() {
        assert!(is_cjk('股'));
        assert!(is_cjk('票'));
        assert!(is_cjk('宁'));
        assert!(!is_cjk('A'));
        assert!(!is_cjk('1'));
    }

    #[test]
    fn test_atomize() {
        let atoms = atomize("宁德时代");
        assert_eq!(atoms, vec!["宁", "德", "时", "代"]);

        let atoms = atomize("CATL宁德");
        assert_eq!(atoms, vec!["CATL", "宁", "德"]);

        let atoms = atomize("2026年");
        assert_eq!(atoms, vec!["2026", "年"]);
    }

    #[test]
    fn test_generate_ngrams() {
        let atoms = atomize("宁德时代");
        let ngrams = generate_ngrams(&atoms);
        // 1g: 宁,德,时,代  2g: 宁德,德时,时代  3g: 宁德时,德时代  full: 宁德时代
        let tokens: HashSet<String> = ngrams.iter().map(|(t, _)| t.clone()).collect();
        assert!(tokens.contains("宁德"));
        assert!(tokens.contains("时代"));
        assert!(tokens.contains("宁德时代"));
        assert!(tokens.contains("宁"));
        assert_eq!(ngrams.len(), 10); // 4×1g + 3×2g + 2×3g + 1×4g
    }

    #[test]
    fn test_token_weight_evidence() {
        assert!((token_weight("订单") - 2.4).abs() < 0.001);
        assert!((token_weight("毛利率") - 2.4).abs() < 0.001);
    }

    #[test]
    fn test_token_weight_time() {
        assert!((token_weight("最近") - 0.2).abs() < 0.001);
        assert!((token_weight("本周") - 0.2).abs() < 0.001);
    }

    #[test]
    fn test_token_weight_generic() {
        assert!((token_weight("投资") - 0.15).abs() < 0.001);
    }

    #[test]
    fn test_token_weight_single_cjk() {
        assert!((token_weight("股") - 0.05).abs() < 0.001);
    }

    #[test]
    fn test_token_weight_length() {
        assert!((token_weight("宁德") - 1.0).abs() < 0.001); // 2字 default
        assert!((token_weight("宁德时") - 1.7).abs() < 0.001); // 3字
        assert!((token_weight("宁德时代") - 2.4).abs() < 0.001); // 4字
    }

    #[test]
    fn test_token_weight_priority() {
        // EVIDENCE 优先于长度规则："产能利用率" 既是 EVIDENCE 又是 5 字
        assert!((token_weight("产能利用率") - 2.4).abs() < 0.001);
        // GENERIC 优先："市场" 是 GENERIC 但只有 2 字
        assert!((token_weight("市场") - 0.15).abs() < 0.001);
    }
}
