# 知识图谱 — 设计决策

> 通过 `/grill-me` 访谈确定。2026-06-23。

---

## 1. 定位

个人股票研究知识库的**可视化图谱**。基于现有 Wiki 实体和 wikilink 关系，以力导向网络图形式呈现项目内的知识结构。

---

## 2. 数据源

### 2.1 索引文件

`project/wiki/.wikilinks.json` — 图谱唯一数据源。Rust housekeeping 阶段全量重建。

### 2.2 节点

key = `type/title`（如 `股票/沃格光电`），与 wikilink 格式一致。

```jsonc
{
  "version": 2,
  "updated": "2026-06-23 14:30:00",
  "nodes": {
    "股票/沃格光电": {
      "type": "股票",
      "title": "沃格光电",
      "summary": "国内玻璃基板龙头...",
      "aliases": ["沃格"],
      "degree": 5,
      "sources": ["source1", "source2", "source3"],
      "x": 120.5,
      "y": -45.3
    }
  },
  "edges": [
    {
      "source": "股票/沃格光电",
      "target": "概念/玻璃基板",
      "score": 0.8,
      "tier": "strong"
    }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `degree` | wikilink 度（仅统计显式 wikilink 边） |
| `sources` | frontmatter `sources` 数组（用于 Jaccard 相似度） |
| `x` / `y` | 布局坐标，初始 `null`，ForceAtlas2 跑完后写入 |

### 2.3 边来源

**wikilink 是边的唯一来源**：

- frontmatter `related` 字段中的 `[[type/title]]`
- 正文中的 `[[type/title]]`（正则提取）

`concepts` 和 `parent` 字段**不转为边**，仅作为节点属性存在。

### 2.4 排除文件

扫描 `wiki/` 目录时排除：
- `wiki/index.md`
- `wiki/logs/log-*.md`
- `wiki/.wikilinks.json` 自身

---

## 3. 边权四信号

### 3.1 整体公式

```
edge_score(A, B) = w₁ × S_direct + w₂ × S_source + w₃ × S_aa + w₄ × S_type
```

默认权重：

| 信号 | 权重 |
|------|------|
| Direct links | 0.50 |
| Source overlap | 0.20 |
| Adamic-Adar | 0.20 |
| Type affinity | 0.10 |

### 3.2 Gate 逻辑

```
if S_direct > 0:
    tier = "strong"       ← 有 wikilink 直接晋级
    score = S_direct      ← 粗细仅由 direct 信号决定
else:
    score = w₂×S_source + w₃×S_aa + w₄×S_type
    if score ≥ 0.20: tier = "suggested"
    else:            tier = "hidden"（不写入 .wikilinks.json）
```

### 3.3 Direct links

邻居定义：**仅 wikilink 连接**（窄定义）。

| 值 | 含义 |
|---|------|
| `1.0` | 双向 wikilink（A→B 且 B→A） |
| `0.6` | 单向 wikilink |

### 3.4 Source overlap

Jaccard 相似度：

```
S_source = |sources(A) ∩ sources(B)| / |sources(A) ∪ sources(B)|
```

双方均无 sources → `0`。

### 3.5 Adamic-Adar

标准公式，邻居 = wikilink 邻居（窄定义）：

```
S_aa = Σ 1 / log(degree(v))   for each v ∈ common_neighbors(A, B)
```

### 3.6 Type affinity

预定义亲和度矩阵（对称）：

| A ╲ B   | 股票 | 概念 | 模式 | 市场环境 | 总结 |
|---------|------|------|------|---------|------|
| 股票    | 0.3  | 0.8  | 0.6  | 0.5     | 0.2  |
| 概念    | 0.8  | 0.4  | 0.5  | 0.6     | 0.2  |
| 模式    | 0.6  | 0.5  | 0.3  | 0.4     | 0.2  |
| 市场环境 | 0.5  | 0.6  | 0.4  | 0.3     | 0.2  |
| 总结    | 0.2  | 0.2  | 0.2  | 0.2     | 0.1  |

---

## 4. 后端（Rust）

### 4.1 `rebuild_wikilinks(project_path: &Path)`

独立函数，在 housekeeping 末尾调用（与 `update_index_md` 同级）。

流程：

1. 遍历 `wiki/` 目录下所有 `.md` 文件（排除 index / log）
2. 每个文件：
   - 解析 frontmatter JSON → `title`, `type`, `summary`, `aliases`, `related`, `sources`
   - 正则匹配正文 `\[\[(.*?)\]\]` → 提取 wikilink 目标
   - 合并 `related` + 正文 wikilink → 去重
3. 计算 `degree`（wikilink 度数）
4. 计算四信号边（strong + suggested），写 `wiki/.wikilinks.json`（坐标字段 `null`）

### 4.2 调用链

```
ingest pipeline:
  Stage 3: batchUpdateWikiPages  ─┐
  Stage 4: batchCreateWikiPages  ─┤
                                  ├─ 各阶段内部调用 write_wiki
  Housekeeping:                   │
    ├─ 写 log                     │
    ├─ 更新 index.md              │
    └─ rebuild_wikilinks()        │  ← 全量重建 .wikilinks.json
```

---

## 5. 布局策略

- **算法**：ForceAtlas2（graphology-layout-forceatlas2）
- **执行位置**：前端 Web Worker（不阻塞 UI）
- **坐标持久化**：跑完自动写回 `.wikilinks.json`
- **不可拖拽**：静态只读布局

---

## 6. 图例

### 节点

| 编码 | 规则 |
|------|------|
| **颜色** | 按实体类型 |
| **大小** | wikilink 度 + sources 归一化 |
| **亮度/饱和度** | sources 独立通道 |

### 边

| tier | 样式 | 粗细 |
|------|------|------|
| strong | 实线，颜色按来源（related=蓝，正文=灰） | 按 score 映射 |
| suggested | 虚线，统一浅色 | 按 score 映射 |

无向边，多条同向边合并。

---

## 7. 实现阶段

| Phase | 内容 |
|-------|------|
| **1** | Rust `rebuild_wikilinks()`（含四信号边计算）+ `.wikilinks.json` schema + Sigma.js 渲染 + 全局 icon bar |
| **2** | 自适应 label / 搜索飞行动画 / 刷新按钮 / 边缘 case |

---

## 8. 边界决策

| # | 决策 |
|---|------|
| 1 | concepts / parent 字段**不**转为边（严格 wikilink） |
| 2 | 节点不可拖拽（静态布局） |
| 3 | `.wikilinks.json` 全量重建，不增量更新 |
| 4 | 图谱刷新：工具栏手动触发，不自动检测 |
| 5 | 空项目无 wiki 页面时显示空状态引导 |
| 6 | sources 只加权不加边（通过 sources 体现在节点视觉上） |
