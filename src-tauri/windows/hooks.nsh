!macro NSIS_HOOK_POSTINSTALL
  ; Upgrades from the initial public build must remove retired feedback cues.
  Delete "$INSTDIR\resources\marimba_start.wav"
  Delete "$INSTDIR\resources\marimba_stop.wav"
  Delete "$INSTDIR\resources\pop_start.wav"
  Delete "$INSTDIR\resources\pop_stop.wav"
  Delete "$INSTDIR\resources\themes\pirate-scribe\sounds\start.wav"
  Delete "$INSTDIR\resources\themes\pirate-scribe\sounds\stop.wav"
  RMDir "$INSTDIR\resources\themes\pirate-scribe\sounds"
  ; Same-version upgrades can leave retired bundled displays on disk because
  ; NSIS replaces current resources without pruning removed directories.
  RMDir /r "$INSTDIR\resources\themes\neon-codex"
  RMDir /r "$INSTDIR\resources\themes\signal-garden"
  RMDir /r "$INSTDIR\resources\themes\stellar-murmuration"
!macroend
