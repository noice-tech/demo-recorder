# Install FFmpeg

Demo Recorder requires `ffmpeg` and `ffprobe` with the `libx264` H.264 encoder. It does not bundle or automatically install them. Install FFmpeg with your platform's package manager, then open a new terminal if the command is not found.

## macOS

Using [Homebrew](https://brew.sh/):

```bash
brew install ffmpeg
```

## Windows

Using Windows Package Manager:

```powershell
winget install --id Gyan.FFmpeg --exact
```

Or, using [Chocolatey](https://chocolatey.org/):

```powershell
choco install ffmpeg
```

Close and reopen the terminal after installation so the updated `PATH` is available.

## Ubuntu and Debian

```bash
sudo apt update
sudo apt install ffmpeg
```

## Fedora

Fedora's full FFmpeg package is available through [RPM Fusion](https://rpmfusion.org/Configuration). Enable its free repository, then install FFmpeg:

```bash
sudo dnf install \
  "https://download1.rpmfusion.org/free/fedora/rpmfusion-free-release-$(rpm -E %fedora).noarch.rpm"
sudo dnf install ffmpeg --allowerasing
```

## Arch Linux

```bash
sudo pacman -S ffmpeg
```

## Verify the installation

On macOS or Linux:

```bash
ffmpeg -version
ffprobe -version
ffmpeg -hide_banner -encoders 2>/dev/null | grep libx264
```

On Windows PowerShell:

```powershell
ffmpeg -version
ffprobe -version
ffmpeg -hide_banner -encoders 2>&1 | Select-String libx264
```

The final command should show an encoder named `libx264`. Demo Recorder's `doctor` command performs a more complete check, including the required filters and workspace access.

If `ffmpeg` or `ffprobe` is still not found, restart the terminal and check that the package manager's binary directory is on `PATH`. If `libx264` is missing, the installed package is a restricted or minimal FFmpeg build; use the full package provided by one of the sources above.

FFmpeg licensing depends on how the selected package was built. See the provider's license information and [FFmpeg's legal page](https://ffmpeg.org/legal.html).
