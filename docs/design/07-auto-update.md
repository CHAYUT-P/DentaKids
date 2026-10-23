# 07 · Auto-update for the clinic PCs

*Status: built (2026-10-23); needs the one-time setup below before the first
release. Code: `apps/staff-desktop/src/components/UpdateBanner.tsx`, the
updater plugin in `apps/staff-desktop/src-tauri` (`lib.rs`, `tauri.conf.json`,
`capabilities/default.json`), `.github/workflows/staff-app-windows.yml`.*

## The problem

The staff screens are packaged inside the installed desktop app. A fix to the
server reaches the clinic the moment the server is updated, but a fix to a
staff screen needed someone to download and reinstall the app on every PC.

## How it works

```
GitHub Actions (Run workflow, with "what changed")
  → builds the Windows installer, signs the update with our private key
  → publishes it to the PUBLIC repo CHAYUT-P/DentaKids-releases (Releases)
  → writes <edition>/latest.json there: "newest is 0.1.N, download here, signature …"

Clinic PC (Denta Kids Staff, any screen, on open + every 3 hours)
  → reads queue/latest.json (or full/latest.json)
  → newer than me? → corner card: "มีเวอร์ชันใหม่ 0.1.N — <what changed>"
  → staff tap อัปเดตตอนนี้ → download → signature checked against the public
    key inside the app → install (Windows, passive) → app reopens
```

- **Staff choose when.** It never restarts on its own in the middle of a
  patient. "ภายหลัง" hides the card until the next check, a few hours later.
- **Signed.** The app only installs a file signed with our private key, so
  nobody can push a fake update by tampering with the download.
- **Two channels.** The queue and full editions read different files, so a
  full-edition PC can never "update" into the queue edition.
- **Rollback.** Point `<edition>/latest.json` in the releases repo back at
  the previous version's `latest.json` (each release keeps its own). PCs that
  haven't updated stay where they are. PCs that already updated need the old
  installer run by hand: an updater never goes backwards.
- **Why a second, public repository.** The code repository is private, and
  the PCs can't download from a private one without a token, which would
  then live on every PC. The installer holds no secrets (no PIN, no keys,
  only the server address), so publishing only installers is safe.

## One-time setup (the owner, about 15 minutes)

1. **Create the releases repository** (public, with a README so it has a
   `main` branch):
   ```bash
   gh repo create CHAYUT-P/DentaKids-releases --public --add-readme -d "Denta Kids Staff installers"
   ```
2. **Make the signing key** on your own computer. It asks for a password:
   choose one and keep it.
   ```bash
   cd apps/staff-desktop && npx tauri signer generate -w ~/.tauri/dentakids-updater.key
   ```
   **Back up `~/.tauri/dentakids-updater.key` and the password** (a password
   manager, or a USB stick kept at home). If they are lost, PCs can't accept
   updates any more, and every PC needs a manual reinstall with a new key.
3. **Put the public key in the app.** The contents of
   `~/.tauri/dentakids-updater.key.pub` go into
   `apps/staff-desktop/src-tauri/tauri.conf.json` → `plugins.updater.pubkey`
   (replacing `REPLACE_WITH_PUBLIC_KEY`), then commit. The public key is not
   a secret.
4. **Give the build its secrets** (in the private repository):
   ```bash
   gh secret set TAURI_SIGNING_PRIVATE_KEY -R CHAYUT-P/DentaKids < ~/.tauri/dentakids-updater.key
   gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD -R CHAYUT-P/DentaKids
   ```
5. **A token that lets the build publish into the releases repository:**
   GitHub → Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token.
   - Repository access: *Only select repositories* → `DentaKids-releases`.
   - Permissions: *Contents: Read and write*.
   - Expiry: up to a year. **Put the expiry date in your calendar.** When the
     token expires, new builds can't publish (the PCs keep working).

   Then store it:
   ```bash
   gh secret set RELEASES_TOKEN -R CHAYUT-P/DentaKids
   ```

After that, run the first build and install it **by hand** on each PC, from
DentaKids-releases → Releases. That's the last manual install.

## Releasing an update

```bash
gh workflow run staff-app-windows.yml -f edition=queue -f notes="แก้ปุ่มเช็คอินกดไม่ติด"
```

Or use GitHub → Actions → *Staff app (Windows)* → Run workflow. It takes about
8 minutes. PCs offer the update the next time they open, or within 3 hours.

**Rule:** the server updates the moment it's deployed, but PCs update when
staff tap. A new server must keep working with the previous app version for a
while. Add fields; don't rename or remove what an older app still sends or
reads (see `withDefaults` in `src/lib/staffStore.tsx`).
