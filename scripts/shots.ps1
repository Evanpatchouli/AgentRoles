$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$shots = @(
  @{ name = 'agents'; view = 'agents'; tab = 'chat' },
  @{ name = 'role'; view = 'agents'; tab = 'role' },
  @{ name = 'skills'; view = 'agents'; tab = 'skills' },
  @{ name = 'model'; view = 'agents'; tab = 'model' },
  @{ name = 'settings'; view = 'settings'; tab = 'chat' },
  @{ name = 'inbox'; view = 'inbox'; tab = 'chat' }
)
foreach ($shot in $shots) {
  $env:AGENTROLES_VIEW = $shot.view
  $env:AGENTROLES_TAB = $shot.tab
  $env:AGENTROLES_SCREENSHOT = Join-Path $root ('screenshots\' + $shot.name + '.png')
  npx electron .
  Start-Sleep -Milliseconds 700
}
