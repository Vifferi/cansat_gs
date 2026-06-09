$libPath = 'C:\Users\User\Documents\Arduino\libraries'
if (-not (Test-Path $libPath)) {
    New-Item -ItemType Directory -Path $libPath | Out-Null
}

$libs = @(
    @{ Name = 'Adafruit_BME280_Library'; Url = 'https://github.com/adafruit/Adafruit_BME280_Library/archive/refs/heads/main.zip' }
)

foreach ($lib in $libs) {
    $zipPath = Join-Path $env:TEMP "$($lib.Name).zip"
    Write-Host "Downloading $($lib.Name)..."
    Invoke-WebRequest -Uri $lib.Url -OutFile $zipPath -UseBasicParsing
    Write-Host "Extracting $($lib.Name)..."
    Expand-Archive -Path $zipPath -DestinationPath $env:TEMP -Force
    $extracted = Join-Path $env:TEMP "$($lib.Name)-main"
    $dest = Join-Path $libPath $lib.Name
    if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
    Move-Item -Path $extracted -Destination $dest
    Remove-Item -Path $zipPath -Force
    Write-Host "Installed $($lib.Name) to $dest"
}
Write-Host 'Done.'
