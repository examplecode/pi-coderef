# pi-coderef

Hand your [pi](https://pi.dev) agent a precise code reference instead of pasting code. Browse project files in the terminal, locate the exact lines visually, and insert an `@file:line` reference into your prompt — zero ambiguity about which code you mean.

Built for the moments when you ask the agent to refactor a function, fix a bug in a specific block, or explain a few lines — just *point* at it.

The code view is read-only and syntax-highlighted with pi's own theme colors, so what you pick looks like what pi shows you.

## Install

```bash
# From npm (recommended)
pi install npm:pi-coderef@1.0.2

# Or from GitHub (pin a version with a tag)
pi install git:github.com/examplecode/pi-coderef@v1
```

If you previously installed the extension manually, delete `~/.pi/agent/extensions/coderef.ts` to avoid loading it twice.

## Usage

Run **`/coderef`** in pi (or press **`Alt+P`**; `/pick` is an alias):

| Key | Action |
|-----|--------|
| type | Fuzzy file search (case-insensitive; `fmt` matches `format.ts`) |
| `↑↓` | Choose a file (highlighted selection) |
| `Tab` | Complete to the full path and open it right away |
| `Enter` | Open the highlighted file |
| `j/k` `PgUp/PgDn` | Move the cursor in the code view |
| `/` | Search inside the file: live jump, highlighted matches, `n`/`N` for next/previous |
| `Alt+Enter` | While searching: accept the position and pin it with `◉` |
| `space` | Mark the selection start / press again to fix the end (no mark = current line) |
| `Enter` | Confirm → the reference is inserted into the prompt |
| `Esc` | Go back / cancel, one level at a time |

After confirming, the prompt gets appended with:

```
@src/utils/format.ts:121-122
```

Write your task after it (e.g. "refactor this"), press Enter, done. Run `/coderef` again to append more references.

## Safety

- Binary files are refused
- Huge files load at most the first 5000 lines
- Selections over 200 lines require a second confirmation

## Development

```bash
npm install   # host packages, for tests only
npm test      # 48 behavior tests
```

The extension only depends on pi's host-provided `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`. No other runtime dependencies.

## License

MIT

---

# 中文说明

给 [pi](https://pi.dev) 用的源码引用选择器：在终端里**浏览文件 → 定位代码 → 选中范围**，把精确的 `@file:line` 引用交给 agent —— 不用复制粘贴代码，上下文零歧义。

适合的场景：让 agent 重构某段代码、修某个函数的 bug、解释某几行 —— 你只需要"指"给它看。

代码视图只读，并使用 pi 自带主题配色做**语法高亮**，看到的颜色与 pi 内一致。

## 安装

```bash
# 从 npm（推荐）
pi install npm:pi-coderef@1.0.2

# 或从 GitHub（可用 tag 锁定版本）
pi install git:github.com/examplecode/pi-coderef@v1
```

如果你之前手动安装过扩展，删除 `~/.pi/agent/extensions/coderef.ts` 以避免重复加载。

## 用法

在 pi 里输入 **`/coderef`**（或按 **`Alt+P`**；`/pick` 是别名）：

| 按键 | 作用 |
|------|------|
| 输入 | 模糊搜索文件（忽略大小写；`fmt` 能匹配 `format.ts`） |
| `↑↓` | 选择文件（选中项高亮） |
| `Tab` | 补全为完整路径并直接打开 |
| `Enter` | 打开高亮的文件 |
| `j/k` `PgUp/PgDn` | 代码视图内移动光标 |
| `/` | 文件内搜索：边输入边跳转，匹配文本高亮，`n/N` 跳上一个/下一个 |
| `Alt+Enter` | 搜索中：接受当前位置并标记 `◉ 已定位` |
| `space` | 标记选区起点 / 第二次按下固定终点（不标记则选中光标行） |
| `Enter` | 确认 → 引用插入输入框 |
| `Esc` | 逐级返回 / 取消 |

确认后，输入框会追加：

```
@src/utils/format.ts:121-122
```

后面写上你的任务（如"重构这段"），回车发送。多段引用可多次 `/coderef` 追加。

## 安全护栏

- 二进制文件拒绝打开
- 超大文件只加载前 5000 行
- 超过 200 行的选区需二次确认

## 开发

```bash
npm install   # 拉取宿主包（仅测试需要）
npm test      # 48 个行为测试
```

扩展只依赖 pi 宿主提供的 `@earendil-works/pi-coding-agent` 和 `@earendil-works/pi-tui`，无其它运行时依赖。

## License

MIT
