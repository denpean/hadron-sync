# Hadron Sync

Version 1.10.0 (2026-09-24)

**Author:** Dennis Peteranderl · **Contact:** hadron.unfreeze611@passmail.net

> **Note:** Hadron Sync is an **unofficial, private, non-commercial project**. It is in no way affiliated with Proton AG and is neither supported nor reviewed by Proton. The software was created with the help of the AI assistants **Claude (Anthropic)** and **Mistral AI**. **Installation and use are at your own risk and without any warranty.** Make backup copies of your data before use.

Two-way synchronization of any number of local folders with folders in Proton Drive, with a tray icon, settings window, and interface in German, English, Spanish, and French. Built on the official [Proton Drive CLI](https://proton.me/support/drive-cli).

## Installation

```
tar xzf hadron-sync.tar.gz
cd hadron-sync
./install.sh
```

The installer

1. installs missing system packages (Python/GTK, tray support, keyring) – after asking, via `sudo`,
2. downloads the **current Proton Drive CLI** from Proton's official download index
   (`https://proton.me/download/drive/cli/index.html`), verifies it against the **SHA-512 checksum** published there,
   and installs it to `/usr/local/bin` (with `--user` to `~/.local/bin`, without sudo),
3. automatically selects the appropriate variant (x64, ARM64, musl; older CPUs without AVX2 receive the baseline version),
4. installs Hadron Sync to `~/.local/share/hadron-sync`, creates the menu entry, icons, and the
   `hadron-sync` command,
5. asks about autostart and offers to sign in to Proton (browser).

Before doing so, the installer shows the note above and only installs after your confirmation
(without asking: `--yes`, which then counts as confirmation).

Do not run as root – the tool is set up for your user.

**Updating:** run `./install.sh` again from a newer package version. The CLI is only
downloaded if there is a new version. Folder pairs, settings, and sync state are preserved;
a running Hadron Sync is stopped and restarted.

### Options

| Option | Effect |
|---|---|
| `--user` | CLI to `~/.local/bin` instead of `/usr/local/bin` (no sudo required) |
| `--no-deps` | do not install system packages |
| `--skip-cli` | do not install/update the CLI |
| `--force` | re-download the CLI even if the version is unchanged |
| `--autostart` / `--no-autostart` | enable/disable autostart at login |
| `--no-login`, `--no-start` | do not offer sign-in / do not start |
| `-y`, `--yes` | answer all prompts with yes |

## First Steps

On first start, a **wizard** guides you through setup: note, Proton sign-in, first folder pair,
autostart/interval. If it finds settings from a previous installation, you can adopt them or set everything up
from scratch (your files are always preserved in either case; only settings and sync state are discarded).

The main window shows the logo, a colored progress bar with estimated remaining time, and a color-highlighted
log (errors in red, uploads in blue, downloads in purple, conflicts in orange). All basic settings –
folder pairs, exclusions, CLI path, language, autostart, instant sync, thumbnails, interval, and concurrent
queries – are available in the separate **Settings …** window. With "Save & apply" they take effect immediately;
if a sync is currently running, it can be restarted with the new values on request.

**Tray icon:** Purple = ready, yellow = reading/comparing files, blue = actively uploading or downloading,
red = error. The blue sync icon thus appears only during an actual transfer. After a completed sync with
changes, a brief notification is also shown.

**Storage display:** The CLI does not provide an account quota. The display shows the used space of the synced
folders from the last sync; if you enter your quota in the settings, a bar with a percentage is derived from it.

1. Start Hadron Sync from the application menu (or `hadron-sync`).
2. **Add …**: select a local folder and a folder in Proton Drive.
3. First do a **dry run** – the log shows what would happen. Then **Save & apply**.

## Removal

```
~/.local/share/hadron-sync/uninstall.sh
```

Removes the program, menu entry, autostart, and icons. On request (or with `--purge`, `--logout`,
`--remove-cli`) also the settings, the Proton sign-in, and the CLI. **Synced files are never deleted.**

## System Requirements

- Designed for Debian/Ubuntu-based systems (Zorin OS, Ubuntu, Mint, Debian). The installer was tested
  on Ubuntu 24.04 with a simulated CLI, but not yet on a real desktop installation. For Fedora, Arch, and
  openSUSE the package names are stored, but **not tested**.
- The tray icon on GNOME requires an AppIndicator extension (Ubuntu and Zorin OS ship with one).
- The Proton sign-in is stored in the keyring (GNOME Keyring). With automatic login to the computer without
  a password, the keyring remains locked – in that case you may need to sign in to Hadron Sync again.

## Important Notes

- Verified against the commands of **cli-drive 0.7.0 and 0.8.0** (0.8.0 no longer supports the short option `-c`). The installer always fetches the latest CLI
  (currently 0.8.0). If Proton changes the CLI's behavior, this can affect syncing – after a CLI update,
  run a **dry run** first.
- If a thumbnail cannot be generated for a file (e.g. a `.PNG` that is not a PNG), Hadron Sync automatically
  uploads it without a thumbnail. Thumbnails can also be disabled entirely in the settings – this
  speeds up uploading many images, but Proton Drive then shows no preview.
- File names containing `[` `]` `*` `?` are escaped on upload, because otherwise the CLI treats them as search patterns.
- When downloading, the Proton CLI replaces characters like `"` `:` `*` `?` `<` `>` `|` with `_`. Hadron Sync
  then restores the original name. If two files in Proton Drive differ only in such a character,
  one of them may not be creatable locally; it is reported as an error.
- Deletions always go to the trash (local or Proton Drive respectively), never permanent. In case of conflicts,
  both versions are kept (`Name (Conflict …).ext`).

## Files and Privacy

| Path | Contents | Permissions |
|---|---|---|
| `~/.config/hadron-sync/` | Settings, sync state per folder pair | 700 / 600 |
| `~/.local/state/hadron-sync/sync.log` | Log (file names; login links are redacted) | 600 |
| `<sync folder>/.hadron-sync-tmp` | temporarily: downloads in progress | 700 |

Hadron Sync does not store passwords or session keys – these are managed by the Proton CLI in the keyring.

## Tests

```
python3 tests/run_tests.py
```

Installer and uninstaller speak German, English, Spanish, and French (according to system language,
otherwise English); the texts are in `messages.sh`.

Runs fully offline against a simulated CLI and a simulated download index; does not modify your
folders or Proton Drive (works only in `/tmp/hadron-sync-test`). The installer tests require a normal
user (not root).
