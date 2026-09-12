# Setup

**Verified on 2026-09-11** on the development machine: Windows 11 Pro, x64. Machines drift. Re-run the checks
at the end of this file rather than trusting this table.

## The chosen stack, and what it needs

`docs/ADR-0001-stack.md` is approved: **Electron with TypeScript end to end**, the `git` command-line
interface read over a pipe, and no native compilation. Its requirements are **git, Node and npm**, all three
already present. **Nothing has to be installed on this machine**, which is why the table below matters less
than it did: the two missing rows, Rust and the Microsoft C++ build tools, belong to candidates that were
not chosen and are kept only so the decision can be re-read against what it cost.

The git version floor is measured and recorded here by the slice that lands the git adapter
(E01-M01-S03). Until then, treat git 2.25 as the assumed floor.

## What each candidate stack needed, at the time of the decision

Every candidate needs **git**, which is the application's data source.

| candidate | also needs |
| --- | --- |
| Tauri 2 (Rust core, system webview) | Rust toolchain (rustup, MSVC host), Microsoft C++ build tools **with a Windows SDK**, WebView2 runtime, Node and npm for the frontend build |
| Electron (TypeScript) | Node and npm. Native build tools only if a native Node module is added |
| Native Rust GUI (for example egui, iced or Slint) | Rust toolchain, Microsoft C++ build tools with a Windows SDK |

Other candidates (.NET with Avalonia, Qt) were not checked. Choosing one adds its own rows here.

## Machine state on 2026-09-11

| requirement | state | version | how it was checked |
| --- | --- | --- | --- |
| git | found | 2.51.0.windows.1 | `git --version` |
| GitHub CLI | found, authenticated | 2.96.0 | `gh --version`, `gh auth status` |
| Node | found | v24.18.0 | `node --version` |
| npm | found | 11.16.0 | `npm --version` |
| winget | found | v1.29.290 | `winget --version` |
| WebView2 runtime | found, machine-wide | 152.0.4191.66 | EdgeUpdate client key, value `pv`: present under HKLM (WOW6432Node), absent under HKCU |
| `rustc`, `cargo`, `rustup` | **missing** | | not on `PATH`; no rustup or cargo home in the user profile |
| MSVC C++ build tools | **missing** | | `vswhere.exe` absent (no Visual Studio Installer); no Visual Studio install directories; `link.exe` and `cl.exe` not on `PATH` |
| Windows SDK | **missing** | | no `Windows Kits\10` directory; no `Microsoft SDKs\Windows\v10.0` registry key |
| `CARGO_TARGET_DIR` | not set | | user environment |

**What this means for the decision.** Tauri 2 and a native Rust GUI each need **two** machine-level installs
before anything compiles: the Rust toolchain, and the C++ build tools with a Windows SDK. Electron needs
nothing that is not already present.

## What changed since the previous check (2026-08-25)

An earlier scaffold of this product (see [`INPUTS.md`](INPUTS.md)) recorded the same machine on 2026-08-25.

| item | 2026-08-25 | 2026-09-11 |
| --- | --- | --- |
| WebView2 runtime | 151.0.4129.x | 152.0.4191.66 (the runtime updates itself) |
| Node, npm, git, GitHub CLI | as above | unchanged |
| Rust toolchain | missing | still missing |
| MSVC C++ build tools | **not verified**: the earlier note only said to look for `link.exe` | verified **missing**, along with the Visual Studio Installer and any Windows SDK |
| winget, `CARGO_TARGET_DIR` | not recorded | recorded above |

## Installing, after the stack decision and not before

These are machine-level changes that modify `PATH` and take several gigabytes. They are the owner's call, run
from an interactive terminal.

**Rust toolchain:**

```powershell
winget install --id Rustlang.Rustup -e
# open a new terminal, then:
rustc --version; cargo --version
```

**C++ build tools and a Windows SDK.** Install Visual Studio Build Tools with the **"Desktop development with
C++"** workload, which brings the MSVC toolset and a Windows SDK. The winget package ID changes between
Visual Studio generations, so look it up first rather than trusting an ID written here:

```powershell
winget search Microsoft.VisualStudio
```

Tauri's own prerequisites page is the authority for exactly what Tauri needs, if Tauri is chosen.

**WebView2:** already installed. Nothing to do.

## If the stack uses Rust and worktrees

Every git worktree gets its own `target/` directory by default, so three lanes means three full builds of the
same dependency tree. Before creating any lane, point every build at one shared directory **outside** the
worktrees with a user environment variable:

```powershell
[Environment]::SetEnvironmentVariable('CARGO_TARGET_DIR', "$env:USERPROFILE\.cargo-target\git-graphical-standalone", 'User')
```

This belongs in the environment, not in a committed `.cargo/config.toml`: a relative `build.target-dir`
resolves inside each worktree, which is the problem itself, and an absolute path does not belong in a
repository that is cloned elsewhere. Confirm that the variable reaches child processes before relying on it.

## Re-running the checks

PowerShell:

```powershell
foreach ($c in 'rustc','cargo','rustup','node','npm','git','gh','winget') {
  if (Get-Command $c -ErrorAction SilentlyContinue) { "$c : " + (& $c --version | Select-Object -First 1) } else { "$c : MISSING" }
}

# WebView2 runtime: value 'pv' of the EdgeUpdate client key, machine-wide and per-user
$k = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
(Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$k" -ErrorAction SilentlyContinue).pv
(Get-ItemProperty "HKCU:\Software\Microsoft\EdgeUpdate\Clients\$k" -ErrorAction SilentlyContinue).pv

# MSVC toolset and Windows SDK, through vswhere (absent means no Visual Studio Installer at all)
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vswhere) {
  & $vswhere -all -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property displayName
  & $vswhere -all -products * -include packages -format json | ConvertFrom-Json |
    ForEach-Object { $_.packages } | Where-Object { $_.id -match 'Windows1[01]SDK' } |
    ForEach-Object { "$($_.id) $($_.version)" } | Sort-Object -Unique
} else { 'vswhere: MISSING' }
```
