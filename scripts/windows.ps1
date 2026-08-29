param(
    [ValidateSet("dev", "build", "check", "test", "doctor")]
    [string]$Action = "dev"
)

$ErrorActionPreference = "Stop"

$localDictateVsDevCmd = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat"
$localDictateToolsRoot = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "LocalDictate\tools"
$localDictateCmakeBin = Join-Path $localDictateToolsRoot "cmake-4.4.3-windows-x86_64\bin"
$localDictateVulkanSdk = Join-Path $localDictateToolsRoot "VulkanSDK\1.4.357.0"
$localDictateCargoBin = Join-Path ([Environment]::GetFolderPath("UserProfile")) ".cargo\bin"
$localDictateVsInstaller = "C:\Program Files (x86)\Microsoft Visual Studio\Installer"

foreach ($localDictateRequiredPath in @(
    $localDictateVsDevCmd,
    $localDictateCmakeBin,
    $localDictateVulkanSdk,
    $localDictateCargoBin,
    $localDictateVsInstaller
)) {
    if (-not (Test-Path -LiteralPath $localDictateRequiredPath)) {
        throw "Required Windows build dependency was not found: $localDictateRequiredPath"
    }
}

# Import the x64 MSVC environment into this PowerShell process.
$env:Path = "$localDictateVsInstaller;$env:Path"
$localDictateEnvironmentLines = & cmd.exe /d /s /c "`"$localDictateVsDevCmd`" -arch=x64 -host_arch=x64 >nul && set"
if ($LASTEXITCODE -ne 0) {
    throw "Visual Studio Build Tools environment setup failed."
}

foreach ($localDictateEnvironmentLine in $localDictateEnvironmentLines) {
    if ($localDictateEnvironmentLine -match "^([^=]+)=(.*)$") {
        Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2]
    }
}

$env:VULKAN_SDK = $localDictateVulkanSdk
$env:Path = "$localDictateCargoBin;$localDictateCmakeBin;$localDictateVulkanSdk\Bin;$env:Path"
# transcribe.cpp contains UTF-8 source comments; MSVC otherwise parses the
# files using this Windows installation's legacy active code page.
$env:CL = "/utf-8 $env:CL".Trim()

# link.exe becomes extremely slow and memory hungry for the combined Tauri and
# local-ASR test binary. Rust ships an MSVC-compatible LLVM linker that reuses
# the same build artifacts while linking this application much more efficiently.
$localDictateRustSysroot = (& rustc --print sysroot).Trim()
$localDictateRustLld = Join-Path $localDictateRustSysroot "lib\rustlib\x86_64-pc-windows-msvc\bin\rust-lld.exe"
if (-not (Test-Path -LiteralPath $localDictateRustLld)) {
    throw "Rust's bundled LLVM linker was not found: $localDictateRustLld"
}
$env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER = $localDictateRustLld

function Get-LocalDictateWorkspaceDevProcess {
    $localDictateDevExecutable = [System.IO.Path]::GetFullPath((
        Join-Path $PSScriptRoot "..\src-tauri\target\debug\localdictate.exe"
    ))
    Get-Process -Name "localdictate" -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Path -and [string]::Equals(
                [System.IO.Path]::GetFullPath($_.Path),
                $localDictateDevExecutable,
                [System.StringComparison]::OrdinalIgnoreCase
            )
        }
}

function Test-LocalDictateCommandTargetsPath {
    param(
        [string]$Command,
        [string]$TargetPath
    )

    if (-not $Command -or -not $TargetPath) {
        return $false
    }

    $localDictateNormalizedTarget = [System.IO.Path]::GetFullPath($TargetPath)
    $localDictateCandidates = @(
        $localDictateNormalizedTarget,
        ('"' + $localDictateNormalizedTarget + '"')
    )
    $localDictateTrimmedCommand = $Command.Trim()

    foreach ($localDictateCandidate in $localDictateCandidates) {
        if ($localDictateTrimmedCommand.StartsWith($localDictateCandidate, [System.StringComparison]::OrdinalIgnoreCase)) {
            $localDictateRemainder = $localDictateTrimmedCommand.Substring($localDictateCandidate.Length)
            if (-not $localDictateRemainder -or [char]::IsWhiteSpace($localDictateRemainder[0])) {
                return $true
            }
        }
    }

    return $false
}

function Get-LocalDictateUnsafePersistentLaunch {
    $localDictateDevExecutable = [System.IO.Path]::GetFullPath((
        Join-Path $PSScriptRoot "..\src-tauri\target\debug\localdictate.exe"
    ))
    $localDictateShortcutRoots = @(
        (Join-Path ([Environment]::GetFolderPath("ApplicationData")) "Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"),
        [Environment]::GetFolderPath("Startup"),
        [Environment]::GetFolderPath("CommonStartup"),
        [Environment]::GetFolderPath("Desktop"),
        [Environment]::GetFolderPath("CommonDesktopDirectory"),
        (Join-Path ([Environment]::GetFolderPath("ApplicationData")) "Microsoft\Windows\Start Menu"),
        (Join-Path ([Environment]::GetFolderPath("CommonApplicationData")) "Microsoft\Windows\Start Menu")
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique
    $localDictateShell = New-Object -ComObject WScript.Shell

    foreach ($localDictateShortcutRoot in $localDictateShortcutRoots) {
        Get-ChildItem -LiteralPath $localDictateShortcutRoot -Filter "*.lnk" -File -Recurse -Force -ErrorAction SilentlyContinue |
            ForEach-Object {
                $localDictateShortcut = $localDictateShell.CreateShortcut($_.FullName)
                if (Test-LocalDictateCommandTargetsPath -Command $localDictateShortcut.TargetPath -TargetPath $localDictateDevExecutable) {
                    [pscustomobject]@{
                        Kind = "Shortcut"
                        Location = $_.FullName
                        Command = $localDictateShortcut.TargetPath
                    }
                }
            }
    }

    foreach ($localDictateRunKeyPath in @(
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run",
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce",
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run",
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\RunOnce"
    )) {
        if (-not (Test-Path -LiteralPath $localDictateRunKeyPath)) {
            continue
        }

        $localDictateRunKey = Get-ItemProperty -LiteralPath $localDictateRunKeyPath
        foreach ($localDictateProperty in $localDictateRunKey.PSObject.Properties | Where-Object { $_.Name -notmatch "^PS" }) {
            if (Test-LocalDictateCommandTargetsPath -Command ([string]$localDictateProperty.Value) -TargetPath $localDictateDevExecutable) {
                [pscustomobject]@{
                    Kind = "Registry"
                    Location = "$localDictateRunKeyPath\$($localDictateProperty.Name)"
                    Command = [string]$localDictateProperty.Value
                }
            }
        }
    }
}

function Assert-NoLocalDictateUnsafePersistentLaunch {
    $localDictateUnsafeLaunches = @(Get-LocalDictateUnsafePersistentLaunch)
    if ($localDictateUnsafeLaunches.Count -eq 0) {
        return
    }

    $localDictateDetails = $localDictateUnsafeLaunches |
        ForEach-Object { "[$($_.Kind)] $($_.Location) -> $($_.Command)" }
    throw "Unsafe LocalDictate persistence targets the server-dependent development executable:`n$($localDictateDetails -join "`n")`nInstall and pin the release build instead."
}

function Get-LocalDictateWorkspaceViteListener {
    $localDictateWorkspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
    $localDictateViteRoot = Join-Path $localDictateWorkspaceRoot "node_modules\vite"
    $localDictatePortOwners = Get-NetTCPConnection -State Listen -LocalPort 1420 -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique

    foreach ($localDictatePortOwner in $localDictatePortOwners) {
        $localDictateOwner = Get-CimInstance Win32_Process -Filter "ProcessId = $localDictatePortOwner" -ErrorAction SilentlyContinue
        if ($localDictateOwner.CommandLine -and
            $localDictateOwner.CommandLine.IndexOf($localDictateWorkspaceRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            $localDictateOwner.CommandLine.IndexOf($localDictateViteRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
            $localDictateOwner
        }
    }
}

function Clear-LocalDictateWorkspaceDevSession {
    param([switch]$Preflight)

    $localDictateDevProcesses = @(Get-LocalDictateWorkspaceDevProcess)
    $localDictateWorkspaceListeners = @(Get-LocalDictateWorkspaceViteListener)
    $localDictateAllListenerIds = @(Get-NetTCPConnection -State Listen -LocalPort 1420 -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique)
    $localDictateWorkspaceListenerIds = @($localDictateWorkspaceListeners | Select-Object -ExpandProperty ProcessId)
    $localDictateForeignListenerIds = @($localDictateAllListenerIds | Where-Object {
        $_ -notin $localDictateWorkspaceListenerIds
    })

    if ($localDictateForeignListenerIds.Count -gt 0) {
        throw "Port 1420 is owned by a non-LocalDictate process: $($localDictateForeignListenerIds -join ', ')"
    }

    if ($Preflight -and $localDictateDevProcesses.Count -gt 0 -and $localDictateWorkspaceListeners.Count -gt 0) {
        throw "A healthy LocalDictate dev session is already running. Stop its owning scripts/windows.ps1 dev command before starting another."
    }

    foreach ($localDictateDevProcess in $localDictateDevProcesses) {
        Stop-Process -Id $localDictateDevProcess.Id -ErrorAction Stop
    }

    foreach ($localDictateWorkspaceListener in $localDictateWorkspaceListeners) {
        Stop-Process -Id $localDictateWorkspaceListener.ProcessId -ErrorAction SilentlyContinue
    }
}

switch ($Action) {
    "dev" {
        # A dev binary without its Vite owner renders WebView2's Edge error page.
        # Reject persistent launchers before they can outlive the Vite owner,
        # then clear an orphan before launch and whenever the owner exits.
        Assert-NoLocalDictateUnsafePersistentLaunch
        Clear-LocalDictateWorkspaceDevSession -Preflight
        try {
            & bun tauri dev
        } finally {
            Clear-LocalDictateWorkspaceDevSession
        }
    }
    "build" {
        # Daily use must come from a release installer. A debug no-bundle build
        # shares target\debug with `tauri dev` and can be silently overwritten
        # by a localhost-only executable.
        # Tauri stages resources under target\release without pruning files
        # removed from the source tree. Recreate that exact staging directory so
        # retired assets cannot leak into a later installer.
        $localDictateWorkspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
        $localDictateReleaseRoot = [System.IO.Path]::GetFullPath((
            Join-Path $localDictateWorkspaceRoot "src-tauri\target\release"
        ))
        $localDictateStagedResources = [System.IO.Path]::GetFullPath((
            Join-Path $localDictateReleaseRoot "resources"
        ))
        $localDictateExpectedPrefix = $localDictateReleaseRoot.TrimEnd('\') + '\'
        if (-not $localDictateStagedResources.StartsWith(
            $localDictateExpectedPrefix,
            [System.StringComparison]::OrdinalIgnoreCase
        )) {
            throw "Refusing to clean a release resource path outside target\release: $localDictateStagedResources"
        }
        if (Test-Path -LiteralPath $localDictateStagedResources) {
            Remove-Item -LiteralPath $localDictateStagedResources -Recurse -Force
        }
        & bun tauri build --bundles nsis
    }
    "check" {
        & bun run lint
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        & bun run check:translations
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        & cargo fmt --manifest-path src-tauri\Cargo.toml -- --check
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        & cargo check --manifest-path src-tauri\Cargo.toml
    }
    "test" {
        # Two jobs keep memory bounded while still making useful progress on
        # a workstation that is also running normal development services.
        & cargo test --manifest-path src-tauri\Cargo.toml --lib --jobs 2
    }
    "doctor" {
        Assert-NoLocalDictateUnsafePersistentLaunch
        Write-Host "LocalDictate persistence audit passed: no shortcut or Run entry targets target\debug."
    }
}

exit $LASTEXITCODE
