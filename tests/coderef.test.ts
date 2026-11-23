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

// ---- code lines ----

test("splitFileLines splits lines and drops the trailing empty line", () => {
  assert.deepEqual(splitFileLines("a\nb\n"), { lines: ["a", "b"], truncated: false });
  assert.deepEqual(splitFileLines("a\nb"), { lines: ["a", "b"], truncated: false });
  assert.deepEqual(splitFileLines(""), { lines: [], truncated: false });
});

test("splitFileLines truncates files beyond 5000 lines", () => {
  const content = Array.from({ length: 5001 }, (_, i) => `line${i}`).join("\n");
  const result = splitFileLines(content);
  assert.equal(result.lines.length, 5000);
  assert.equal(result.truncated, true);
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
    fg: (_color: string, text: string) => text,
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

test("alt+enter leaves in-file search and pins the current match as the located position", async () => {
  const source = {
    list: async () => ["a.ts"],
    read: () => "one\ntwo\nthree\n",
  };
  let result: CodeRef | undefined;
  const picker = createCodeRefPicker(fakeTui(), fakeTheme(), fakeKeybindings(), (ref) => {
    result = ref;
  }, source);
  await waitReady(picker);

  runKeys(picker, [KEYMAP["tui.select.confirm"]]); // open
  runKeys(picker, ["/", "t", "h", "r"]); // jump toward "three"
  runKeys(picker, ["\x1b\r"]); // alt+enter: accept position

  const rendered = picker.render(80);
  assert.ok(!rendered.some((line) => line.includes("搜索 ▸")));
  assert.ok(rendered.some((line) => line.includes("◉")));
  assert.ok(rendered.some((line) => line.includes("已定位")));

  runKeys(picker, [KEYMAP["tui.select.confirm"]]);
  assert.equal(result?.startLine, 3);
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
  runKeys(picker, ["/", "l", "i", "n", "e", "\x1b\r"]); // search, then alt+enter pins the position

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
    runKeys(picker, ["/", "t", "w", "\x1b\r"]);
    const codeView = picker.render(80).join("\n");
    assert.ok(codeView.includes("Located"));
    assert.ok(codeView.includes("Selected"));
  } finally {
    process.env.LANG = "zh_CN.UTF-8";
  }
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
