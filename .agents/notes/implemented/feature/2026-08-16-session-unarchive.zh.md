# Agent Note: GUI 会话取消归档

Status: implemented

[English](2026-08-16-session-unarchive.md) | 中文

## Problem

归档会话功能（行菜单 → `workspace.archiveSession` → 注册表级持久集合）把会话从所有分组视图隐藏后没有回头路：客户端既看不到已归档行，也没有取消归档入口，误归档或实验性归档的会话在 GUI 里就再也够不着——尽管日志和 workspace 席位完好。持久集合只能在 host 停止时手工编辑 `$DSH_HOME/storages/workspace.json`。

## Decision

fork 交付完整的取消归档回路：

- **Host**：`workspaceRegistry.unarchiveSession(sessionId)` 从持久化 `archivedSessionIds` 集合移除该 id（对非成员幂等——集合是唯一被考察的事实，无需会话存在性检查）。新增 `workspace.unarchiveSession` RPC 镜像 `archiveSession`（请求 `{ sessionId }`，响应完整更新后集合），无业务错误路径；既有的 `host/archived-sessions-changed` 帧经 `domain/changed` 监听自动触发，已订阅的客户端无需新帧类型即可重新基线化。
- **客户端 runtime**：`WorkspaceRuntime.unarchiveSession` 镜像 `archiveSession`，走同一 manager 回声安装路径（`installArchived`），本地一元回声、其他标签页的帧与重连基线三者收敛。
- **UI**：已归档行在底部**已归档区**可见（`deriveArchived`：注册表已归档会话，排除 subagent origin 与空白占位行，最新在前），集合非空时渲染在分组树与平铺列表之下。该区**默认折叠**；页头开关（浏览器持久 viewing store 里的 `archivedExpanded` 标志，分组与平铺两种界面共享）展开它。展开后的行保留悬停能力；行菜单只提供 **取消归档** 动词（重命名/fork/归档面向可见会话），并以专属行类调暗显示。搜索继续排除已归档成员。

## Alternatives considered

### 手工编辑持久状态文件恢复会话

适合一次性救援（host 停止后从 `workspace.json` 移除 id），但不是产品：需要停 GUI、无逐会话粒度、以后每次归档都要同样的手工手术。GUI 入口是持久修复，且 fork 用户明确要求它。

### 不带已归档视图的独立取消归档对话框

取消归档动词需要目标；已归档行按设计从所有现有视图隐藏。用对话框列出隐藏会话等于为一个动作重造树机制。已归档区复用既有行组件及其悬停/菜单能力，同时承担查看与取消归档。

### 把已归档行以调暗形式内联显示在原分组里

保留 workspace 分组完整性，但会让每个派生（`deriveGroups`、`deriveFlat`、搜索、计数、拖拽）多一条可见性轴，并把隐藏内容混进活树。独立底部区让隐藏状态在视觉与结构上分离，取消归档时记账席位仍把行送回原位。

## Consequences

- 集合为空时区不渲染且默认折叠，既有 GUI 快照与无归档会话的组合不受影响。
- 打开已归档行仍然可用（会话日志未被触碰）；只有分组视图隐藏它。
- 对非成员取消归档是无操作，与集合竞争的过期客户端不会调用失败。
- `WorkspaceBrowser.tsx` 处于 GUI 覆盖率豁免列表，区渲染接线由组件与浏览器 e2e 测试覆盖而非逐文件覆盖率；派生（`tree.ts`）与行菜单（`Rows.tsx`）全覆盖。
