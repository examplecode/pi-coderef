import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";
import {
  formatCodeRef,
  appendRefToPrompt,
  matchFiles,
  createLineSelection,
  isLargeSelection,
  splitFileLines,
  isBinaryContent,
  listProjectFiles,
  createCachedLoader,
  createCodeRefPicker,
  detectLanguage,
  type CodeRef,
} from "../extensions/coderef.ts";
import codeRefExtension from "../extensions/coderef.ts";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// Existing assertions target the Chinese UI; pin the locale for the whole file.
process.env.LANG = "zh_CN.UTF-8";

async function waitReady(component: { render(width: number): string[] }) {
  for (let i = 0; i < 200; i++) {
    if (!component.render(80).some((line) => line.includes("索引"))) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("file listing never became ready");
}

// ---- code references ----

test("formatCodeRef formats a multi-line selection as an @-reference with line range", () => {
  assert.equal(formatCodeRef("src/utils/format.ts", 121, 122), "@src/utils/format.ts:121-122");
});

test("formatCodeRef uses single-line @-reference when selection is one line", () => {
  assert.equal(formatCodeRef("src/main.py", 42, 42), "@src/main.py:42");
});

test("appendRefToPrompt returns the reference alone when the prompt is empty", () => {
  assert.equal(appendRefToPrompt("", "hello"), "hello");
});

test("appendRefToPrompt joins existing prompt and reference with a blank line", () => {
  assert.equal(appendRefToPrompt("重构这个函数", "ref"), "重构这个函数\n\nref");
});

test("appendRefToPrompt trims trailing whitespace before joining", () => {
  assert.equal(appendRefToPrompt("已有内容 \n\n", "x"), "已有内容\n\nx");
});

// ---- file search ----

test("matchFiles excludes paths where any query token does not match", () => {
  const files = ["src/utils/format.ts", "src/time/clock.ts"];
  assert.deepEqual(matchFiles("utils fmt", files), ["src/utils/format.ts"]);
  assert.deepEqual(matchFiles("nomatch", files), []);
});

test("matchFiles matches case-insensitively and ranks earlier path matches first", () => {
  const files = ["src/utils/format.ts", "format.js"];
  assert.deepEqual(matchFiles("FORMAT", files), ["format.js", "src/utils/format.ts"]);
});

test("matchFiles with empty query returns candidates unchanged", () => {
  const files = ["b.ts", "a.ts"];
  assert.deepEqual(matchFiles("", files), ["b.ts", "a.ts"]);
});

test("createCachedLoader runs the underlying loader only once", async () => {
  let calls = 0;
  const load = createCachedLoader(async () => {
    calls++;
    return ["a.ts"];
  });
  assert.deepEqual(await load(), ["a.ts"]);
  assert.deepEqual(await load(), ["a.ts"]);
  assert.equal(calls, 1);
});

// ---- line selection ----

test("selection starts idle and selects only the cursor line", () => {
  const selection = createLineSelection();
  selection.move(5, 100);
  assert.equal(selection.cursor, 5);
  assert.deepEqual(selection.range(), { startLine: 5, endLine: 5 });
});

test("selection extends live while marking and normalizes backwards range", () => {
  const selection = createLineSelection();
  selection.move(5, 100);
  selection.toggleMark();
  selection.move(3, 100);
  assert.deepEqual(selection.range(), { startLine: 5, endLine: 8 });
  const backwards = createLineSelection();
  backwards.move(5, 100);
  backwards.toggleMark();
  backwards.move(-2, 100);
  assert.deepEqual(backwards.range(), { startLine: 3, endLine: 5 });
});

test("second toggleMark freezes the range at press time", () => {
  const selection = createLineSelection();
  selection.move(5, 100);
  selection.toggleMark();
  selection.move(3, 100);
  selection.toggleMark();
  selection.move(10, 100);
  assert.deepEqual(selection.range(), { startLine: 5, endLine: 8 });
});

test("third toggleMark clears selection back to cursor line", () => {
  const selection = createLineSelection();
  selection.move(5, 100);
  selection.toggleMark();
  selection.move(3, 100);
  selection.toggleMark();
  selection.toggleMark();
  assert.deepEqual(selection.range(), { startLine: 8, endLine: 8 });
});

test("isLargeSelection flags ranges over 200 lines", () => {
  assert.equal(isLargeSelection({ startLine: 1, endLine: 200 }), false);
  assert.equal(isLargeSelection({ startLine: 1, endLine: 201 }), true);
});

test("the hint line stays visible with search, pin and selection active", async () => {
  const content = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n");
  const source = { list: async () => ["a.ts"], read: () => content };
  const tui30 = { requestRender() {}, terminal: { rows: 30, columns: 112 } };
  const picker = createCodeRefPicker(tui30, fakeTheme(), fakeKeybindings(), () => {}, source);
  await waitReady(picker);

  runKeys(picker, [KEYMAP["tui.select.confirm"]]);
  runKeys(picker, ["/", "l", "i", "n", "e", KEYMAP["tui.select.confirm"]]); // search then Enter to locate
  runKeys(picker, [" "]); // start a selection

  const rendered = picker.render(112);
  assert.ok(rendered.length <= 27, `rendered ${rendered.length} lines, expected <= 27`);
  assert.ok(rendered.some((line) => line.includes("Ctrl+D/U")), "first hint line must be rendered");
  assert.ok(
    rendered[rendered.length - 1].includes("Enter 确认"),
    "last hint line must be the final rendered line",
  );
});

// ---- code lines ----

test("splitFileLines splits lines and drops the trailing empty line", () => {
  assert.deepEqual(splitFileLines("a\nb\n"), { lines: ["a", "b"], truncated: false });
  assert.deepEqual(splitFileLines("a\nb"), { lines: ["a", "b"], truncated: false });
  assert.deepEqual(splitFileLines(""), { lines: [], truncated: false });
});

test("splitFileLines keeps every line, no matter how large the file is", () => {
  const content = Array.from({ length: 12000 }, (_, i) => `line${i}`).join("\n");
  const result = splitFileLines(content);
  assert.equal(result.lines.length, 12000);
  assert.equal(result.lines[11999], "line11999");
});

test("isBinaryContent detects NUL bytes", () => {
  assert.equal(isBinaryContent("plain text\ncode"), false);
  assert.equal(isBinaryContent("PNG\0data"), true);
});

// ---- project file listing ----

test("listProjectFiles walks a plain directory, skipping node_modules and .git", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coderef-walk-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "a.ts"), "");
  fs.writeFileSync(path.join(root, "b.ts"), "");
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.writeFileSync(path.join(root, "node_modules", "x.js"), "");
  fs.mkdirSync(path.join(root, ".git"));
  fs.writeFileSync(path.join(root, ".git", "HEAD"), "");
  assert.deepEqual(await listProjectFiles(root), ["b.ts", "src/a.ts"]);
});

test("listProjectFiles respects .gitignore in git repositories", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coderef-git-"));
  execSync("git init -q", { cwd: root });
  fs.writeFileSync(path.join(root, ".gitignore"), "secret.txt\n");
  fs.writeFileSync(path.join(root, "secret.txt"), "");
  fs.writeFileSync(path.join(root, "kept.txt"), "");
  assert.deepEqual(await listProjectFiles(root), [".gitignore", "kept.txt"]);
});

test("listProjectFiles fallback walk honors basic .gitignore patterns", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coderef-ign-"));
  fs.writeFileSync(path.join(root, ".gitignore"), "dist/\n*.log\n");
  fs.writeFileSync(path.join(root, "app.ts"), "");
  fs.writeFileSync(path.join(root, "debug.log"), "");
  fs.mkdirSync(path.join(root, "dist"));
  fs.writeFileSync(path.join(root, "dist", "bundle.js"), "");
  assert.deepEqual(await listProjectFiles(root), [".gitignore", "app.ts"]);
});

test("listProjectFiles does not block the event loop on large directories", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coderef-big-"));
  for (let d = 0; d < 20; d++) {
    fs.mkdirSync(path.join(root, `dir${d}`));
    for (let f = 0; f < 100; f++) fs.writeFileSync(path.join(root, `dir${d}`, `f${f}.ts`), "");
  }
  let ticks = 0;
  const timer = setInterval(() => ticks++, 5);
  const files = await listProjectFiles(root);
  clearInterval(timer);
  assert.equal(files.length, 2000);
  assert.ok(ticks > 0, `event loop should keep ticking during listing (ticks=${ticks})`);
});

// ---- interactive picker ----

const KEYMAP = {
  "tui.select.up": "\x1b[A",
  "tui.select.down": "\x1b[B",
  "tui.select.confirm": "\r",
  "tui.select.cancel": "\x1b",
  "tui.select.pageUp": "\x1b[5~",
  "tui.select.pageDown": "\x1b[6~",
  "tui.input.tab": "\t",
};

function fakeTui() {
  return { requestRender() {} };
}

function fakeTheme() {
  return {
    fg: (color: string, text: string) => (color.startsWith("syntax") ? `[${color}:${text}]` : text),
    bg: (color: string, text: string) => `<${color}>${text}</${color}>`,
    bold: (text: string) => `<b>${text}</b>`,
    inverse: (text: string) => `<inv>${text}</inv>`,
  };
}

function fakeKeybindings() {
  return { matches: (data: string, action: string) => data === KEYMAP[action as keyof typeof KEYMAP] };
}

function runKeys(component: { handleInput(data: string): void }, keys: string[]) {
  for (const key of keys) component.handleInput(key);
}

test("picking flows: search file, mark a range, confirm returns the code reference", async () => {
  const source = {
    list: async () => ["src/a.ts", "src/b.ts"],
    read: (file: string) => (file === "src/b.ts" ? "x\ny\nz\n" : "one\ntwo\nthree\n"),
  };
  let result: CodeRef | undefined;
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), (ref) => {
    result = ref;
  }, source);
  await waitReady(picker);

  runKeys(picker, ["b", KEYMAP["tui.select.confirm"]]); // filter to b.ts and open it
  runKeys(picker, ["j", " ", "j", " ", KEYMAP["tui.select.confirm"]]);

  assert.deepEqual(result, {
    path: "src/b.ts",
    startLine: 2,
    endLine: 3,
    code: "y\nz",
  });
});

test("confirming a selection over 200 lines requires a second confirmation", async () => {
  const content = Array.from({ length: 205 }, (_, i) => `line${i}`).join("\n");
  const source = {
    list: async () => ["big.ts"],
    read: () => content,
  };
  let result: CodeRef | undefined = undefined;
  let called = false;
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), (ref) => {
    called = true;
    result = ref;
  }, source);
  await waitReady(picker);

  runKeys(picker, [KEYMAP["tui.select.confirm"]]); // open big.ts
  runKeys(picker, [" ", ...Array.from({ length: 204 }, () => "j")]);
  runKeys(picker, [KEYMAP["tui.select.confirm"]]); // first confirm: warning only

  assert.equal(called, false);
  assert.ok(picker.render(80).some((line) => line.includes("200")));

  runKeys(picker, [KEYMAP["tui.select.confirm"]]); // second confirm: sends
  assert.equal(called, true);
  assert.equal(result?.startLine, 1);
  assert.equal(result?.endLine, 205);
});

test("opening a binary file is refused and stays on the file search view", async () => {
  const source = {
    list: async () => ["logo.png"],
    read: () => "PNG\0data",
  };
  let called = false;
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), () => {
    called = true;
  }, source);
  await waitReady(picker);

  runKeys(picker, [KEYMAP["tui.select.confirm"]]);

  assert.equal(called, false);
  assert.ok(picker.render(80).some((line) => line.includes("二进制")));
});

test("page keys move the code cursor by 20 lines", async () => {
  const content = Array.from({ length: 60 }, (_, i) => `line${i}`).join("\n");
  const source = {
    list: async () => ["big.ts"],
    read: () => content,
  };
  let result: CodeRef | undefined;
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), (ref) => {
    result = ref;
  }, source);
  await waitReady(picker);

  runKeys(picker, [KEYMAP["tui.select.confirm"]]); // open
  runKeys(picker, [KEYMAP["tui.select.pageDown"], KEYMAP["tui.select.pageDown"]]);
  runKeys(picker, [KEYMAP["tui.select.confirm"]]); // confirm cursor line (no mark set)

  assert.equal(result?.startLine, 41);
  assert.equal(result?.endLine, 41);
  assert.equal(result?.code, "line40");
});

test("escape in code view returns to file search; escape there cancels the flow", async () => {
  const source = {
    list: async () => ["a.ts"],
    read: () => "x\n",
  };
  let result: CodeRef | undefined = undefined;
  let called = false;
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), (ref) => {
    called = true;
    result = ref;
  }, source);
  await waitReady(picker);

  runKeys(picker, [KEYMAP["tui.select.confirm"], KEYMAP["tui.select.cancel"]]);
  assert.equal(called, false);
  assert.ok(picker.render(80).some((line) => line.includes("搜索")));

  runKeys(picker, [KEYMAP["tui.select.cancel"]]);
  assert.equal(called, true);
  assert.equal(result, undefined);
});

test("tab completes and opens the highlighted file directly without another keypress", async () => {
  const source = {
    list: async () => ["aaa.ts", "bbb.ts"],
    read: (file: string) => `${file}\nline2\n`,
  };
  let result: CodeRef | undefined;
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), (ref) => {
    result = ref;
  }, source);
  await waitReady(picker);

  runKeys(picker, [KEYMAP["tui.select.down"]]); // highlight bbb.ts
  runKeys(picker, [KEYMAP["tui.input.tab"]]); // complete + open

  assert.ok(picker.render(80).some((line) => line.includes("bbb.ts")));
  runKeys(picker, [KEYMAP["tui.select.confirm"]]); // confirm cursor line
  assert.equal(result?.path, "bbb.ts");
});

test("tab completes the file query to the highlighted file path", async () => {
  const source = {
    list: async () => ["aaa.ts", "bbb.ts"],
    read: (file: string) => `${file}\nline2\n`,
  };
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), () => {}, source);
  await waitReady(picker);

  // no query: first file highlighted -> tab completes and opens it
  runKeys(picker, [KEYMAP["tui.input.tab"]]);
  runKeys(picker, [KEYMAP["tui.select.cancel"]]); // back to file search
  assert.ok(picker.render(80).some((line) => line.includes("搜索 ▸ aaa.ts")));

  // clear query, move down to bbb.ts, tab completes and opens it
  runKeys(picker, ["\x7f", "\x7f", "\x7f", "\x7f", "\x7f", "\x7f", "\x7f"]);
  runKeys(picker, [KEYMAP["tui.select.down"]]);
  runKeys(picker, [KEYMAP["tui.input.tab"]]);
  runKeys(picker, [KEYMAP["tui.select.cancel"]]); // back to file search
  assert.ok(picker.render(80).some((line) => line.includes("搜索 ▸ bbb.ts")));
});

test("the first matched file is highlighted in the search list", async () => {
  const source = {
    list: async () => ["aaa.ts", "bbb.ts"],
    read: () => "x\n",
  };
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), () => {}, source);
  await waitReady(picker);

  const rendered = picker.render(80);
  assert.ok(rendered.some((line) => line.includes("<b><selectedBg>▸ aaa.ts</selectedBg></b>")));
  assert.ok(!rendered.some((line) => line.includes("<selectedBg>  bbb.ts")));
});

test("file search ignores case when matching file names", async () => {
  const source = {
    list: async () => ["SRC/Utils/Format.ts"],
    read: () => "x\n",
  };
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), () => {}, source);
  await waitReady(picker);

  runKeys(picker, ["f", "m", "t"]);
  assert.ok(picker.render(80).some((line) => line.includes("SRC/Utils/Format.ts")));
  assert.ok(!picker.render(80).some((line) => line.includes("无匹配")));
});

test("the picker shows a loading state and lists files only after they resolve", async () => {
  let resolveFiles!: (files: string[]) => void;
  const source = {
    list: () => new Promise<string[]>((resolve) => (resolveFiles = resolve)),
    read: () => "x\n",
  };
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), () => {}, source);

  assert.ok(picker.render(80).some((line) => line.includes("索引")));
  assert.ok(!picker.render(80).some((line) => line.includes("a.ts")));

  resolveFiles(["a.ts"]);
  await settle();
  assert.ok(picker.render(80).some((line) => line.includes("a.ts")));
});

// ---- in-file search ----

test("pressing slash enters file search and typing jumps to the nearest match", async () => {
  const source = {
    list: async () => ["a.ts"],
    read: () => "one\ntwo\ntwo again\nthree\n",
  };
  let result: CodeRef | undefined;
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), (ref) => {
    result = ref;
  }, source);
  await waitReady(picker);

  runKeys(picker, [KEYMAP["tui.select.confirm"]]); // open file, cursor at line 0
  runKeys(picker, ["/", "t", "w"]);
  assert.ok(picker.render(80).some((line) => line.includes("搜索")));

  runKeys(picker, [KEYMAP["tui.select.cancel"]]); // exit search, cursor stays on match
  runKeys(picker, [KEYMAP["tui.select.confirm"]]); // confirm cursor line = line 2 (index 1)
  assert.equal(result?.startLine, 2);
});

test("n and N jump to next and previous matches after leaving search", async () => {
  const source = {
    list: async () => ["a.ts"],
    read: () => "two\nx\ntwo\nx\ntwo\n",
  };
  let result: CodeRef | undefined;
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), (ref) => {
    result = ref;
  }, source);
  await waitReady(picker);

  runKeys(picker, [KEYMAP["tui.select.confirm"]]); // open
  runKeys(picker, ["/", "t", "w", "o", KEYMAP["tui.select.cancel"]]);
  runKeys(picker, ["n"]); // next match
  runKeys(picker, [KEYMAP["tui.select.confirm"]]);
  assert.equal(result?.startLine, 3);
});

test("search marks matching lines and reports the match count", async () => {
  const source = {
    list: async () => ["a.ts"],
    read: () => "two\nx\ntwo\n",
  };
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), () => {}, source);
  await waitReady(picker);

  runKeys(picker, [KEYMAP["tui.select.confirm"]]);
  runKeys(picker, ["/", "t", "w", "o"]);
  const rendered = picker.render(80);
  assert.ok(rendered.some((line) => line.includes("⌕")));
  assert.ok(rendered.some((line) => line.includes("2")));
});

test("search with no match reports it and leaves the cursor unchanged", async () => {
  const source = {
    list: async () => ["a.ts"],
    read: () => "one\ntwo\n",
  };
  let result: CodeRef | undefined;
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), (ref) => {
    result = ref;
  }, source);
  await waitReady(picker);

  runKeys(picker, [KEYMAP["tui.select.confirm"]]); // cursor line 0
  runKeys(picker, ["/", "z", "z", KEYMAP["tui.select.cancel"]]);
  assert.ok(picker.render(80).some((line) => line.includes("无匹配")));

  runKeys(picker, [KEYMAP["tui.select.confirm"]]);
  assert.equal(result?.startLine, 1); // still line 1 (index 0)
});

test("matched text is highlighted within lines during file search", async () => {
  const source = {
    list: async () => ["a.ts"],
    read: () => "foo bar foo\nsecond\n",
  };
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), () => {}, source);
  await waitReady(picker);

  runKeys(picker, [KEYMAP["tui.select.confirm"]]); // open
  runKeys(picker, ["/", "f", "o", "o"]);

  assert.ok(
    picker
      .render(80)
      .some((line) => line.includes("<inv><b>foo</b></inv> bar <inv><b>foo</b></inv>")),
  );
});

test("match highlights remain visible after leaving search so n/N land on visible matches", async () => {
  const source = {
    list: async () => ["a.ts"],
    read: () => "foo bar\nsecond\n",
  };
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), () => {}, source);
  await waitReady(picker);

  runKeys(picker, [KEYMAP["tui.select.confirm"]]);
  runKeys(picker, ["/", "f", "o", "o", KEYMAP["tui.select.cancel"]]);

  assert.ok(picker.render(80).some((line) => line.includes("<inv><b>foo</b></inv>")));
});

test("in-file search ignores case and highlights the original text casing", async () => {
  const source = {
    list: async () => ["a.ts"],
    read: () => "FooBar baz\n",
  };
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), () => {}, source);
  await waitReady(picker);

  runKeys(picker, [KEYMAP["tui.select.confirm"]]);
  runKeys(picker, ["/", "f", "o", "o", "b", "a", "r"]);
  assert.ok(picker.render(80).some((line) => line.includes("<inv><b>FooBar</b></inv> baz")));
});

test("enter leaves in-file search, locates the position, and n/N keep navigating", async () => {
  const source = {
    list: async () => ["a.ts"],
    read: () => "one\ntwo\nthree\ntwo again\n",
  };
  let result: CodeRef | undefined;
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), (ref) => {
    result = ref;
  }, source);
  await waitReady(picker);

  runKeys(picker, [KEYMAP["tui.select.confirm"]]); // open
  runKeys(picker, ["/", "t", "w", "o"]); // live jump to the first "two" (line 2)
  runKeys(picker, [KEYMAP["tui.select.confirm"]]); // enter: locate + exit search

  const rendered = picker.render(80);
  assert.ok(!rendered.some((line) => line.includes("搜索 ▸")), "search mode must be closed");
  assert.ok(rendered.some((line) => line.includes("◉")), "position must be pinned");
  assert.ok(rendered.some((line) => line.includes("已定位")), "status must report it");

  runKeys(picker, ["n"]); // next match: line 4
  runKeys(picker, ["N"]); // back: line 2
  runKeys(picker, [KEYMAP["tui.select.confirm"]]);
  assert.equal(result?.startLine, 2);
});

test("alt+enter no longer triggers anything special in search mode", async () => {
  const source = { list: async () => ["a.ts"], read: () => "one\ntwo\n" };
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), () => {}, source);
  await waitReady(picker);

  runKeys(picker, [KEYMAP["tui.select.confirm"]]);
  runKeys(picker, ["/", "t", "w", "o"]);
  runKeys(picker, ["\x1b\r"]); // alt+enter is no longer a shortcut

  const rendered = picker.render(80);
  assert.ok(rendered.some((line) => line.includes("搜索 ▸ two")), "must stay in search mode");
  assert.ok(!rendered.some((line) => line.includes("已定位")), "must not pin the position");
});

test("leaving search with escape does not pin the position", async () => {
  const source = {
    list: async () => ["a.ts"],
    read: () => "one\ntwo\nthree\n",
  };
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), () => {}, source);
  await waitReady(picker);

  runKeys(picker, [KEYMAP["tui.select.confirm"]]);
  runKeys(picker, ["/", "t", "h", "r", KEYMAP["tui.select.cancel"]]);
  assert.ok(!picker.render(80).some((line) => line.includes("◉")));
  assert.ok(!picker.render(80).some((line) => line.includes("已定位")));
});

test("code view fits the terminal height so status lines are never cut off", async () => {
  const source = {
    list: async () => ["a.ts"],
    read: () => Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n"),
  };
  const shortTui = {
    requestRender() {},
    terminal: { rows: 24, columns: 80 },
  };
  const picker = createCodeRefPicker(shortTui, fakeTheme(), fakeKeybindings(), () => {}, source);
  await waitReady(picker);

  runKeys(picker, [KEYMAP["tui.select.confirm"]]); // open
  runKeys(picker, ["/", "l", "i", "n", "e", KEYMAP["tui.select.confirm"]]); // search, then Enter locates

  const rendered = picker.render(80);
  assert.ok(rendered.length <= 24, `expected <= 24 lines, got ${rendered.length}`);
  assert.ok(rendered.some((line) => line.includes("已定位")));
  assert.ok(rendered.some((line) => line.includes("Enter 确认")));
});

// ---- localization ----

test("detectLanguage picks Chinese for zh locales and English otherwise", () => {
  assert.equal(detectLanguage({ LANG: "zh_CN.UTF-8" }), "zh");
  assert.equal(detectLanguage({ LC_ALL: "zh_TW.UTF-8" }), "zh");
  assert.equal(detectLanguage({ LANG: "en_US.UTF-8" }), "en");
  assert.equal(detectLanguage({}), "en");
});

test("the picker renders English prompts in English environments", async () => {
  process.env.LANG = "en_US.UTF-8";
  try {
    const source = {
      list: async () => ["a.ts"],
      read: () => "one\ntwo\nthree\n",
    };
    const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), () => {}, source);
    await waitReady(picker);

    const fileView = picker.render(80).join("\n");
    assert.ok(fileView.includes("File search"));
    assert.ok(fileView.includes("Indexing") || !fileView.includes("索引"));

    runKeys(picker, [KEYMAP["tui.select.confirm"]]);
    runKeys(picker, ["/", "t", "w", KEYMAP["tui.select.confirm"]]);
    const codeView = picker.render(80).join("\n");
    assert.ok(codeView.includes("Located"));
    assert.ok(codeView.includes("Selected"));
  } finally {
    process.env.LANG = "zh_CN.UTF-8";
  }
});

test("G reaches the last line of a very large file (no 5000-line cap)", async () => {
  const content = Array.from({ length: 20000 }, (_, i) => `line${i}`).join("\n");
  const source = { list: async () => ["huge.ts"], read: () => content };
  let result: CodeRef | undefined;
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), (ref) => {
    result = ref;
  }, source);
  await waitReady(picker);
  runKeys(picker, [KEYMAP["tui.select.confirm"]]);
  runKeys(picker, ["G"]);
  runKeys(picker, [KEYMAP["tui.select.confirm"]]);
  assert.equal(result?.startLine, 20000);
  assert.equal(result?.code, "line19999");
});

test("syntax highlighting is filled in for a window deep inside a huge file", async () => {
  const content = Array.from({ length: 30000 }, (_, i) => `const v${i} = "s";`).join("\n");
  const source = { list: async () => ["huge.ts"], read: () => content };
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), () => {}, source);
  await waitReady(picker);
  runKeys(picker, [KEYMAP["tui.select.confirm"]]);
  runKeys(picker, ["G"]); // jump to the end: far beyond any sync-highlight budget

  const highlighted = () =>
    picker.render(80).some((line) => line.includes("[syntaxKeyword:const]"));
  for (let i = 0; i < 100 && !highlighted(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(highlighted(), "expected syntax tokens near the end of the file");
});

// ---- ergonomic paging keys (PageUp/PageDown are swallowed by pi's fullscreen scroll) ----

test("ctrl+f and ctrl+b page down and up by 20 lines", async () => {
  const content = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n");
  const source = { list: async () => ["big.ts"], read: () => content };
  let result: CodeRef | undefined;
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), (ref) => {
    result = ref;
  }, source);
  await waitReady(picker);

  runKeys(picker, [KEYMAP["tui.select.confirm"]]); // open, cursor line 1
  runKeys(picker, ["\x06", "\x06"]); // ctrl+f twice -> +40
  runKeys(picker, [KEYMAP["tui.select.confirm"]]);
  assert.equal(result?.startLine, 41);

  runKeys(picker, ["\x02"]); // ctrl+b -> back 20
  runKeys(picker, [KEYMAP["tui.select.confirm"]]);
  assert.equal(result?.startLine, 21);
});

test("ctrl+d and ctrl+u move the code cursor by half a page", async () => {
  const content = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n");
  const source = { list: async () => ["big.ts"], read: () => content };
  let result: CodeRef | undefined;
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), (ref) => {
    result = ref;
  }, source);
  await waitReady(picker);

  runKeys(picker, [KEYMAP["tui.select.confirm"]]); // open, cursor line 1
  runKeys(picker, ["\x04", "\x04"]); // ctrl+d twice -> +20 (half page = 10)
  runKeys(picker, [KEYMAP["tui.select.confirm"]]);
  assert.equal(result?.startLine, 21);

  runKeys(picker, ["\x15"]); // ctrl+u -> back 10
  runKeys(picker, [KEYMAP["tui.select.confirm"]]);
  assert.equal(result?.startLine, 11);
});

test("backspace deletes query characters with Kitty keyboard protocol too", async () => {
  const source = {
    list: async () => ["aaa.ts", "bbb.ts"],
    read: () => "x\n",
  };
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), () => {}, source);
  await waitReady(picker);

  runKeys(picker, ["b", "b", "b"]);
  const queryOf = () => {
    const line = picker.render(80).find((l) => l.includes("搜索 ▸")) ?? "";
    return line.split("搜索 ▸")[1]?.trim() ?? "";
  };
  assert.equal(queryOf(), "bbb");

  runKeys(picker, ["\x1b[127u"]); // kitty backspace
  assert.equal(queryOf(), "bb");

  runKeys(picker, ["\x7f"]); // legacy backspace still works
  assert.equal(queryOf(), "b");
});

test("paging keys work with Kitty keyboard protocol sequences (cmux/Ghostty/kitty)", async () => {
  const content = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n");
  const source = { list: async () => ["big.ts"], read: () => content };
  let result: CodeRef | undefined;
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), (ref) => {
    result = ref;
  }, source);
  await waitReady(picker);

  runKeys(picker, [KEYMAP["tui.select.confirm"]]); // open, cursor line 1
  runKeys(picker, ["\x1b[100;5u", "\x1b[100;5u"]); // kitty Ctrl+D x2 -> +20
  runKeys(picker, [KEYMAP["tui.select.confirm"]]);
  assert.equal(result?.startLine, 21);

  runKeys(picker, ["\x1b[102;5u"]); // kitty Ctrl+F -> +20
  runKeys(picker, [KEYMAP["tui.select.confirm"]]);
  assert.equal(result?.startLine, 41);

  runKeys(picker, ["\x1b[117;5u"]); // kitty Ctrl+U -> -10
  runKeys(picker, [KEYMAP["tui.select.confirm"]]);
  assert.equal(result?.startLine, 31);

  runKeys(picker, ["\x1b[98;5u"]); // kitty Ctrl+B -> -20
  runKeys(picker, [KEYMAP["tui.select.confirm"]]);
  assert.equal(result?.startLine, 11);
});

test("ctrl+d still pages while the in-file search is open", async () => {
  const content = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n");
  const source = { list: async () => ["big.ts"], read: () => content };
  let result: CodeRef | undefined;
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), (ref) => {
    result = ref;
  }, source);
  await waitReady(picker);

  runKeys(picker, [KEYMAP["tui.select.confirm"]]);
  runKeys(picker, ["/"]); // search mode, empty query
  runKeys(picker, ["\x04"]); // ctrl+d pages
  runKeys(picker, [KEYMAP["tui.select.cancel"]]);
  runKeys(picker, [KEYMAP["tui.select.confirm"]]);
  assert.equal(result?.startLine, 11);
});

test("printable keys work when the terminal encodes them (full Kitty mode)", async () => {
  const content = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n");
  const source = { list: async () => ["a.ts"], read: () => content };
  let result: CodeRef | undefined;
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), (ref) => {
    result = ref;
  }, source);
  await waitReady(picker);

  runKeys(picker, [KEYMAP["tui.select.confirm"]]); // open, cursor line 1
  runKeys(picker, ["\x1b[106u", "\x1b[106u"]); // kitty 'j' twice -> cursor line 3
  runKeys(picker, ["\x1b[32u"]); // kitty space -> mark start at line 3
  runKeys(picker, ["\x1b[106u"]); // kitty 'j' -> line 4
  runKeys(picker, ["\x1b[32u"]); // kitty space -> fix end at line 4
  runKeys(picker, [KEYMAP["tui.select.confirm"]]);

  assert.equal(result?.startLine, 3);
  assert.equal(result?.endLine, 4);
});

test("slash enters in-file search when the terminal encodes it", async () => {
  const source = { list: async () => ["a.ts"], read: () => "one\ntwo\n" };
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), () => {}, source);
  await waitReady(picker);
  runKeys(picker, [KEYMAP["tui.select.confirm"]]);
  runKeys(picker, ["\x1b[47u", "\x1b[116u", "\x1b[119u"]); // kitty '/', 't', 'w'

  const rows = picker.render(80);
  assert.ok(rows.some((line) => line.includes("搜索 ▸ tw")), rows.join("\n"));
});

test("typing spaces into the file query works when encoded", async () => {
  const source = { list: async () => ["src/utils/format.ts", "other.ts"], read: () => "x\n" };
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), () => {}, source);
  await waitReady(picker);

  runKeys(picker, ["u", "\x1b[32u", "f"]); // "u f"
  const line = picker.render(80).find((l) => l.includes("搜索 ▸")) ?? "";
  assert.equal(line.split("搜索 ▸")[1]?.trim(), "u f");
  assert.ok(picker.render(80).some((l) => l.includes("src/utils/format.ts")));
});

test("g jumps to the top and G jumps to the last line", async () => {
  const content = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n");
  const source = { list: async () => ["big.ts"], read: () => content };
  let result: CodeRef | undefined;
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), (ref) => {
    result = ref;
  }, source);
  await waitReady(picker);

  runKeys(picker, [KEYMAP["tui.select.confirm"]]); // open, cursor line 1
  runKeys(picker, ["G"]); // bottom
  runKeys(picker, [KEYMAP["tui.select.confirm"]]);
  assert.equal(result?.startLine, 100);

  runKeys(picker, ["g"]); // top
  runKeys(picker, [KEYMAP["tui.select.confirm"]]);
  assert.equal(result?.startLine, 1);
});

test("g and G work when the terminal encodes letters (Kitty mode)", async () => {
  const content = Array.from({ length: 50 }, (_, i) => `line${i}`).join("\n");
  const source = { list: async () => ["big.ts"], read: () => content };
  let result: CodeRef | undefined;
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), (ref) => {
    result = ref;
  }, source);
  await waitReady(picker);

  runKeys(picker, [KEYMAP["tui.select.confirm"]]);
  runKeys(picker, ["\x1b[71u"]); // kitty 'G'
  runKeys(picker, [KEYMAP["tui.select.confirm"]]);
  assert.equal(result?.startLine, 50);

  runKeys(picker, ["\x1b[103u"]); // kitty 'g'
  runKeys(picker, [KEYMAP["tui.select.confirm"]]);
  assert.equal(result?.startLine, 1);
});

// ---- syntax highlighting ----

test("code view highlights TypeScript syntax with pi theme tokens", async () => {
  const source = {
    list: async () => ["a.ts"],
    read: () => 'const x = "hi"\n// note\n',
  };
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), () => {}, source);
  await waitReady(picker);
  runKeys(picker, [KEYMAP["tui.select.confirm"]]);

  const rendered = picker.render(80).join("\n");
  assert.ok(rendered.includes("[syntaxKeyword:const]"));
  assert.ok(rendered.includes('[syntaxString:&quot;hi&quot;]') || rendered.includes('[syntaxString:"hi"]'));
  assert.ok(rendered.includes("[syntaxComment:// note]"));
});

test("unknown file types are left unhighlighted", async () => {
  const source = {
    list: async () => ["notes.txt"],
    read: () => "const x\n",
  };
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), () => {}, source);
  await waitReady(picker);
  runKeys(picker, [KEYMAP["tui.select.confirm"]]);

  assert.ok(!picker.render(80).join("\n").includes("[syntax"));
});

test("python files are highlighted by extension", async () => {
  const source = {
    list: async () => ["a.py"],
    read: () => "def foo():\n",
  };
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), () => {}, source);
  await waitReady(picker);
  runKeys(picker, [KEYMAP["tui.select.confirm"]]);

  assert.ok(picker.render(80).join("\n").includes("[syntaxKeyword:def]"));
});

test("multi-line comments keep their token on later lines", async () => {
  const source = {
    list: async () => ["a.ts"],
    read: () => "/* first\nsecond */\nreal()\n",
  };
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), () => {}, source);
  await waitReady(picker);
  runKeys(picker, [KEYMAP["tui.select.confirm"]]);

  const rendered = picker.render(80).join("\n");
  assert.ok(rendered.includes("[syntaxComment:second */]"));
});

// ---- extension wiring ----

test("the coderef command inserts the selected reference into the editor after existing text", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coderef-cmd-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "a.ts"), "one\ntwo\nthree\n");

  const commands: Record<string, { handler: (...args: unknown[]) => Promise<void> }> = {};
  let shortcut: unknown;
  codeRefExtension({
    registerCommand: (name: string, opts: { handler: (...args: unknown[]) => Promise<void> }) => {
      commands[name] = opts;
    },
    registerShortcut: (keys: string, opts: unknown) => {
      shortcut = [keys, opts];
    },
  } as never);

  assert.ok(commands.coderef, "the primary command should be /coderef");
  assert.ok(commands.pick, "/pick should remain as an alias");
  assert.ok(shortcut, "a keyboard shortcut should be registered");

  let editorText = "重构这段";
  const created: Array<{ handleInput(data: string): void }> = [];
  const ctx = {
    mode: "tui",
    cwd: root,
    ui: {
      custom: (factory: (tui: unknown, theme: unknown, kb: unknown, done: (v: unknown) => void) => unknown) =>
        new Promise((resolve) => {
          created.push(factory(fakeTui(), fakeTheme(), fakeKeybindings(), resolve as (v: unknown) => void) as never);
        }),
      getEditorText: () => editorText,
      setEditorText: (text: string) => {
        editorText = text;
      },
      notify: () => {},
    },
  };

  const run = commands.coderef.handler("", ctx);
  await waitReady(created[0]);
  runKeys(created[0], ["a", KEYMAP["tui.select.confirm"]]); // open src/a.ts
  runKeys(created[0], [" ", "j", " ", KEYMAP["tui.select.confirm"]]); // mark lines 1-2 and confirm
  await run;

  assert.equal(editorText, "重构这段\n\n@src/a.ts:1-2");
});
