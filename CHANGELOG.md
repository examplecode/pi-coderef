# Changelog

## [1.0.7] - 2026-11-24

- Fix: paging keys and backspace now work on terminals that use the Kitty keyboard protocol (cmux, Ghostty, kitty, WezTerm)
- Fix: printable commands (`j`/`k`/`/`/`n`/`N`/`space`) are normalized, so they work when a terminal encodes every key
- New: `g` jumps to the top of the file, `G` jumps to the last line
- Changed: in search mode `Enter` now accepts the match, leaves search and pins it; `n`/`N` then walk the matches
- Removed: `Alt+Enter` (superseded by `Enter`)
- New: mouse selection — click a line and drag to select a range; mouse wheel scrolls the code view
- Fix: the code view no longer scrolls during a mouse drag, and no longer jumps when the mouse is released (the viewport only re-centers on keyboard navigation)
- New: selected lines are highlighted; the file list highlight now works on every theme (pi's "system" theme carries no background colors, so inverse video is used as a fallback)
- New: `space` after a mouse selection starts a fresh mark in one press
- Fix: the picker claims viewport keys, so `PageUp`/`PageDown` now page the code view instead of scrolling the transcript
- Hint bar split into two lines so every shortcut stays visible on narrow terminals
- Fix: removal of the 5000-line display cap. Every line is now reachable; large files open instantly because only the visible window is highlighted, in the background
- Fix: the code view no longer blocks on syntax highlighting (3 ms to open a 30k-line file)

## [1.0.6] - 2026-11-24

- Paging keys that actually reach the picker: `Ctrl+D`/`Ctrl+U` (half page) and `Ctrl+F`/`Ctrl+B` (full page).
  `PageUp`/`PageDown` are swallowed by pi's fullscreen transcript scroll, so they are kept only as a fallback.
- Hint line shortened so it stays readable on 80-column terminals
- Fix: the hint line could be clipped entirely; code rows are now budgeted from the live status-line count
- Gallery media re-recorded with the new hints

## [1.0.5] - 2026-11-24

- README: install command updated to the current version, plus an always-latest form
- docs: demo GIF compressed to 537 KB

## [1.0.4] - 2026-11-24

- Gallery preview now uses an animated GIF (`pi.image`) that autoplays everywhere; the mp4 stays in `pi.video`
- Demo trimmed to the interactive part (starts at the file picker)

## [1.0.3] - 2026-11-24

- README: recommend the npm install command first
- README: document the syntax-highlighted code view

## [1.0.2] - 2026-11-24

- Syntax highlighting in the code view, using pi's own `syntax*` theme tokens (theme-aware)
- Languages detected by extension: TypeScript/JavaScript, Python, Go, Java, Kotlin, Rust, C/C++, Bash, YAML, JSON, Ruby, PHP, SQL, CSS, HTML, Swift
- Updated gallery preview media (highlighted screenshot and demo video)

## [1.0.1] - 2026-11-23

- Bilingual UI: English and Chinese prompts, selected from the system locale
- Fix: code view now fits the terminal height so status lines are never cut off
- Replace emoji markers that lack glyphs in common monospace fonts
- Gallery preview media (`pi.image`, `pi.video`)

## [1.0.0] - 2026-11-23

- Initial release
- Fuzzy file search (case-insensitive) with highlighted selection and `Tab` complete-and-open
- Read-only code view: cursor movement, paging, mark-based range selection
- In-file search: live jump, match highlighting, `n`/`N` navigation, `Alt+Enter` position pin
- Output: `@file:line` / `@file:start-end` code reference appended to the prompt
- Safety: binary-file guard, 5000-line truncation, large-selection confirmation
