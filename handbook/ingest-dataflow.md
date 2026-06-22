# Ingest 数据流

## 概述

ingest 管道将一个外部源文档（研报、新闻等）导入 Wiki，经 LLM 分析后自动创建 / 更新 Wiki 页面。管道共 6 个阶段，前 2 个阶段由 LLM 驱动，后 4 个阶段执行写入。

```
源文件 (.md / .txt)
    │
    ▼
Stage 1: 分析 (LLM)          → analysisText (中文报告)
    │
    ▼
Stage 2: 规划 (LLM + 对账)   → IngestPlan (JSON)
    │
    ├─► Stage 3: 批量更新     → LLM 输出 JSON+BODY 分块
    └─► Stage 4: 批量新建     → LLM 输出 JSON+BODY 分块
              │
              ▼
         parseAndWriteFileBlocks()
              │  JSON → buildJsonFrontmatter() → 有序 JSON
              │  拼装 ---json\n{json}\n---\n\n{body}
              ▼
         invoke("write_wiki")
              │  Rust normalize_frontmatter() 校验 JSON + 按规范顺序重排
              ▼
         fs::write() → .md 落盘
              │
              ▼
         Housekeeping          → 写 log, 更新 index.md
```

## 简单示例

**假设场景**：导入一份源文件 `沃格光电深度研报.md`，其中提到沃格光电（股票）、玻璃基板（概念），并建议关注消费电子板块。

---

### 输入：源文件

```
文件名: 沃格光电深度研报.md
内容: 沃格光电（SZ301580）是国内玻璃基板龙头，受益于消费电子复苏。
       预计2026年净利润同比增长30%。玻璃基板是芯片封装的关键材料，
       国产替代空间大。消费电子板块整体处于景气上行周期。
```

---

### Stage 1 输出：analysisText（LLM 生成的中文分析报告，纯文本）

```
### 1. 提到的实体

- **沃格光电**（股票，索引中不存在）：核心实体。文档提供了主营业务
  （玻璃基板）、股票代码 SZ301580、业绩预测（净利润+30%）等信息。
- **玻璃基板**（概念，索引中不存在）：核心概念。文档指出其为芯片
  封装关键材料，国产替代空间大。
- **消费电子**（概念，索引中已存在）：边缘实体。文档认为板块处于
  景气上行周期，可补充到已有页面。

### 2. 核心论点和数据

主要结论：沃格光电作为玻璃基板龙头，受益消费电子复苏和国产替代。
关键数据：股票代码 SZ301580，2026 年净利润预计增长 30%。

### 3. 实体之间的关联

- 沃格光电 → 归属概念：玻璃基板、消费电子
- 玻璃基板 → 归属概念：消费电子（子概念）

### 4. 与已有 Wiki 的关系

- 消费电子页面已存在，可补充玻璃基板子方向的信息。

### 5. 不一致与疑点

暂无。

### 6. 页面变更建议

- 新建「股票/沃格光电」：索引中尚无该股票页面
- 新建「概念/玻璃基板」：索引中尚无该概念页面
- 更新「概念/消费电子」：补充玻璃基板方向和景气周期判断
- 新建「总结/沃格光电深度研报」：源文档分析记录
```

---

### Stage 2 输出：IngestPlan（LLM JSON + normalizePlan 对账后）

LLM 首先返回结构化 JSON：

```json
{
  "create": [
    {
      "type": "股票",
      "title": "沃格光电",
      "rationale": "索引中无该股票页面，文档提供了代码、主营业务、业绩预测",
      "code": "SZ301580",
      "industry": "电子",
      "concepts": ["玻璃基板", "消费电子"]
    },
    {
      "type": "概念",
      "title": "玻璃基板",
      "rationale": "索引中无该概念页面，文档指出其为芯片封装关键材料",
      "parent": "消费电子",
      "catalysts": ["国产替代", "消费电子复苏"]
    },
    {
      "type": "总结",
      "title": "沃格光电深度研报",
      "rationale": "源文档分析记录"
    }
  ],
  "update": [
    {
      "type": "概念",
      "title": "消费电子",
      "rationale": "补充玻璃基板方向和景气周期判断"
    }
  ]
}
```

然后 `normalizePlan()` 与 `index.md` 中的已有条目对账，得到最终的 `IngestPlan`：

```json
{
  "create": [
    {
      "type": "股票",
      "title": "沃格光电",
      "action": "create",
      "code": "SZ301580",
      "industry": "电子",
      "concepts": ["玻璃基板", "消费电子"],
      "rationale": "索引中无该股票页面，文档提供了代码、主营业务、业绩预测"
    },
    {
      "type": "概念",
      "title": "玻璃基板",
      "action": "create",
      "parent": "消费电子",
      "catalysts": ["国产替代", "消费电子复苏"],
      "rationale": "索引中无该概念页面，文档指出其为芯片封装关键材料"
    },
    {
      "type": "总结",
      "title": "沃格光电深度研报",
      "action": "create",
      "rationale": "源文档分析记录"
    }
  ],
  "update": [
    {
      "type": "概念",
      "title": "消费电子",
      "action": "update",
      "existing_path": "wiki/概念/消费电子.md",
      "rationale": "补充玻璃基板方向和景气周期判断"
    }
  ],
  "analysisSummary": ""
}
```

> **对账规则**：LLM 说 create 但 index 里已有 → 升级为 update；LLM 说 update 但 index 里没有 → 降级为 create；跨 create/update 去重。

---

### Stage 3 输出：更新的已有页面

LLM 为 `update` 列表中的每个页面输出两部分：**元数据 JSON** + `====BODY====` + **正文 Markdown**，用 `---FILE:` / `ENDFILE` 分隔：

```
---FILE: wiki/概念/消费电子.md---
{
  "schema_version": 1,
  "title": "消费电子",
  "type": "概念",
  "summary": "涵盖消费电子产业链相关标的与趋势...",
  "created": "2026-05-15 09:00:00",
  "updated": "2026-06-22 14:30:00",
  "last_reviewed": "2026-06-22 14:30:00",
  "parent": "大科技",
  "related": ["[[股票/沃格光电]]"],
  "sources": ["沃格光电深度研报"]
}
====BODY====
# 消费电子

## 概述

消费电子板块涵盖智能手机、PC、可穿戴设备等终端产业链...

## 玻璃基板方向（新增）

玻璃基板是芯片封装的关键材料，国产替代空间大。
沃格光电为该领域龙头，受益于消费电子复苏...

ENDFILE
```

> `parseAndWriteFileBlocks()` 按 `====BODY====` 切分后，JSON 部分经 `buildJsonFrontmatter()` 转为有序 JSON frontmatter，正文保持原样。

> 关键规则：**保留所有已有内容**，只追加新段落；不删除、不重写。

---

### Stage 4 输出：新建的页面

LLM 为 `create` 列表中的每个页面生成**元数据 JSON** + `====BODY====` + **正文 Markdown**：

```
---FILE: wiki/股票/沃格光电.md---
{
  "schema_version": 1,
  "title": "沃格光电",
  "type": "股票",
  "summary": "国内玻璃基板龙头，受益消费电子复苏和国产替代，2026年净利润预计增长30%",
  "created": "2026-06-22 14:30:00",
  "updated": "2026-06-22 14:30:00",
  "last_reviewed": "2026-06-22 14:30:00",
  "code": "SZ301580",
  "industry": "电子",
  "concepts": ["玻璃基板", "消费电子"],
  "sources": ["沃格光电深度研报"]
}
====BODY====
# 沃格光电

## 公司概况

沃格光电（SZ301580）是国内玻璃基板龙头企业...

ENDFILE
---FILE: wiki/概念/玻璃基板.md---
{
  "schema_version": 1,
  "title": "玻璃基板",
  "type": "概念",
  "summary": "芯片封装关键材料，国产替代空间大，龙头沃格光电",
  "created": "2026-06-22 14:30:00",
  "updated": "2026-06-22 14:30:00",
  "last_reviewed": "2026-06-22 14:30:00",
  "parent": "消费电子",
  "catalysts": ["国产替代", "消费电子复苏"],
  "sources": ["沃格光电深度研报"]
}
====BODY====
# 玻璃基板

## 概述

玻璃基板是芯片封装的关键材料...（从分析结果展开）

ENDFILE
---FILE: wiki/总结/沃格光电深度研报.md---
{
  "schema_version": 1,
  "title": "沃格光电深度研报",
  "type": "总结",
  "summary": "源文档分析记录：沃格光电深度研报",
  "created": "2026-06-22 14:30:00",
  "updated": "2026-06-22 14:30:00",
  "last_reviewed": "2026-06-22 14:30:00",
  "sources": ["沃格光电深度研报"]
}
====BODY====
# 沃格光电深度研报

（源文档的核心摘要和观点记录...）

ENDFILE
```

> 每个页面以 `---FILE: wiki/{type}/{title}.md---` 开头，独占一行 `ENDFILE` 结尾。
> `parseAndWriteFileBlocks()` 按 `====BODY====` 切分 JSON 和正文，`buildJsonFrontmatter()` 将 JSON 按规范顺序重排，拼装为完整 `.md`（`---json\n{json}\n---\n\n{body}`）后调用 `write_wiki` 写入。
> Rust 端 `normalize_frontmatter()` 做二次校验：解析 JSON → 按规范顺序重新序列化 → 落盘。旧 YAML 格式文件写入时自动迁移为 JSON。

---

### Housekeeping

写入 `wiki/logs/log-2026-06-22.md`（追加到末尾，按日期分片）：

```markdown
# Wiki Log 2026-06-22

## [2026-06-22] ingest | 沃格光电深度研报.md
create 3
- wiki/股票/沃格光电.md
- wiki/概念/玻璃基板.md
- wiki/总结/沃格光电深度研报.md
update 1
- wiki/概念/消费电子.md
Pages written/updated: 4
```

> 新建和更新分开标注（`create N` / `update N`），使用 `wiki/type/title.md` 路径而非 wikilink。

更新 `wiki/index.md`：为每个新建页面追加一条带 summary 的条目。summary 从页面 frontmatter 中读取（50-120 字），非 LLM Stage 2 的 rationale：

```markdown
## 概念
- [[概念/玻璃基板]] — 芯片封装关键材料，国产替代空间大，龙头沃格光电
- [[概念/消费电子]] — 涵盖消费电子产业链相关标的与趋势，包括智能手机、可穿戴、玻璃基板等方向
```

> 已存在条目不重复追加（按 wikilink 前缀去重），按标题字母序排列。

---

## 管道状态机

整个管道由 `PipelineState.status` 驱动，状态流转如下：

```
idle → extracting → analyzing (Stage 1) → planning (Stage 2)
  → awaiting_confirmation           ← 等待用户确认计划
  → updating (Stage 3)              ← 批量更新已有页面
  → creating (Stage 4)              ← 批量新建页面
  → housekeeping                    ← 写日志 + 更新索引
  → done
```

任意阶段出错 → `error`。
