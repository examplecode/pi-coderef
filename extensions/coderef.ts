/**
 * pi-coderef — browse project files, locate code visually, and hand the agent a
 * precise `@file:line` reference instead of pasting code.
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);

const MAX_FILE_LINES = 5000;
const LARGE_SELECTION_LINES = 200;
const SKIPPED_DIRS = new Set(["node_modules", ".git"]);
const FILE_RESULTS_LIMIT = 15;
const PAGE_LINES = 20;
const CODE_VIEW_CHROME = 7; // header + status lines + hint + margin

// ---------------------------------------------------------------------------
// Code references
// ---------------------------------------------------------------------------

/** A reference to a range of code lines, sent to the agent as `@file:line`. */
export interface CodeRef {
  path: string;
  startLine: number;
  endLine: number;
  code: string;
}

/** Renders a code reference like `@src/app.ts:12` or `@src/app.ts:12-15`. */
export function formatCodeRef(filePath: string, startLine: number, endLine: number): string {
  return startLine === endLine ? `@${filePath}:${startLine}` : `@${filePath}:${startLine}-${endLine}`;
}

/** Appends a code reference to the prompt text, separated by a blank line. */
export function appendRefToPrompt(promptText: string, codeRef: string): string {
  const base = promptText.replace(/\s+$/, "");
  return base ? `${base}\n\n${codeRef}` : codeRef;
}

export type Language = "en" | "zh";

/** Picks the UI language from POSIX locale variables (Chinese when any is zh). */
export function detectLanguage(env: Record<string, string | undefined>): Language {
  const locale = [env.LC_ALL, env.LC_MESSAGES, env.LANG, env.LANGUAGE]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return locale.includes("zh") ? "zh" : "en";
}

const MESSAGES = {
  en: {
    fileSearchTitle: "/coderef - File search",
    indexing: "Indexing files...",
    cancelHint: "Esc cancel",
    searchPrompt: "Search",
    binaryError: (path: string) => `Cannot open ${path}: binary file`,
    noFileMatch: "(no matching files)",
    moreMatches: (n: number) => `... ${n} matches total`,
    fileHint: "up/down choose · Tab complete+open · Enter open · Esc cancel",
    truncatedNote: " (showing first 5000 lines)",
    selected: (s: number, e: number, n: number) => `Selected ${s}-${e} (${n} lines)`,
    located: (n: number) => `◉ Located: line ${n}`,
    searchHint: "· Enter next · Alt+Enter pin · Esc exit",
    noMatch: "(no match)",
    largeWarn: (n: number) =>
      `⚠ Selection over 200 lines (${n} total) - press Enter again to confirm`,
    codeHint:
      "j/k move · / search · n/N matches · PgUp/PgDn page · space mark · Enter confirm · Esc back",
    added: (ref: string) => `Added ${ref}`,
    needTui: "coderef requires interactive mode",
  },
  zh: {
    fileSearchTitle: "/coderef ── 文件搜索",
    indexing: "正在索引文件…",
    cancelHint: "Esc 取消",
    searchPrompt: "搜索",
    binaryError: (path: string) => `无法打开 ${path}：二进制文件`,
    noFileMatch: "(无匹配文件)",
    moreMatches: (n: number) => `… 共 ${n} 个匹配`,
    fileHint: "↑↓ 选择 · Tab 补全并打开 · Enter 打开 · Esc 取消",
    truncatedNote: "（超过 5000 行，仅显示前 5000 行）",
    selected: (s: number, e: number, n: number) => `已选 ${s}-${e} 行（${n} 行）`,
    located: (n: number) => `◉ 已定位：第 ${n} 行`,
    searchHint: "· Enter 下一个 · Alt+Enter 定位 · Esc 退出",
    noMatch: "(无匹配)",
    largeWarn: (n: number) =>
      `⚠ 选区超过 200 行（共 ${n} 行），再按一次 Enter 确认发送`,
    codeHint:
      "j/k 移动 · / 搜索 · n/N 跳匹配 · PgUp/PgDn 翻页 · space 标记 · Enter 确认 · Esc 返回",
    added: (ref: string) => `已添加 ${ref}`,
    needTui: "coderef 需要在交互模式下使用",
  },
} as const;

// ---------------------------------------------------------------------------
// File search
// ---------------------------------------------------------------------------

/** Greedy leftmost subsequence match; returns where the match ends, or -1. */
function subsequenceMatchEnd(needle: string, haystack: string): number {
  let matched = 0;
  let end = -1;
  for (let i = 0; i < haystack.length && matched < needle.length; i++) {
    if (haystack[i] === needle[matched]) {
      matched++;
      end = i;
    }
  }
  return matched === needle.length ? end : -1;
}

/** Filters and ranks candidate paths with a case-insensitive fuzzy query. */
export function matchFiles(query: string, candidates: string[]): string[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return candidates;
  const scored: Array<{ file: string; score: number }> = [];
  for (const file of candidates) {
    const lower = file.toLowerCase();
    let score = 0;
    let matchedAll = true;
    for (const token of tokens) {
      const end = subsequenceMatchEnd(token, lower);
      if (end < 0) {
        matchedAll = false;
        break;
      }
      score += end;
    }
    if (matchedAll) scored.push({ file, score });
  }
  scored.sort((a, b) => a.score - b.score || a.file.length - b.file.length || a.file.localeCompare(b.file));
  return scored.map((entry) => entry.file);
}

/** Wraps an async loader so its result is computed once and reused. */
export function createCachedLoader<T>(load: () => Promise<T> | T): () => Promise<T> {
  let cached: Promise<T> | undefined;
  return () => {
    if (!cached) cached = Promise.resolve(load());
    return cached;
  };
}

// ---------------------------------------------------------------------------
// Project file listing
// ---------------------------------------------------------------------------

/** Basic .gitignore patterns for the non-git fallback walk. */
function readGitignorePatterns(root: string): string[] {
  try {
    return fs
      .readFileSync(path.join(root, ".gitignore"), "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
  } catch {
    return [];
  }
}

function matchesIgnoredPattern(filePath: string, patterns: string[]): boolean {
  const name = filePath.split("/").pop() ?? filePath;
  for (const pattern of patterns) {
    if (pattern.endsWith("/")) {
      const dir = pattern.slice(0, -1);
      if (filePath === dir || filePath.startsWith(`${dir}/`)) return true;
    } else if (pattern.startsWith("*.")) {
      if (name.endsWith(pattern.slice(1))) return true;
    } else if (filePath === pattern || name === pattern || filePath.startsWith(`${pattern}/`)) {
      return true;
    }
  }
  return false;
}

/**
 * Lists project files relative to `root`, honoring .gitignore (via git when
 * available, otherwise a basic pattern fallback).
 */
export async function listProjectFiles(root: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: root, maxBuffer: 64 * 1024 * 1024 },
    );
    return stdout
      .split("\0")
      .filter(Boolean)
      .sort();
  } catch {
    // not a git repository — fall back to a manual walk
  }
  const ignored = readGitignorePatterns(root);
  const results: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      const relPath = path.relative(root, path.join(dir, entry.name)).split(path.sep).join("/");
      if (entry.isDirectory()) {
        if (SKIPPED_DIRS.has(entry.name) || matchesIgnoredPattern(relPath, ignored)) continue;
        await walk(path.join(dir, entry.name));
      } else if (entry.isFile() && !matchesIgnoredPattern(relPath, ignored)) {
        results.push(relPath);
      }
    }
  };
  await walk(root);
  return results.sort();
}

// ---------------------------------------------------------------------------
// Code lines
// ---------------------------------------------------------------------------

/** Splits file content into display lines, truncating very large files. */
export function splitFileLines(content: string): { lines: string[]; truncated: boolean } {
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const truncated = lines.length > MAX_FILE_LINES;
  return { lines: truncated ? lines.slice(0, MAX_FILE_LINES) : lines, truncated };
}

export function isBinaryContent(content: string): boolean {
  return content.includes("\0");
}

// ---------------------------------------------------------------------------
// Line selection
// ---------------------------------------------------------------------------

export interface SelectionRange {
  startLine: number;
  endLine: number;
}

/** Cursor movement and mark-based range selection over code lines. */
export interface LineSelection {
  readonly cursor: number;
  move(delta: number, lineCount: number): void;
  toggleMark(): void;
  range(): SelectionRange;
}

export function createLineSelection(): LineSelection {
  let cursor = 0;
  let mark: number | null = null;
  let frozenRange: SelectionRange | null = null;
  const normalize = (a: number, b: number): SelectionRange => ({
    startLine: Math.min(a, b),
    endLine: Math.max(a, b),
  });
  return {
    get cursor() {
      return cursor;
    },
    move(delta: number, lineCount: number) {
      cursor = Math.max(0, Math.min(lineCount - 1, cursor + delta));
    },
    toggleMark() {
      if (frozenRange) {
        frozenRange = null;
        return;
      }
      if (mark === null) {
        mark = cursor;
        return;
      }
      frozenRange = normalize(mark, cursor);
      mark = null;
    },
    range() {
      if (frozenRange) return { ...frozenRange };
      if (mark !== null) return normalize(mark, cursor);
      return { startLine: cursor, endLine: cursor };
    },
  };
}

export function isLargeSelection(range: SelectionRange): boolean {
  return range.endLine - range.startLine + 1 > LARGE_SELECTION_LINES;
}

// ---------------------------------------------------------------------------
// The interactive picker
// ---------------------------------------------------------------------------

export interface FileSource {
  list(): Promise<string[]> | string[];
  read(filePath: string): string;
}

export interface CodeRefPicker {
  render(width: number): string[];
  handleInput(data: string): void;
  invalidate(): void;
}

export interface ThemeLike {
  fg(color: string, text: string): string;
  bg(color: string, text: string): string;
  bold(text: string): string;
  inverse(text: string): string;
}

export function createCodeRefPicker(
  tui: { requestRender(): void; terminal?: { rows: number } },
  theme: ThemeLike,
  keybindings: { matches(data: string, action: string): boolean },
  done: (codeRef: CodeRef | undefined) => void,
  source: FileSource,
  language: Language = detectLanguage(process.env),
): CodeRefPicker {
  const msg = MESSAGES[language];
  const pendingFileList = Promise.resolve(source.list());
  let view: "files" | "code" = "files";
  let fileQuery = "";
  let allFiles: string[] = [];
  let matchedFiles: string[] = [];
  let filesReady = false;
  let selectedFileIndex = 0;
  let fileError: string | undefined;

  let currentPath = "";
  let codeLines: string[] = [];
  let fileTruncated = false;
  let awaitingConfirm = false;
  let codeSearchActive = false;
  let codeSearchText = "";
  let lastSearchText = "";
  let noMatches = false;
  let locatedLine: number | null = null;
  let selection = createLineSelection();

  let cachedWidth = -1;
  let cachedLines: string[] = [];

  const invalidate = () => {
    cachedWidth = -1;
    cachedLines = [];
  };

  const refilterFileList = () => {
    matchedFiles = matchFiles(fileQuery, allFiles);
    selectedFileIndex = Math.max(0, Math.min(selectedFileIndex, matchedFiles.length - 1));
  };

  const openFile = (filePath: string) => {
    const content = source.read(filePath);
    if (isBinaryContent(content)) {
      fileError = msg.binaryError(filePath);
      return;
    }
    const loaded = splitFileLines(content);
    currentPath = filePath;
    codeLines = loaded.lines;
    fileTruncated = loaded.truncated;
    selection = createLineSelection();
    locatedLine = null;
    awaitingConfirm = false;
    fileError = undefined;
    view = "code";
  };

  void pendingFileList.then((fileList) => {
    allFiles = fileList;
    matchedFiles = matchFiles(fileQuery, allFiles);
    selectedFileIndex = Math.max(0, Math.min(selectedFileIndex, matchedFiles.length - 1));
    filesReady = true;
    invalidate();
    tui.requestRender();
  });

  // -- code search helpers --

  const findMatchLines = (needle: string): number[] => {
    if (!needle) return [];
    const lowerNeedle = needle.toLowerCase();
    const matches: number[] = [];
    for (let i = 0; i < codeLines.length; i++) {
      if ((codeLines[i] ?? "").toLowerCase().includes(lowerNeedle)) matches.push(i);
    }
    return matches;
  };

  const jumpToNearestMatch = () => {
    const matches = findMatchLines(codeSearchText);
    noMatches = matches.length === 0;
    if (noMatches || matches.includes(selection.cursor)) return;
    const target = matches.find((line) => line > selection.cursor) ?? matches[0];
    selection.move(target - selection.cursor, codeLines.length);
  };

  const jumpToMatch = (needle: string, direction: 1 | -1): boolean => {
    const matches = findMatchLines(needle);
    if (matches.length === 0) {
      noMatches = true;
      return false;
    }
    const from = selection.cursor;
    let target: number;
    if (direction === 1) {
      target = matches.find((line) => line > from) ?? matches[0];
    } else {
      const earlier = matches.filter((line) => line < from);
      target = earlier.length > 0 ? earlier[earlier.length - 1] : matches[matches.length - 1];
    }
    noMatches = false;
    selection.move(target - from, codeLines.length);
    return true;
  };

  const highlightMatchedText = (text: string, needle: string): string => {
    if (!needle) return text;
    const lowerText = text.toLowerCase();
    const lowerNeedle = needle.toLowerCase();
    let result = "";
    let i = 0;
    for (;;) {
      const at = lowerText.indexOf(lowerNeedle, i);
      if (at < 0) {
        result += text.slice(i);
        return result;
      }
      result +=
        text.slice(i, at) + theme.inverse(theme.bold(text.slice(at, at + needle.length)));
      i = at + needle.length;
    }
  };

  // -- rendering --

  const renderFileSearch = (width: number): string[] => {
    const out: string[] = [theme.fg("accent", msg.fileSearchTitle)];
    if (!filesReady) {
      out.push(theme.fg("dim", msg.indexing));
      out.push(theme.fg("dim", msg.cancelHint));
      return out.map((line) => truncateToWidth(line, width));
    }
    out.push(`${msg.searchPrompt} ▸ ${fileQuery}`);
    if (fileError) out.push(theme.fg("dim", `⚠ ${fileError}`));
    const visible = matchedFiles.slice(0, FILE_RESULTS_LIMIT);
    for (let i = 0; i < visible.length; i++) {
      const row = `${i === selectedFileIndex ? "▸ " : "  "}${visible[i]}`;
      out.push(i === selectedFileIndex ? theme.bold(theme.bg("selectedBg", row)) : row);
    }
    if (matchedFiles.length > visible.length) {
      out.push(theme.fg("dim", `  ${msg.moreMatches(matchedFiles.length)}`));
    }
    if (matchedFiles.length === 0) out.push(theme.fg("dim", `  ${msg.noFileMatch}`));
    out.push(theme.fg("dim", msg.fileHint));
    return out.map((line) => truncateToWidth(line, width));
  };

  const renderCodeView = (width: number): string[] => {
    const range = selection.range();
    const activeSearch = codeSearchActive ? codeSearchText : lastSearchText;
    const matchLines = new Set(findMatchLines(activeSearch));
    const out: string[] = [
      theme.fg("accent", currentPath) + (fileTruncated ? theme.fg("dim", msg.truncatedNote) : ""),
    ];
    const visibleRows = Math.max(5, (tui.terminal?.rows ?? 30) - CODE_VIEW_CHROME);
    const firstVisible = Math.max(
      0,
      Math.min(selection.cursor - 10, Math.max(0, codeLines.length - visibleRows)),
    );
    const lastVisible = Math.min(codeLines.length, firstVisible + visibleRows);
    for (let i = firstVisible; i < lastVisible; i++) {
      const marker =
        i === selection.cursor
          ? "▸"
          : i === locatedLine
            ? "◉"
            : matchLines.has(i)
              ? "⌕"
              : i >= range.startLine && i <= range.endLine
                ? "▌"
                : " ";
      out.push(`${marker} ${String(i + 1).padStart(4)} ${highlightMatchedText(codeLines[i] ?? "", activeSearch)}`);
    }
    out.push(
      theme.fg(
        "dim",
        msg.selected(range.startLine + 1, range.endLine + 1, range.endLine - range.startLine + 1),
      ),
    );
    if (locatedLine !== null) {
      out.push(theme.fg("accent", msg.located(locatedLine + 1)));
    }
    if (codeSearchActive) {
      out.push(
        theme.fg("accent", `${msg.searchPrompt} ▸ ${codeSearchText}`) +
          (noMatches ? theme.fg("dim", `  ${msg.noMatch}`) : "") +
          theme.fg("dim", `  ${msg.searchHint}`),
      );
    } else if (lastSearchText) {
      out.push(theme.fg("dim", `⌕ ${lastSearchText}${noMatches ? `  ${msg.noMatch}` : ""}`));
    }
    if (awaitingConfirm) {
      out.push(theme.fg("dim", msg.largeWarn(range.endLine - range.startLine + 1)));
    }
    out.push(theme.fg("dim", msg.codeHint));
    return out.map((line) => truncateToWidth(line, width));
  };

  // -- input handling --

  const handleFileSearchInput = (data: string): boolean => {
    if (!filesReady) {
      if (keybindings.matches(data, "tui.select.cancel")) done(undefined);
      return true;
    }
    if (keybindings.matches(data, "tui.select.up")) {
      selectedFileIndex = Math.max(0, selectedFileIndex - 1);
    } else if (keybindings.matches(data, "tui.select.down")) {
      selectedFileIndex = Math.min(matchedFiles.length - 1, selectedFileIndex + 1);
    } else if (keybindings.matches(data, "tui.select.confirm")) {
      const picked = matchedFiles[selectedFileIndex];
      if (picked) openFile(picked);
    } else if (keybindings.matches(data, "tui.select.cancel")) {
      done(undefined);
    } else if (data === "\x7f" || data === "\b") {
      fileQuery = fileQuery.slice(0, -1);
      refilterFileList();
    } else if (keybindings.matches(data, "tui.input.tab") || data === "\t") {
      const picked = matchedFiles[selectedFileIndex];
      if (picked) {
        fileQuery = picked;
        refilterFileList();
        openFile(picked);
      }
    } else if (data.length > 0 && !data.startsWith("\x1b") && !data.startsWith("\x03")) {
      fileQuery += data;
      fileError = undefined;
      refilterFileList();
    } else {
      return false;
    }
    return true;
  };

  const handleCodeSearchInput = (data: string): boolean => {
    if (matchesKey(data, "alt+enter")) {
      locatedLine = selection.cursor;
      codeSearchActive = false;
      if (codeSearchText) lastSearchText = codeSearchText;
    } else if (keybindings.matches(data, "tui.select.cancel")) {
      codeSearchActive = false;
      if (codeSearchText) lastSearchText = codeSearchText;
    } else if (keybindings.matches(data, "tui.select.confirm")) {
      jumpToMatch(codeSearchText, 1);
    } else if (data === "\x7f" || data === "\b") {
      codeSearchText = codeSearchText.slice(0, -1);
      jumpToNearestMatch();
    } else if (data.length > 0 && !data.startsWith("\x1b") && !data.startsWith("\x03")) {
      codeSearchText += data;
      jumpToNearestMatch();
    } else {
      return false;
    }
    return true;
  };

  const handleCodeViewInput = (data: string): boolean => {
    if (codeSearchActive) return handleCodeSearchInput(data);
    if (data === "/") {
      codeSearchActive = true;
      codeSearchText = "";
      noMatches = false;
    } else if (data === "n") {
      if (lastSearchText) jumpToMatch(lastSearchText, 1);
    } else if (data === "N") {
      if (lastSearchText) jumpToMatch(lastSearchText, -1);
    } else if (keybindings.matches(data, "tui.select.up") || data === "k") {
      selection.move(-1, codeLines.length);
      awaitingConfirm = false;
    } else if (keybindings.matches(data, "tui.select.down") || data === "j") {
      selection.move(1, codeLines.length);
      awaitingConfirm = false;
    } else if (keybindings.matches(data, "tui.select.pageUp")) {
      selection.move(-PAGE_LINES, codeLines.length);
      awaitingConfirm = false;
    } else if (keybindings.matches(data, "tui.select.pageDown")) {
      selection.move(PAGE_LINES, codeLines.length);
      awaitingConfirm = false;
    } else if (data === " ") {
      selection.toggleMark();
      awaitingConfirm = false;
    } else if (keybindings.matches(data, "tui.select.cancel")) {
      view = "files";
    } else if (keybindings.matches(data, "tui.select.confirm")) {
      const range = selection.range();
      if (isLargeSelection(range) && !awaitingConfirm) {
        awaitingConfirm = true;
      } else {
        done({
          path: currentPath,
          startLine: range.startLine + 1,
          endLine: range.endLine + 1,
          code: codeLines.slice(range.startLine, range.endLine + 1).join("\n"),
        });
      }
    } else {
      return false;
    }
    return true;
  };

  return {
    render(width: number): string[] {
      if (cachedLines.length > 0 && cachedWidth === width) return cachedLines;
      cachedWidth = width;
      cachedLines = view === "files" ? renderFileSearch(width) : renderCodeView(width);
      return cachedLines;
    },

    handleInput(data: string): void {
      const handled = view === "files" ? handleFileSearchInput(data) : handleCodeViewInput(data);
      if (!handled) return;
      invalidate();
      tui.requestRender();
    },

    invalidate,
  };
}

// ---------------------------------------------------------------------------
// Extension wiring
// ---------------------------------------------------------------------------

interface PickerCommandContext {
  mode: string;
  cwd?: string;
  ui: {
    custom<T>(
      factory: (
        tui: { requestRender(): void; terminal?: { rows: number } },
        theme: ThemeLike,
        keybindings: { matches(data: string, action: string): boolean },
        done: (codeRef: T | undefined) => void,
      ) => CodeRefPicker,
    ): Promise<T | undefined>;
    getEditorText(): string;
    setEditorText(text: string): void;
    notify(message: string, kind: "info" | "warning" | "error"): void;
  };
}

const projectFileLoaderCache = new Map<string, () => Promise<string[]>>();

function projectFileLoader(root: string): () => Promise<string[]> {
  let loader = projectFileLoaderCache.get(root);
  if (!loader) {
    loader = createCachedLoader(() => listProjectFiles(root));
    projectFileLoaderCache.set(root, loader);
  }
  return loader;
}

export default function codeRefExtension(pi: ExtensionAPI): void {
  const runCodeRef = async (_args: string, ctx: PickerCommandContext): Promise<void> => {
    const msg = MESSAGES[detectLanguage(process.env)];
    if (ctx.mode !== "tui") {
      ctx.ui.notify(msg.needTui, "error");
      return;
    }
    const root = ctx.cwd ?? process.cwd();
    const codeRef = await ctx.ui.custom<CodeRef>((tui, theme, keybindings, done) =>
      createCodeRefPicker(tui, theme, keybindings, done, {
        list: projectFileLoader(root),
        read: (filePath) => fs.readFileSync(path.join(root, filePath), "utf8"),
      }),
    );
    if (!codeRef) return;
    const reference = formatCodeRef(codeRef.path, codeRef.startLine, codeRef.endLine);
    ctx.ui.setEditorText(appendRefToPrompt(ctx.ui.getEditorText(), reference));
    ctx.ui.notify(msg.added(reference), "info");
  };

  const handler = (args: string, ctx: unknown) => runCodeRef(args, ctx as PickerCommandContext);

  pi.registerCommand("coderef", {
    description: "浏览文件并选择源码位置，生成 @file:line 引用插入输入框",
    handler,
  });
  pi.registerCommand("pick", {
    description: "coderef 的别名",
    handler,
  });
  pi.registerShortcut("alt+p", {
    description: "打开 /coderef 源码引用选择器",
    handler: (ctx: unknown) => runCodeRef("", ctx as PickerCommandContext),
  });
}
