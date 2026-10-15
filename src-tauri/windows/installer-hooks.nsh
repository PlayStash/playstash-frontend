; PlayStash NSIS installer hooks (tauri.conf.json: bundle.windows.nsis.installerHooks).
;
; Included by Tauri's installer template right after its includes, before its
; own defines and variables. Everything that needs ${VERSION}, ${UNINSTKEY},
; $PassiveMode or $UpdateMode therefore lives in macros, which expand where the
; template inserts them.
;
; 1. Existing installation (interactive installs only; the in-app updater runs
;    this installer with /P /UPDATE and is never asked):
;    - older version installed: "PlayStash X is installed. Update to Y?"
;      Yes re-runs this installer as an in-place update (/P /UPDATE /R, the
;      mode the in-app updater uses): program files are replaced, settings,
;      profiles and games are kept, PlayStash starts again afterwards.
;      No shows Tauri's page with all options.
;    - same version: Tauri's maintenance page (Add/Reinstall = repair, or
;      Uninstall).
;    - newer version installed: a downgrade warning first; OK continues to
;      Tauri's page (uninstall the newer version first or install over it),
;      Cancel exits.
; 2. Previous PlayStash client for Windows (WPF, Inno Setup): offered for
;    uninstallation before the files are installed. Its data in
;    %APPDATA%\PlayStash stays for the import in the new app.

; nsis_tauri_utils (SemverCompare) lives in Tauri's additional plugin folder,
; which the template only adds after this file.
!if /FileExists "${NSISDIR}\Plugins\x86-unicode\additional\nsis_tauri_utils.dll"
  !addplugindir "${NSISDIR}\Plugins\x86-unicode\additional"
!endif

!define PLAYSTASH_LEGACY_UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\{4564A78E-4F52-4755-987C-36AC625CF5A0}_is1"
!define PLAYSTASH_RUNKEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define PLAYSTASH_LANG_GERMAN 1031

; The existing-installation check runs in .onInit, right after Tauri's
; SetContext (shell context and registry view), so ${UNINSTKEY} is read from
; the same place Tauri's reinstall page reads it. SetContext is also used by
; the uninstaller, which must stay untouched.
!macroundef SetContext
!macro SetContext
  !if "${INSTALLMODE}" == "currentUser"
    SetShellVarContext current
  !else if "${INSTALLMODE}" == "perMachine"
    SetShellVarContext all
  !endif

  ${If} ${RunningX64}
    !if "${ARCH}" == "x64"
      SetRegView 64
    !else if "${ARCH}" == "arm64"
      SetRegView 64
    !else
      SetRegView 32
    !endif
  ${EndIf}

  !ifndef __UNINSTALL__
    !insertmacro PLAYSTASH_EXISTING_INSTALL_PROMPT
  !endif
!macroend

!macro PLAYSTASH_EXISTING_INSTALL_PROMPT
  Push $0
  Push $1
  Push $2
  Push $3
  ClearErrors
  ${GetOptions} $CMDLINE "/P" $0
  ${If} ${Errors}
  ${AndIfNot} ${Silent}
    ClearErrors
    ${GetOptions} $CMDLINE "/UPDATE" $0
    ${If} ${Errors}
      ReadRegStr $1 SHCTX "${UNINSTKEY}" "DisplayVersion"
      ReadRegStr $2 SHCTX "${UNINSTKEY}" "UninstallString"
      ${If} $1 != ""
      ${AndIf} $2 != ""
        nsis_tauri_utils::SemverCompare "${VERSION}" $1
        Pop $0
        ${If} $0 = 1
          ${If} $LANGUAGE = ${PLAYSTASH_LANG_GERMAN}
            StrCpy $3 "PlayStash $1 ist auf diesem Computer installiert.$\r$\n$\r$\nAuf Version ${VERSION} aktualisieren? Deine Einstellungen, Profile und installierten Spiele bleiben erhalten.$\r$\n$\r$\nWähle $\"Nein$\", um alle Installationsoptionen zu sehen."
          ${Else}
            StrCpy $3 "PlayStash $1 is installed on this computer.$\r$\n$\r$\nUpdate it to version ${VERSION}? Your settings, profiles and installed games are kept.$\r$\n$\r$\nChoose $\"No$\" to see all installation options."
          ${EndIf}
          ${If} ${Cmd} `MessageBox MB_YESNO|MB_ICONQUESTION "$3" IDYES`
            ; In-place update exactly like the in-app updater, then restart.
            Exec '"$EXEPATH" /P /UPDATE /R'
            Quit
          ${EndIf}
        ${ElseIf} $0 = -1
          ${If} $LANGUAGE = ${PLAYSTASH_LANG_GERMAN}
            StrCpy $3 "Eine neuere Version von PlayStash ($1) ist bereits installiert. Die ältere Version ${VERSION} zu installieren (Downgrade) wird nicht empfohlen.$\r$\n$\r$\nMit $\"OK$\" geht es weiter: Du kannst die installierte Version zuerst deinstallieren oder darüber installieren. $\"Abbrechen$\" beendet das Setup."
          ${Else}
            StrCpy $3 "A newer version of PlayStash ($1) is already installed. Installing the older version ${VERSION} (a downgrade) is not recommended.$\r$\n$\r$\nChoose $\"OK$\" to continue: you can uninstall the installed version first or install over it. $\"Cancel$\" exits the setup."
          ${EndIf}
          ${If} ${Cmd} `MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$3" IDCANCEL`
            Quit
          ${EndIf}
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}
  ClearErrors
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend

!macro NSIS_HOOK_PREINSTALL
  ; Only interactive installs ask; updates never touch the previous client.
  ${If} $PassiveMode <> 1
  ${AndIf} $UpdateMode <> 1
  ${AndIfNot} ${Silent}
    Push $0
    Push $1
    Push $2
    Push $3
    Push $4
    ; Inno Setup installs per user (HKCU); an elevated install uses HKLM.
    ReadRegStr $0 HKCU "${PLAYSTASH_LEGACY_UNINSTKEY}" "UninstallString"
    ReadRegStr $1 HKCU "${PLAYSTASH_LEGACY_UNINSTKEY}" "DisplayVersion"
    ${If} $0 == ""
      ReadRegStr $0 HKLM "${PLAYSTASH_LEGACY_UNINSTKEY}" "UninstallString"
      ReadRegStr $1 HKLM "${PLAYSTASH_LEGACY_UNINSTKEY}" "DisplayVersion"
    ${EndIf}
    ${If} $0 != ""
      ${If} $LANGUAGE = ${PLAYSTASH_LANG_GERMAN}
        StrCpy $2 "Der bisherige PlayStash-Client für Windows (Version $1) ist noch installiert. Diese Version ersetzt ihn.$\r$\n$\r$\nDen bisherigen Client jetzt deinstallieren? Seine Daten bleiben erhalten und können beim ersten Start übernommen werden."
      ${Else}
        StrCpy $2 "The previous PlayStash client for Windows (version $1) is still installed. This version replaces it.$\r$\n$\r$\nUninstall the previous client now? Its data is kept and can be imported when PlayStash starts."
      ${EndIf}
      ${If} ${Cmd} `MessageBox MB_YESNO|MB_ICONQUESTION "$2" /SD IDNO IDYES`
        ; The old uninstaller removes the "PlayStash" autostart entry, which
        ; this app may already use; keep an entry that points to this app.
        ReadRegStr $3 HKCU "${PLAYSTASH_RUNKEY}" "PlayStash"
        DetailPrint "Uninstalling the previous PlayStash client $1..."
        ClearErrors
        ExecWait '$0 /VERYSILENT /SUPPRESSMSGBOXES /NORESTART' $4
        ${If} ${Errors}
        ${OrIf} $4 <> 0
          DetailPrint "The previous PlayStash client could not be uninstalled ($4)."
        ${EndIf}
        ${If} $3 != ""
          ${StrLoc} $4 $3 "$INSTDIR" ">"
          ${If} $4 != ""
            WriteRegStr HKCU "${PLAYSTASH_RUNKEY}" "PlayStash" $3
          ${EndIf}
        ${EndIf}
      ${EndIf}
    ${EndIf}
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Pop $0
  ${EndIf}
!macroend
