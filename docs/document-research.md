---
title: 最小文档检索机制
type: spec
status: active
tags: [documentation, research]
---

# 最小文档检索机制

## 触发

公共行为、架构、协议、新能力或 future 设计的方案、计划与编码，先做最小充分检索；不为凑索引扩大范围。

## 检索与阅读

1. 从任务提取技术名、模块名、动作和同义词，明确要查现行方案、未来设计还是历史背景。
2. 同时执行正文与路径检索，并阅读命中目录的 README：

   ```sh
   rg -n "关键词1|关键词2" docs/
   rg --files docs/ | rg -i "关键词"
   ```

3. `docs/spec/future/` 必须纳入候选。metadata 只辅助筛选，不能替代正文与路径检索。
4. 在方案或进展中列出实际读取路径及用途；未读文件不得写成已参考。无命中时说明关键词与范围后继续。

## 实施 future 设计

先把本次行为、失败/清理与验收写入现行 spec，再编码。future 文档记录候选设计，不能代替当前行为契约。

## Markdown metadata

`docs/` 下所有 Markdown 统一携带：

- `title`：与首个 H1 完全一致。
- `type`：`index/spec/pre-design/research/tutorial/plan/note/architecture/guide`。
- `status`：现行或记录文档用 `active`，明确延后的设计用 `future`。
- `tags`：简短主题词，优先使用目录与文件 stem。

## 自验

根 `.recall.yaml` 的 `docs-research/future-pre-design` 要求真实执行 grep、读取本机制、future 索引和命中的预设计，并在回答中引用实际路径。执行时必须显式选择已批准 target，不把配置装载或进程退出当作行为通过。
