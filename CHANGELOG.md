# Changelog

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
