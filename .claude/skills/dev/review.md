---
provider: claude
model: sonnet
tools: [Read, Glob, Grep]
inputs:
  changes:
    description: レビュー対象の変更内容
    type: plain
---

変更内容をレビューし、問題があれば指摘する。
