# pi-coderef

给 [pi](https://pi.dev) 用的源码引用选择器：在终端里**浏览文件 → 定位代码 → 选中范围**，把精确的 `@file:line` 引用交给 agent —— 不用复制粘贴代码，上下文零歧义。

适合的场景：让 agent 重构某段代码、修某个函数的 bug、解释某几行 —— 你只需要"指"给它看。

## 安装

```bash
# 从 GitHub（推荐，可用 tag 锁定版本）
pi install git:github.com/examplecode/pi-coderef@v1

# 或从 npm
pi install npm:pi-coderef@1.0.0
```

卸载旧的手动安装（如有）：删除 `~/.pi/agent/extensions/coderef.ts`，避免重复加载。

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
npm test      # 41 个行为测试
```

扩展只依赖 pi 宿主提供的 `@earendil-works/pi-coding-agent` 和 `@earendil-works/pi-tui`，无其它运行时依赖。

## License

MIT
