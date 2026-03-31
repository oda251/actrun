---
provider: claude
model: sonnet
tools: [Read, Edit, Write, Bash, Glob, Grep]
inputs:
  what: 実装内容
  where:
    description: 対象ファイル
    type: plain
---

指定されたファイルに対して実装を行う。
