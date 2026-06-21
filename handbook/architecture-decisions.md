# Architecture Decisions — stock-wiki

> 通过 `/grill-me` 访谈确定的技术选型与设计决策。2026-06-21。

## 1. 产品定位

个人股票研究知识库。以"项目"（股票/研究主题文件夹）为组织单位，存储分析笔记和数据文件。

## 2. 核心决策

| # | 决策点 | 选择 |
|---|---|---|
| 1 | 定位 | 个人股票研究知识库 |
| 2 | 项目定义 | 一个文件夹 = 一只股票 / 一个研究主题 |
| 3 | 浏览方式 | 文件树侧边栏 + Markdown 渲染预览 |
| 4 | 存储位置 | 用户选工作区根目录，项目在其下 |
| 5 | 新建项目初始内容 | 空文件夹 |
| 6 | 文件操作范围 | 创建/重命名/删除/编辑 Markdown + 拖拽移动 + 导入外部文件 |
| 7 | 编辑方式 | 分屏：左侧源码编辑，右侧实时预览 |
| 8 | Rust 后端职责 | 文件系统 CRUD（读/写/创建/删除/重命名/列出目录） |
| 9 | Markdown 编辑器 | **Milkdown**（编辑态），**react-markdown**（只读预览） |
| 10 | UI | Tailwind CSS + Radix UI |
| 11 | 路由 | React Router：项目列表页 / 项目详情页（嵌套路由：编辑/预览模式）/ 设置页 |
| 12 | Tauri 版本 | **v2**（最新稳定版） |
| 13 | 构建工具 | **Vite** + **pnpm** |
| 14 | 状态管理 | **Zustand** |
| 15 | 工作区选择 | 首次启动向导（系统文件夹选择对话框），路径持久化，设置页可改 |
| 16 | 主题 | 暗色/亮色自动切换（跟随系统） |
| 17 | 文件变更监听 | **手动刷新按钮**，不做文件系统 watch |
| 18 | 拖拽 | 文件树内拖拽移动 + 从外部拖入文件到项目 |
| 19 | 脚手架 | `pnpm create tauri-app`（React + TypeScript + Vite） |

## 3. 页面结构

```
/                        → 项目列表页（工作区根目录下的项目一览）
/project/:projectName    → 项目详情页
  ├─ 左侧：文件树
  └─ 右侧：编辑器 / 预览器
/settings                → 设置页（切换工作区根目录等）
```

## 4. 技术栈速览

```
┌─────────────────────────────────────────┐
│  Frontend (React 18 + TypeScript)       │
│  ├─ Vite              (构建)            │
│  ├─ Tailwind CSS      (样式)            │
│  ├─ Radix UI          (无头组件)         │
│  ├─ React Router v6   (路由)            │
│  ├─ Zustand           (状态管理)         │
│  ├─ Milkdown          (Markdown 编辑)    │
│  └─ react-markdown    (Markdown 渲染)    │
├─────────────────────────────────────────┤
│  Backend (Rust / Tauri v2)              │
│  ├─ tauri::command    (IPC 命令)        │
│  ├─ std::fs           (文件系统操作)     │
│  └─ serde             (序列化)           │
└─────────────────────────────────────────┘
```

## 5. 后端命令清单（计划）

| 命令 | 对应操作 |
|---|---|
| `select_workspace` | 打开系统文件夹选择对话框，持久化路径 |
| `get_workspace` | 获取当前工作区根目录路径 |
| `list_projects` | 列出工作区下所有项目（子文件夹） |
| `create_project` | 在工作区下创建新项目（空文件夹） |
| `delete_project` | 删除项目文件夹 |
| `rename_project` | 重命名项目文件夹 |
| `list_directory` | 列出指定目录下的文件和子文件夹 |
| `create_file` | 创建文件（含初始内容） |
| `create_folder` | 创建文件夹 |
| `read_file` | 读取文本文件内容 |
| `write_file` | 写入文本文件内容 |
| `delete_file` | 删除文件/文件夹 |
| `rename_file` | 重命名文件/文件夹 |
| `move_file` | 移动文件/文件夹（用于拖拽） |
