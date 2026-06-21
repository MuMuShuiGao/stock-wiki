# Architecture Decisions — stock-wiki

> 通过 `/grill-me` 访谈确定的技术选型与设计决策。2026-06-21。

---

## 1. 产品定位

个人股票研究知识库。以"项目"（股票/研究主题文件夹）为组织单位，存储分析笔记和由 LLM 生成的 Wiki 页面。

核心工作流：**源文件 → LLM 分析 → 生成 Wiki 页面**。

---

## 2. 技术栈

```
┌─────────────────────────────────────────┐
│  Frontend (React 19 + TypeScript)       │
│  ├─ Vite              (构建)            │
│  ├─ Tailwind CSS v4   (样式)            │
│  ├─ Radix UI          (无头组件)         │
│  ├─ React Router v7   (路由)            │
│  ├─ Zustand v5        (状态管理)         │
│  ├─ Milkdown          (Markdown 编辑)    │
│  └─ react-markdown    (Markdown 渲染)    │
├─────────────────────────────────────────┤
│  Backend (Rust / Tauri v2)              │
│  ├─ tauri::command    (IPC 命令)        │
│  ├─ std::fs           (文件系统操作)     │
│  ├─ serde / serde_json (序列化)          │
│  └─ 文件格式转换 (PDF/Excel/CSV → text)  │
├─────────────────────────────────────────┤
│  LLM (云端 API)                         │
│  ├─ OpenAI 兼容 endpoint (可配置)       │
│  ├─ API Key: 明文存储于应用配置          │
│  └─ 预分析: JSON Schema 结构化输出       │
└─────────────────────────────────────────┘
```

---

## 3. 核心功能决策

| # | 决策点 | 选择 |
|---|--------|------|
| 1 | 定位 | 个人股票研究知识库 |
| 2 | 项目定义 | 一个文件夹 = 一只股票 / 一个研究主题 |
| 3 | 浏览方式 | 文件树侧边栏 + Markdown 渲染预览 |
| 4 | 存储位置 | 用户选工作区根目录，项目在其下 |
| 5 | 新建项目初始内容 | 空文件夹 |
| 6 | 文件操作范围 | 创建/重命名/删除/编辑 Markdown + 拖拽移动 + 导入外部文件 |
| 7 | 编辑方式 | 分屏：左侧源码编辑，右侧实时预览 |
| 8 | Rust 后端职责 | 文件系统 CRUD + 文件格式转换 (PDF/Excel/CSV → text) |
| 9 | Markdown 编辑器 | **Milkdown**（编辑态），**react-markdown**（只读预览） |
| 10 | UI | Tailwind CSS + Radix UI |
| 11 | 路由 | React Router：项目列表页 / 项目详情页 / 设置页 |
| 12 | Tauri 版本 | **v2**（最新稳定版） |
| 13 | 构建工具 | **Vite** + **pnpm** |
| 14 | 状态管理 | **Zustand** |
| 15 | 工作区选择 | 首次启动向导（系统文件夹选择对话框），路径持久化，设置页可改 |
| 16 | 主题 | 暗色/亮色自动切换（跟随系统） |
| 17 | 文件变更监听 | **手动刷新按钮**，不做文件系统 watch |
| 18 | 拖拽 | 文件树内拖拽移动 + 从外部拖入文件到项目 |
| 19 | 脚手架 | `pnpm create tauri-app`（React + TypeScript + Vite） |

---

## 4. LLM 管道

### 4.1 触发方式

| 方式 | 描述 | 状态 |
|------|------|------|
| 右键分析 | 文件树右键 → "分析" → 预分析 → 确认实体 → 批量生成 Wiki | ✅ 实现 |
| 浮动聊天面板 | 可折叠侧面板，对话式提问，@提及文件引用上下文，结果可保存为 Wiki | ⏸️ 暂缓 |

### 4.2 端到端流程

```
源文件 (raw/ 目录下 PDF/Excel/CSV/Markdown)
  │
  ▼
Rust 后端: 格式转换 → 纯文本
  │
  ▼
LLM 预分析 (JSON Schema 强制输出):
  扫描文本 → 实体列表
  [
    { "type": "股票", "title": "爱迪特", "code": "300667", "industry": "医疗器械", "concepts": ["口腔医疗"], "action": "update", "existing_path": "wiki/股票/爱迪特.md" },
    { "type": "概念", "title": "口腔医疗器械", "action": "create" },
    { "type": "概念", "title": "集采政策", "action": "create" }
  ]
  │
  ▼
前端验证: 代码验证函数检查字段完整性 & 类型枚举值
  ├─ 失败 → 错误消息反馈给 LLM，重试 (最多 3 次)
  └─ 成功 → 展示实体列表供用户确认
  │
  ▼
用户确认模态框:
  - 勾选/取消实体
  - 标记重复实体 (action: "update" → 展示差异视图)
  - action: "create" → 从零生成
  - action: "update" → 合并新旧内容，差异视图审查
  │
  ▼
LLM 逐实体生成 Wiki:
  输出: YAML frontmatter + 自由 Markdown 正文
  │
  ▼
保存: project/wiki/{type}/{title}.md
```

### 4.3 去重逻辑

后端检查 `wiki/{type}/{title}.md` 是否存在 → 为实体设置 `action`:

- **`create`**: 目标路径不存在 → 从零生成
- **`update`**: 目标路径已存在 → LLM 合并新旧内容 → 差异视图展示 → 用户审查确认

### 4.4 更新合并策略

| 步骤 | 描述 |
|------|------|
| 1 | LLM 读取现有 Wiki 内容 + 新源数据 |
| 2 | LLM 生成合并后的完整 Wiki (智能融入新信息，保留用户手动编辑) |
| 3 | 前端以差异视图展示变更 (added / removed / modified) |
| 4 | 用户接受、拒绝或按章节编辑 |
| 5 | 确认后写入文件，更新 `updated` 字段 |

---

## 5. Wiki 页面 Schema

### 5.1 文件结构

```
project/
├─ raw/                   # 原始数据（输入）
│  ├─ 源数据文件.pdf
│  └─ 源数据文件.csv
└─ wiki/                  # LLM 生成（输出）
   ├─ 股票/
   │  ├─ 爱迪特.md
   │  └─ 贵州茅台.md
   ├─ 概念/
   │  ├─ 口腔医疗器械.md
   │  └─ 集采政策.md
   └─ 模式/
      └─ 头肩底.md
```

### 5.2 前导元数据字段

**通用字段（所有类型必填）：**

| 字段 | 类型 | 描述 |
|------|------|------|
| `title` | string | 实体名称 |
| `type` | enum | `股票` \| `概念` \| `模式` |
| `summary` | string | 50-120 字概述，仅用于检索召回 |
| `created` | ISO date | 首次创建日期 |
| `updated` | ISO date | 最后更新日期 |
| `resource` | string[] | 来源/参考链接列表 |

**股票类型额外字段：**

| 字段 | 类型 | 描述 |
|------|------|------|
| `code` | string | 股票代码 (如 `300667`) |
| `industry` | string | 所属行业 |
| `concepts` | string[] | 关联概念列表 |

### 5.3 正文

Frontmatter 之后为自由格式 Markdown 正文，无 Schema 约束，由 LLM 自行组织内容结构。

### 5.4 完整示例

```markdown
---
title: 爱迪特
type: 股票
summary: 爱迪特（Aidite）是国内口腔医疗器械龙头，主营氧化锆义齿材料及数字化解决方案，受益于种植牙集采政策下的渗透率提升。
created: 2026-06-21
updated: 2026-06-21
resource:
  - 爱迪特2025年报.pdf
  - 东方财富-口腔医疗行业深度报告.pdf
code: "300667"
industry: 医疗器械
concepts:
  - 口腔医疗
  - 集采受益
  - 消费医疗
---

# 爱迪特

## 公司概况

爱迪特（Aidite）... (自由 Markdown 正文)
```

---

## 6. LLM 配置

| 配置项 | 描述 |
|--------|------|
| 端点 | 单一 OpenAI 兼容 base URL (可配置) |
| 默认端点 | `https://api.deepseek.com` (可替换) |
| API Key | 明文存储于应用 `config.json` |
| 预分析输出格式 | `response_format: { type: "json_schema" }` |
| Wiki 生成输出格式 | 自由文本 (Markdown) |

### 6.1 预分析验证

纯代码验证函数（不使用 LLM），检查内容：

1. 是否为合法 JSON 数组
2. 每个元素是否包含必填字段 (`type`, `title`)
3. `type` 值是否在 `["股票", "概念", "模式"]` 枚举范围内
4. 股票类型实体是否包含 `code`, `industry`, `concepts` 字段
5. `action` 值是否为 `"create"` 或 `"update"`

不符合要求 → 将错误信息反馈给 LLM → 重试（最多 3 次）。

---

## 7. 页面结构

```
/                        → 项目列表页
/project/:projectName    → 项目详情页
  ├─ 左侧: 文件树
  └─ 右侧: 编辑器 / 预览器
/settings                → 设置页
  ├─ 工作区路径
  ├─ LLM 端点配置
  ├─ API Key
  └─ 主题信息
```

---

## 8. 后端命令清单

### 8.1 工作区

| 命令 | 描述 |
|------|------|
| `select_workspace` | 打开系统文件夹选择对话框，持久化路径 |
| `get_workspace` | 获取当前工作区根目录路径 |

### 8.2 项目

| 命令 | 描述 |
|------|------|
| `list_projects` | 列出工作区下所有项目（子文件夹） |
| `create_project` | 创建新项目（空文件夹） |
| `delete_project` | 删除项目文件夹 |
| `rename_project` | 重命名项目文件夹 |

### 8.3 文件操作

| 命令 | 描述 |
|------|------|
| `list_directory` | 列出指定目录下的文件和子文件夹 |
| `create_file` | 创建文件（含初始内容） |
| `create_folder` | 创建文件夹 |
| `read_file` | 读取文本文件内容 |
| `write_file` | 写入文本文件内容 |
| `delete_file` | 删除文件/文件夹 |
| `rename_file` | 重命名文件/文件夹 |
| `move_file` | 移动文件/文件夹（用于拖拽） |

### 8.4 文件格式转换（新增）

| 命令 | 描述 |
|------|------|
| `extract_text` | 将 PDF/Excel/CSV 文件转换为纯文本 |

### 8.5 LLM 配置（新增）

| 命令 | 描述 |
|------|------|
| `get_llm_config` | 获取 LLM 端点配置和 API Key |
| `set_llm_config` | 持久化 LLM 端点配置和 API Key |

### 8.6 Wiki 管理（新增）

| 命令 | 描述 |
|------|------|
| `check_wiki_exists` | 检查 `wiki/{type}/{title}.md` 是否存在 (去重) |
| `read_wiki` | 读取现有 Wiki 页面内容 (用于合并) |
| `write_wiki` | 写入 Wiki 页面 (create 或 update) |

---

## 9. 待实现特性

| 优先级 | 特性 | 状态 |
|--------|------|------|
| P0 | 文件格式转换 (Rust 后端: PDF/Excel/CSV → text) | 待实现 |
| P0 | LLM 预分析管道 + 验证 | 待实现 |
| P0 | 实体确认模态框 (create/update 标记) | 待实现 |
| P0 | Wiki 生成 + 保存 | 待实现 |
| P0 | 差异视图 (update 合并审查) | 待实现 |
| P1 | 设置页面 LLM 配置 UI | 待实现 |
| P1 | Milkdown 编辑器集成 | 待实现 |
| P1 | react-markdown 预览 | 待实现 |
| P2 | 浮动聊天面板 + @文件引用 | ⏸️ 暂缓 |
| P2 | RAG 嵌入索引 | ⏸️ 暂缓 |
