# Wikilink 目录注入 — 技术设计

## 目标

LLM 在 Stage 3/4 生成/更新正文时，自动插入已有页面的 wikilink。

## 问题

`STAGE3_UPDATE_PROMPT` 和 `STAGE4_CREATE_PROMPT` 虽有一句「正文中如引用 wikilink，格式为 `[[type/title]]`」，但 LLM 不知道**有哪些页面可以引**，只能从 prose 格式的 analysisText 里猜。

## 方案

在 prompt 中插入结构化的 wikilink 目录块，让 LLM 看着目录写正文。

```
## 可用 Wikilink 目录

### 已有页面
- [[股票/爱迪特]] — 口腔医疗器械龙头
- [[概念/口腔医疗]] — 齿科产业链

### 本轮新建页面（同批次，正文中也可引用）
- [[股票/沃格光电]] — 玻璃基板供应商
```

### 目录数据来源

| 部分 | 来源 | 可用时机 | 说明 |
|------|------|----------|------|
| 已有页面 | `index.md` | Stage 2 已读取 | 每条格式 `[[type/title]] — summary`，regex 同时抓 wikilink 和 summary |
| 本轮新建 | `plan.create[]` | Stage 2 产出 | 用 type+title 拼 wikilink，用 `rationale` 当摘要 |

—— Stage 2 产出计划后就能拼出完整目录，**不需要等 housekeeping 更新 index.md**。

### `buildWikilinkCatalog(indexContent, catalogPages)`

1. regex 解析 `index.md` 中 `[[type/title]] — summary` → Map
2. 从 `catalogPages`（= `[...plan.create, ...plan.update]`）取不在 index 中的页面
3. 拼接为两段 Markdown（已有 / 本轮新建）
`catalogPages` 统一传全部页面，确保 Stage 3（更新）也能看到同批次 create 页面。实际「本轮新建」部分只出现尚未写入 index 的页面（即 plan.create），update 页面已在 index 中故自动归入「已有页面」。

## 防止过度链接

prompt 规则：
- **首次提及用 wikilink，后续用纯文本**——避免满篇重复链接
- **利用目录中的摘要判断相关性**——不相关的页面不要硬链

## Prompt 改动

1. `STAGE3_UPDATE_PROMPT` / `STAGE4_CREATE_PROMPT`：在 `{pagesJson}` 之后插入 `## 可用 Wikilink 目录` + `{WIKILINK_CATALOG}` 占位
2. `BODY_FORMAT_BLOCK`：原一句话扩展为 5 条 wikilink 引用规则
3. `batchWritePages` 新增 `indexContent` + `catalogPages` 字段，调用 `buildWikilinkCatalog()` 替换占位
4. `batchCreateWikiPages` / `batchUpdateWikiPages` 签名新增 `indexContent` + `catalogPages`
5. `appStore.ts` `confirmPlan` 计算 `allPages = [...plan.create, ...plan.update]` 传给两个 batch 函数

## 边界情况

- **第一批 ingest（index.md 不存在）**：已有页面部分为空，只列同批次 peer
- **单页创建**：同批次部分只有一个页面，LLM 主要引已有页面
- **update 页面**：也能引同批次的 create 页面
