# Async IDE macOS Auto-Update Test Guide (Mac Mini)

Use this guide to build and test Async IDE's macOS auto-update and differential update features on the Mac mini (`192.168.1.201`).

## Important Note: No Code Signing

Async IDE is **not code-signed** on macOS. This means:
- **Auto-install does not work** on macOS — `electron-updater` cannot replace an unsigned app bundle because macOS Gatekeeper / Squirrel.Mac rejects it.
- **Workaround**: When an update is detected on macOS, the app automatically downloads the new ZIP to `~/Downloads/` and shows a toast prompting the user to **install manually**.
- Windows builds are unaffected and can auto-install as before.

## Environment

| Item | Value |
|------|-------|
| Host | Mac mini (Apple Silicon) |
| IP | `192.168.1.201` |
| SSH User | `licl` |
| Local project (Windows) | `D:\WebstormProjects\Async` |
| Remote project | `~/Async` |

## Prerequisites on Mac Mini

Ensure the Mac mini has the following installed:

```bash
# Check Node.js (requires v20+)
node -v

# Check npm
npm -v

# Check git
git --version
```

If Node.js is missing, install it via [nvm](https://github.com/nvm-sh/nvm):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.zshrc
nvm install 20
nvm use 20
```

## Deploy Source to Mac Mini

### Option A: Clone from GitHub (recommended for CI-aligned tests)

```bash
ssh licl@192.168.1.201

cd ~
git clone https://github.com/ZYKJShadow/Async.git Async
cd Async
git checkout feat/macos-auto-update-support
```

### Option B: Copy from local Windows machine

```powershell
# From Windows PowerShell
cd D:\WebstormProjects\Async

# Exclude node_modules and build artifacts
tar -czf async-mac-test.tgz --exclude=node_modules --exclude=release --exclude=dist --exclude=.git .

# Upload to Mac mini
scp async-mac-test.tgz licl@192.168.1.201:/Users/licl/

# Extract on Mac mini
ssh licl@192.168.1.201 "mkdir -p ~/Async && tar -xzf ~/async-mac-test.tgz -C ~/Async && rm -f ~/async-mac-test.tgz"
```

## Build on Mac Mini

SSH into the Mac mini and build:

```bash
ssh licl@192.168.1.201

cd ~/Async

# Install dependencies
npm install

# Build main + renderer
npm run build

# Generate icons (requires macOS-native tools, runs fine on Mac mini)
npm run icons

# Rebuild native modules for Electron
npm run rebuild:native
```

## Build Packages (Unsigned)

```bash
cd ~/Async
npm run release:mac:unsigned
```

Output:
- `release/Async-IDE-0.0.28-x64.dmg`
- `release/Async-IDE-0.0.28-x64.zip`
- `release/Async-IDE-0.0.28-arm64.dmg`
- `release/Async-IDE-0.0.28-arm64.zip`
- `release/latest-mac.yml`
- `release/*.blockmap`  (differential-update metadata)

> No Apple Developer certificate is required. The build is intentionally unsigned.

## Install and Prepare for Testing

### Install the unsigned build

```bash
# Unzip and run directly
unzip -q ~/Async/release/Async-IDE-0.0.28-arm64.zip -d ~/Async-Test
```

### Bypass Gatekeeper for unsigned testing

```bash
# Remove the quarantine attribute so the app can launch
xattr -cr ~/Async-Test/Async\ IDE.app
```

> On first launch, macOS may still show a warning. Go to **System Settings -> Privacy & Security** and click **"Open Anyway"**.

### Enable dev mode for testing

```bash
# Open the app from Terminal to see console logs
~/Async-Test/Async\ IDE.app/Contents/MacOS/Async\ IDE
```

## Test Auto-Update Flow

### Step 1: Verify current version

Open the app and check the version:
- Menu: **Async IDE -> About Async IDE**
- Or look at `package.json` version field (e.g., `0.0.28`)

### Step 2: Simulate a newer version

Because the app is unsigned, the real GitHub auto-update cannot install automatically on macOS. Instead, the app downloads the update and prompts the user to install manually.

To test this flow locally:

#### Method A: Local fake update server (fastest)

On the Mac mini:

```bash
mkdir -p ~/fake-update-server
cd ~/fake-update-server

# Copy the real artifacts and bump the version in latest-mac.yml
cp ~/Async/release/latest-mac.yml ./
cp ~/Async/release/Async-IDE-0.0.28-arm64.zip ./Async-IDE-0.0.29-arm64.zip

# Edit latest-mac.yml:
# 1. Change version to "0.0.29"
# 2. Change path to "Async-IDE-0.0.29-arm64.zip"
# 3. Keep the same sha512 (since we copied the same file)
# 4. Keep blockMapSize unchanged
```

Start a local HTTP server:

```bash
cd ~/fake-update-server
python3 -m http.server 9999
```

Temporarily modify `main-src/autoUpdate.ts` to point to the local server (for testing only):

```ts
// In main-src/autoUpdate.ts, inside configureUpdater():
autoUpdater.setFeedURL({
  provider: 'generic',
  url: 'http://localhost:9999',
});
```

Rebuild main process and relaunch:

```bash
cd ~/Async
npm run build:main
~/Async-Test/Async\ IDE.app/Contents/MacOS/Async\ IDE
```

#### Method B: GitHub prerelease

1. Bump version to `0.0.29` in `package.json`.
2. Build macOS packages on the Mac mini.
3. Push a tag `v0.0.29-test`.
4. Create a GitHub **prerelease** and upload the macOS artifacts.
5. Launch the old version (`0.0.28`) and trigger **Help -> Check for Updates**.

### Step 3: Observe the update behavior

In the running app:

1. Open **Help -> Check for Updates** (or wait 30s for auto-check).
2. The app detects the "new" version (`0.0.29`).
3. It downloads the ZIP automatically.
4. A toast appears at the **bottom-left corner of the window** with the message:
   - **macOS unsigned**: "更新已下载到下载文件夹，请手动安装" + **"打开下载文件夹"** button
   - **Windows / signed macOS**: "更新已就绪，重启即可应用" + **"立即重启"** button
5. Click **"打开下载文件夹"**.
6. Finder opens `~/Downloads/` showing `Async-IDE-0.0.29-mac-update.zip`.
7. Manually unzip and replace the old app:
   ```bash
   unzip -q ~/Downloads/Async-IDE-0.0.29-mac-update.zip -d ~/Async-Test-New
   xattr -cr ~/Async-Test-New/Async\ IDE.app
   ```

### Step 4: Verify differential update metadata

Confirm `.blockmap` files exist after build:

```bash
ls -la ~/Async/release/*.blockmap
```

Expected output:
```
Async-IDE-0.0.28-x64.zip.blockmap
Async-IDE-0.0.28-arm64.zip.blockmap
```

Verify `latest-mac.yml` contains `blockMapSize`:

```bash
cat ~/Async/release/latest-mac.yml | grep blockMapSize
```

If present, `electron-updater` will use differential update on Windows and will attempt it on macOS (even though the final install step is manual on unsigned macOS).

## macOS vs Windows Behavior Summary

| Platform | Signed? | Auto-Download | Auto-Install | Toast Action |
|----------|---------|---------------|--------------|--------------|
| Windows  | N/A (NSIS) | Yes | Yes | "Restart Now" -> quits and installs |
| macOS    | No | Yes | **No** | "Open Downloads" -> opens `~/Downloads/` |
| macOS    | Yes (future) | Yes | Yes | "Restart Now" -> quits and installs |

## Troubleshooting

### "App is damaged and can't be opened"

This is Gatekeeper. For unsigned testing:

```bash
xattr -cr ~/Async-Test/Async\ IDE.app
```

### Auto-update shows an error in console

Check logs:

```bash
cat ~/Library/Logs/Async\ IDE/main.log
tail -f ~/Library/Logs/Async\ IDE/main.log
```

Common causes:
- Feed URL unreachable -> check network / proxy
- `latest-mac.yml` version not higher than current -> updater ignores same/lower versions
- Downloaded ZIP is quarantined -> this is expected on macOS; the app copies it to Downloads for manual installation

### No `.blockmap` files in release/

Rebuild with the unsigned script:

```bash
npm run release:mac:unsigned
```

`electron-builder` generates `.blockmap` automatically for ZIP targets.

## Quick Test Checklist

| # | Test Step | Expected Result |
|---|-----------|-----------------|
| 1 | Build unsigned on Mac mini | `release/*.dmg`, `*.zip`, `*.blockmap` created |
| 2 | App launches after `xattr -cr` | Main window opens |
| 3 | Check for updates (no new version) | Settings panel shows "You are up to date" |
| 4 | Simulate new version | Toast appears at bottom-left |
| 5 | macOS unsigned toast text | "更新已下载到下载文件夹，请手动安装" |
| 6 | Click "打开下载文件夹" | Finder opens `~/Downloads/` with the ZIP |
| 7 | Check `.blockmap` files exist | Differential update metadata present in `release/` |
| 8 | Check `latest-mac.yml` | Contains `blockMapSize` field for each zip target |
