# Wiki 页面 Schema

每个 `.md` 文件以 JSON frontmatter 开头，用 `---json` 开头、`---` 结尾。**绝不**将 frontmatter 包裹在 ````json` 代码块中——直接输出裸的 `---json` / `---`。

## 共有必填字段

```json
{
  "schema_version": 1,
  "title": "贵州茅台",
  "type": "股票",
  "summary": "白酒龙头，高端白酒市占率第一，盈利能力行业领先。",
  "created": "2026-06-22 10:30:00",
  "updated": "2026-06-22 10:30:00",
  "last_reviewed": "2026-06-22 10:30:00"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `schema_version` | number | schema 版本号，当前为 1 |
| `title` | string | 页面标题，必须与文件名（不含 `.md`）一致 |
| `type` | string | 类型: `"股票"` / `"概念"` / `"模式"` / `"市场环境"` / `"总结"` |
| `summary` | string | 50–120 字概述，用于检索召回，严禁照搬正文 |
| `created` | string | 创建时间，格式 `YYYY-MM-DD HH:mm:ss` |
| `updated` | string | 最后更新时间，格式 `YYYY-MM-DD HH:mm:ss` |
| `last_reviewed` | string | 最后审核时间，格式 `YYYY-MM-DD HH:mm:ss` |

## 共有可选字段

```json
{
  "aliases": ["茅台"],
  "tags": ["白酒", "消费"],
  "related": ["[[概念/消费升级]]", "[[股票/五粮液]]"],
  "sources": ["2024年报分析"]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `aliases` | string[] | 别名列表 |
| `tags` | string[] | 标签 |
| `related` | string[] | 关联页面，wikilink 格式 `[[type/name]]` |
| `sources` | string[] | 原始资料来源（文件名，不带 `.md` 后缀） |

## 股票私有字段

```json
{
  "code": "600519",
  "industry": "白酒",
  "concepts": ["消费升级", "白马股"]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | string | 股票代码（**必填**） |
| `industry` | string | 所属行业 |
| `concepts` | string[] | 关联概念列表 |

## 概念私有字段

```json
{
  "parent": "消费行业",
  "catalysts": ["春节消费旺季", "提价预期"]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `parent` | string | 父概念 |
| `catalysts` | string[] | 催化事件列表 |

## 格式规则

- 不得包含重复字段名
- type 等有中文枚举值的字段，**必须输出中文值**，不得使用英文
- 时间字段格式必须为 `YYYY-MM-DD HH:mm:ss`（包含秒），仅 `YYYY-MM-DD` 为无效格式
- 所有字段值使用 JSON 原生类型：字符串用 `"..."`，数组用 `[...]`，数字不写引号

## 市场环境

无私有字段，仅有共有字段。

## 总结

无私有字段，仅有共有字段。

## 模式

无私有字段，仅有共有字段。

## 向后兼容

旧格式（`---` YAML frontmatter）仍可读取。写入时自动迁移为 `---json` 格式。
