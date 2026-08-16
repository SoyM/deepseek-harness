# @deepseek-ai/dsh-soym-evolve

[English](README.md) | 中文

SOYM wiki 量化系统的**跨会话经验闭环**：`soym_learn` 把一条已验证的经验写入 git 可追踪的日志（`<workspace>/.dsh/experience/`），`soym_recall` 把最近的经验读回来，让下一次会话站在上一次的肩膀上。

这个闭环弥合了"本会话学到了什么"与"系统记住了什么"之间的缺口：没有它，每个新会话都会重新踩同样的坑——一次会话验证过的结论在会话结束时丢失。有了它，经验变成可持久、可审阅、可 git diff 的知识。

## 功能

在 `ctx.tools` 上注册两个模型工具：

- **`soym_learn(category, title, body)`** — 把一条经验追加到今天的日志文件（`.dsh/experience/YYYY-MM-DD.md`），必要时自动创建目录和文件。每条经验是一个 markdown 块：

  ```markdown
  ## [category] title

  body
  ```

  工具返回 `{ ok, file, entriesInFile, chars }`，供模型（和 UI）确认持久化成功。

- **`soym_recall(category?)`** — 读取最近 `recallDays` 个日文件的全部经验块，可选按 category 过滤，返回 `{ ok, lessons, text, total, reason? }`。经验按日期倒序排列；`text` 是合并后、受 `maxRecallChars` 上限约束的正文，模型可直接引用。日志为空时返回 `total: 0` 加 `reason`，绝不报错。

## 何时调用

- **会话开始时调用 `soym_recall`** — 在回答投资/框架问题之前，让已验证的结论（被证伪的方案、可用的参数、流程陷阱）进入上下文。
- **会话结束时调用 `soym_learn`** — 记录任何非平凡发现：验证过的结论、避开的坑、决策及其原因、有效的参数。正文要具体可执行（数字+推理，不要空泛感受）。

工具描述逐字固化这些语义；preset persona 应引用它们（persona 写法见 `soym-quant` preset 先例）。

## 配置

`workspace` 必填——SOYM 仓库根目录是部署选择，绝不猜测。可选字段：

| 字段 | 默认 | 含义 |
|---|---|---|
| `journalDir` | `.dsh/experience` | 日志目录，相对于 workspace。 |
| `recallDays` | `7` | `soym_recall` 读取最近多少个日文件。 |
| `maxRecallChars` | `6000` | 返回给模型的合并 recall 文本上限。 |

默认值来自 schemastery `Config` schema 并由测试断言。

## 存储格式

- 每个日期一个文件：`.dsh/experience/YYYY-MM-DD.md`（本地日期）。
- 每条经验是一个 `## [category] title` markdown 块，后跟空行和正文。
- 日志默认随 workspace 进 git（工具不关心是否 tracked；若想忽略，把 `.dsh/experience/` 加进 `.gitignore` 即可）。
- 文件名使用写入时刻的本地时区日期。

## 导出形态

函数/命名空间插件：导出 `name` / `inject` / `Config` / `apply`，无 default 导出。多余的 `export default` 会被 Loader 的 `unwrapExports` 折叠并丢掉 `inject`（见 [docs/postmortem/0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)）。

纯日志函数（`journalDirOf`、`appendLesson`、`readLessons`）单独导出，便于脱离工具运行时直接单测。

## 模型体验

### 工具 schema

#### What the model sees

模型看到生成的 [`soym_learn` 与 `soym_recall` schema](../../../docs/tool-catalog.md#deepseek-aidsh-soym-evolve)：`soym_learn` 必填 `category`（string）、`title`（string）、`body`（string）；`soym_recall` 接受可选 `category`（string）过滤。

#### Token effect

工具可见时每次请求有固定 schema 开销。

#### KV Cache effect

定义与可见性不变时前缀稳定；插件生命周期或作用域限制可能使这些 schema 的复用失效。

### 调用历史与结果

#### What the model sees

每次助手工具调用保留其参数。`soym_learn` 成功返回 `Lesson persisted to <file> (<n> entries, <chars> chars).`；必填字段为空时以稳定文案拒绝（``Error: soym_learn: `category` must be non-empty`` 及对应的 `title`/`body` 消息）。`soym_recall` 渲染受限的经验文本；日志为空时渲染日志的 `reason`（如 `journal does not exist yet — nothing to recall`）。

#### Token effect

`soym_learn` 结果大小受模型写入的日志块限制；`soym_recall` 文本受 `maxRecallChars`（默认 6000）上限约束。参数保留至压缩。

#### KV Cache effect

只追加；新可见内容跟在可复用请求前缀之后，不使既有 KV-cache 条目失效。

## Known Limitations and Deferred Work

- **纯 markdown 日志，非查询引擎** —— `soym_recall` 返回最近 `recallDays` 个日文件并按可选 category 过滤；没有全文检索、标签体系或跨文件去重。经验由人工编辑去重，工具不去重。
- **窗口按日期而非条数** —— 一天多条与一天一条在窗口中等权。
- **无自动会话结束捕获** —— 工具只持久化模型调用它时传入的内容；preset persona 应指导会话结束时调用 `soym_learn`，但本包不强制。
- **并发写为后写覆盖** —— 两个会话同时追加同一天文件会竞争读改写；SOYM wiki 单用户使用，故接受而非加锁。
