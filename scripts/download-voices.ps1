param(
  [string]$PiperVersion = "2023.11.14-2",
  [string]$InstallDir = ".\bin",
  [string]$ModelsDir = ".\models\piper"
)

$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path $ModelsDir | Out-Null

$PiperZip = Join-Path $env:TEMP "piper_windows_amd64.zip"
$PiperExe = Join-Path $InstallDir "piper\piper.exe"

if (-Not (Test-Path $PiperExe)) {
  Write-Host "Downloading Piper for Windows ($PiperVersion)..."
  $Url = "https://github.com/rhasspy/piper/releases/download/$PiperVersion/piper_windows_amd64.zip"
  Invoke-WebRequest -Uri $Url -OutFile $PiperZip
  Expand-Archive -Path $PiperZip -DestinationPath $InstallDir -Force
  Remove-Item $PiperZip -Force
  Write-Host "Piper installed at $PiperExe"
} else {
  Write-Host "Piper already exists at $PiperExe"
}

$HfBase = "https://huggingface.co/rhasspy/piper-voices/resolve/main"

$Models = @(
  @{ Path = "en/en_US/lessac/medium"; Id = "en_US-lessac-medium" },
  @{ Path = "en/en_US/amy/medium"; Id = "en_US-amy-medium" },
  @{ Path = "en/en_US/ryan/medium"; Id = "en_US-ryan-medium" },
  @{ Path = "en/en_GB/alan/medium"; Id = "en_GB-alan-medium" },
  @{ Path = "en/en_GB/alba/medium"; Id = "en_GB-alba-medium" },
  @{ Path = "es/es_ES/davefx/medium"; Id = "es_ES-davefx-medium" },
  @{ Path = "fr/fr_FR/siwis/medium"; Id = "fr_FR-siwis-medium" },
  @{ Path = "de/de_DE/thorsten/medium"; Id = "de_DE-thorsten-medium" },
  @{ Path = "it/it_IT/paola/medium"; Id = "it_IT-paola-medium" },
  @{ Path = "pt/pt_BR/faber/medium"; Id = "pt_BR-faber-medium" }
)

foreach ($Model in $Models) {
  $OnnxFile = Join-Path $ModelsDir "$($Model.Id).onnx"
  $JsonFile = Join-Path $ModelsDir "$($Model.Id).onnx.json"

  if (-Not (Test-Path $OnnxFile)) {
    Write-Host "Downloading $($Model.Id).onnx..."
    Invoke-WebRequest -Uri "$HfBase/$($Model.Path)/$($Model.Id).onnx" -OutFile $OnnxFile
  }
  if (-Not (Test-Path $JsonFile)) {
    Write-Host "Downloading $($Model.Id).onnx.json..."
    Invoke-WebRequest -Uri "$HfBase/$($Model.Path)/$($Model.Id).onnx.json" -OutFile $JsonFile
  }
}

Write-Host "All Piper voice models downloaded to $ModelsDir"
