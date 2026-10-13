# dsh-prompts

DeepSeek Harness（DSH）的**提示词库**插件：在 `/` 输入面板里浏览、临时编辑并插入提示词，把任意一条已发送的消息存成提示词，并在「拓展」页提供一个管理标签。

提示词是**纯输入辅助**：它不进系统提示、不产生会话事件、不出现在任何模型请求里。只有当你亲手把它插入输入框并发送，它才作为普通用户消息到达模型 —— 因此对 token 消耗为零。

本仓库是 pnpm workspace，插件实体在 [`packages/prompts`](./packages/prompts/README.md)（含 wire API、错误码、各 UI 表面的详细说明）。

## 安装

```sh
pnpm install
pnpm run build      # tsc -b packages/prompts
pnpm test           # vitest run
```

然后把该 bundle 挂到你的 profile：在 `~/.dsh/profiles/<profile>/package.json` 里加

```json
"@deepseek-ai/dsh-prompts": "link:<本仓库绝对路径>/packages/prompts"
```

并在 profile 的 `cordis.patch.yml` 的 `bundles` 列表里加入 `@deepseek-ai/dsh-prompts`，完全重启 DSH（宿主半需要进程重启，浏览器半会热加载）。

## 数据

`<dshHome>/prompts.json`，原子化 staged 写入，单用户顺序写（不加文件锁）。不使用浏览器 localStorage。

## 许可

MIT。见 [LICENSE](./LICENSE)。

## 许可与来源

本仓库以 MIT 许可发布（见 [LICENSE](./LICENSE)）。其中 `packages/skill-filesystem-roster`、`packages/tool-cordis-roster` 等包是 DeepSeek Harness 官方包（`@deepseek-ai/*`，MIT，Copyright (c) DeepSeek）的 fork，改动理由与差异见各自 README；这些包保留上游的版权与许可声明。
