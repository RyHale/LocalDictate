!macro NSIS_HOOK_POSTINSTALL
  ; Upgrades from the initial public build must remove retired feedback cues.
  Delete "$INSTDIR\resources\marimba_start.wav"
  Delete "$INSTDIR\resources\marimba_stop.wav"
  Delete "$INSTDIR\resources\pop_start.wav"
  Delete "$INSTDIR\resources\pop_stop.wav"
  Delete "$INSTDIR\resources\themes\pirate-scribe\sounds\start.wav"
  Delete "$INSTDIR\resources\themes\pirate-scribe\sounds\stop.wav"
  RMDir "$INSTDIR\resources\themes\pirate-scribe\sounds"
!macroend
