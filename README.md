# pi-coderef

Hand your [pi](https://pi.dev) agent a precise code reference instead of pasting code. Browse project files in the terminal, locate the exact lines visually, and insert an `@file:line` reference into your prompt — zero ambiguity about which code you mean.

Built for the moments when you ask the agent to refactor a function, fix a bug in a specific block, or explain a few lines — just *point* at it.

The code view is read-only and syntax-highlighted with pi's own theme colors, so what you pick looks like what pi shows you. Navigation is Vim-flavored: `j`/`k`, `Ctrl+D`/`Ctrl+U`, `Ctrl+F`/`Ctrl+B`, `g`/`G`, `/` then `n`/`N`.

## Install

```bash
# From npm (recommended) — pin a version for reproducibility
pi install npm:pi-coderef@1.0.7

# Always take the newest release
pi install npm:pi-coderef

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
| `j` / `k` | Move the cursor one line down / up |
| `Ctrl+D` / `Ctrl+U` | Move half a page down / up |
| `Ctrl+F` / `Ctrl+B` | Move a full page down / up |
| `g` / `G` | Jump to the top / the last line |
| `/` | Search inside the file: live jump, highlighted matches |
| `Enter` (while searching) | Accept the match, leave search, and pin it with `◉` |
| `n` / `N` | Jump to the next / previous search match |
| `space` | Mark the selection start / press again to fix the end (no mark = current line) |
| **mouse drag** | Drag over code lines to select a range (click sets the line, drag extends it) |
| mouse wheel | Scroll the code view / move the file-list selection |
| `Enter` | Confirm → the reference is inserted into the prompt |
| `Esc` | Go back / cancel, one level at a time |

Selection works with the keyboard (`space`) or the mouse (drag over lines); selected lines are highlighted (background color when the theme defines one, inverse video otherwise). Mouse support needs a terminal that reports mouse events to pi (pi's fullscreen mode does).

Navigation follows Vim (`j`/`k`, `Ctrl+D`/`Ctrl+U`, `Ctrl+F`/`Ctrl+B`, `g`/`G`).

> `PageUp`/`PageDown` (including `Fn+↑`/`Fn+↓` on a Mac) are consumed by pi's fullscreen transcript scrolling and never reach the picker — use `Ctrl+F`/`Ctrl+B` instead.

Every key is handled through pi's key parser, so layouts that use the Kitty keyboard protocol (cmux, Ghostty, kitty, WezTerm) and classic terminals both work.

After confirming, the prompt gets appended with:

```
@src/utils/format.ts:121-122
```

Write your task after it (e.g. "refactor this"), press Enter, done. Run `/coderef` again to append more references.

## Safety

- Binary files are refused
- Very large files open instantly: only the visible window is syntax-highlighted, in the background
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

代码视图只读，并使用 pi 自带主题配色做**语法高亮**，看到的颜色与 pi 内一致。选区既可以用键盘（`space`）标记，也可以**直接用鼠标拖拽**（选中行会高亮显示；主题有背景色时用背景色，否则用反色）（需要终端把鼠标事件交给 pi，pi 的 fullscreen 模式默认如此）。

导航遵循 Vim 习惯：`j`/`k`、`Ctrl+D`/`Ctrl+U`、`Ctrl+F`/`Ctrl+B`、`g`/`G`，以及 `/` 搜索后 `n`/`N` 跳转。

## 安装

```bash
# 从 npm（推荐）—— 钉版本便于复现
pi install npm:pi-coderef@1.0.7

# 始终跟随最新版
pi install npm:pi-coderef

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
| `j` / `k` | 光标下移 / 上移一行 |
| `Ctrl+D` / `Ctrl+U` | 下移 / 上移半页 |
| `Ctrl+F` / `Ctrl+B` | 下移 / 上移整页 |
| `g` / `G` | 跳到文件顶部 / 最后一行 |
| `/` | 文件内搜索：边输入边跳转，匹配文本高亮 |
| `Enter`（搜索中） | 接受当前匹配、退出搜索，并标记 `◉ 已定位` |
| `n` / `N` | 跳到下一个 / 上一个匹配 |
| `space` | 标记选区起点 / 第二次按下固定终点（不标记则选中光标行） |
| **鼠标拖拽** | 在代码行上拖动即可选定范围（单击定位、拖动扩展） |
| 鼠标滚轮 | 滚动代码视图 / 移动文件列表选中项 |
| `Enter` | 确认 → 引用插入输入框 |
| `Esc` | 逐级返回 / 取消 |

导航遵循 Vim 习惯（`j`/`k`、`Ctrl+D`/`Ctrl+U`、`Ctrl+F`/`Ctrl+B`、`g`/`G`）。

> `PageUp`/`PageDown` 会被 pi 全屏模式的转录滚动吃掉，到不了选择器；请改用 `Ctrl+F`/`Ctrl+B`（`Fn+↑`/`Fn+↓` 发的就是被 pi 拦截的那两个键）。

所有按键都通过 pi 的键盘解析器处理，因此使用 Kitty 键盘协议的终端（cmux、Ghostty、kitty、WezTerm）与传统终端都能正常工作。

确认后，输入框会追加：

```
@src/utils/format.ts:121-122
```

后面写上你的任务（如"重构这段"），回车发送。多段引用可多次 `/coderef` 追加。

## 安全护栏

- 二进制文件拒绝打开
- 超大文件**瞬间打开**：只对当前可见窗口做语法高亮，且在后台完成（不卡界面）
- 超过 200 行的选区需二次确认

## 开发

```bash
npm install   # 拉取宿主包（仅测试需要）
npm test      # 48 个行为测试
```

扩展只依赖 pi 宿主提供的 `@earendil-works/pi-coding-agent` 和 `@earendil-works/pi-tui`，无其它运行时依赖。

## License

MIT
