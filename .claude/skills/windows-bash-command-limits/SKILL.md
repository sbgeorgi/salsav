---
name: windows-bash-command-limits
description: "Use when a Bash command on Windows is very long or contains a large heredoc, or the shell-lint hook rejects a command with a length or unexpected EOF error."
category: tooling
status: active
author: reflect
created: 2026-11-11
---
Directive: when a Bash call is long or holds a big heredoc, write it to a file with Write and run that file, instead of retrying the same command.
The shell-lint hook rejects Bash commands of roughly 7000 characters or more, and heredocs that run long end with unexpected EOF.
Steps: Write the Python to a scratch .py file, the SQL to a .sql file, the shell steps to a .sh file; then run it, e.g. python FILE (never python3 on Windows).
Pass C:/ paths to native tools, not /c/ paths, when the tool is a Windows binary.
Keep Bash heredocs short (one or two commands); move anything larger into a file. Regex backslashes (\\b, \\d) in a heredoc or inline python get halved or turned into control characters: write such scripts with Write or Edit, then grep the result for the exact pattern.
Check the file exists and is non-empty before running it, so a failed Write is not mistaken for a passing run.
Never retry an identical rejected command; change its form first.
A removal such as rm with a relative glob after cd is blocked by the safety check; name the files explicitly or overwrite them instead.
