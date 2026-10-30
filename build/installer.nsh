; Ostler's additions to electron-builder's assisted NSIS installer (P10.1).
;
; - An optional desktop shortcut, chosen on its own page after the folder page.
;   package.json sets nsis.createDesktopShortcut to false, so this file both
;   creates the shortcut and removes it on uninstall.
; - An uninstaller that keeps the person's data unless they tick "Also remove
;   my Ostler data". It removes only the folder Ostler owns under %APPDATA%,
;   never an OSTLER_USER_DATA folder somewhere else.
;
; Updates run the installer silently with --updated: neither page shows, the
; old version's uninstall keeps the desktop shortcut and every byte of data.

!include MUI2.nsh
!include nsDialogs.nsh
!include LogicLib.nsh

; BRAND.dataFolderName in src/shared/brand.ts. scripts/check-brand.cjs fails
; `npm run lint` when the two differ.
!define OSTLER_DATA_FOLDER "ostler"

; ─── Installer: the desktop shortcut ──────────────────────────────────────────

!ifndef BUILD_UNINSTALLER
  Var ostlerDesktopShortcut
  Var ostlerDesktopCheckbox

  !macro customPageAfterChangeDir
    Page custom ostlerShortcutPageShow ostlerShortcutPageLeave
  !macroend

  Function ostlerShortcutPageShow
    !insertmacro MUI_HEADER_TEXT "Shortcuts" "Choose where to find ${PRODUCT_NAME}."
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateLabel} 0 0 100% 24u "${PRODUCT_NAME} is added to the Start menu. You can also put a shortcut on your desktop."
    Pop $0
    ${NSD_CreateCheckbox} 0 30u 100% 12u "Create a desktop shortcut"
    Pop $ostlerDesktopCheckbox
    ${If} $ostlerDesktopShortcut == ""
      StrCpy $ostlerDesktopShortcut ${BST_CHECKED}
    ${EndIf}
    ${NSD_SetState} $ostlerDesktopCheckbox $ostlerDesktopShortcut
    nsDialogs::Show
  FunctionEnd

  Function ostlerShortcutPageLeave
    ${NSD_GetState} $ostlerDesktopCheckbox $ostlerDesktopShortcut
  FunctionEnd

  !macro customInstall
    ${IfNot} ${isUpdated}
    ${AndIf} $ostlerDesktopShortcut == ${BST_CHECKED}
      CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
      System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
    ${EndIf}
  !macroend
!endif

; ─── Uninstaller: keep or remove the data ─────────────────────────────────────

!ifdef BUILD_UNINSTALLER
  Var ostlerRemoveData
  Var ostlerRemoveDataCheckbox

  !macro customUnWelcomePage
    !insertmacro MUI_UNPAGE_WELCOME
    UninstPage custom un.ostlerDataPageShow un.ostlerDataPageLeave
  !macroend

  Function un.ostlerDataPageShow
    !insertmacro MUI_HEADER_TEXT "Your data" "Choose whether to keep your projects and settings."
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateLabel} 0 0 100% 36u "Your projects, tasks, Library and settings stay on this computer, so they are there if you install ${PRODUCT_NAME} again. Your project folders are never touched."
    Pop $0
    ${NSD_CreateCheckbox} 0 42u 100% 12u "Also remove my Ostler data"
    Pop $ostlerRemoveDataCheckbox
    ${NSD_SetState} $ostlerRemoveDataCheckbox ${BST_UNCHECKED}
    nsDialogs::Show
  FunctionEnd

  Function un.ostlerDataPageLeave
    ${NSD_GetState} $ostlerRemoveDataCheckbox $ostlerRemoveData
  FunctionEnd

  !macro customUnInstall
    ${IfNot} ${isUpdated}
      ; The desktop shortcut this installer made, if the person chose one.
      ${If} ${FileExists} "$oldDesktopLink"
        WinShell::UninstShortcut "$oldDesktopLink"
        Delete "$oldDesktopLink"
      ${EndIf}

      ; Only when ticked, which a silent uninstall never is. %APPDATA% of the
      ; person running the uninstaller: the folder Ostler uses when
      ; OSTLER_USER_DATA is not set.
      ${If} $ostlerRemoveData == ${BST_CHECKED}
        ReadEnvStr $0 APPDATA
        ${If} $0 != ""
        ${AndIf} ${FileExists} "$0\${OSTLER_DATA_FOLDER}\*.*"
          RMDir /r "$0\${OSTLER_DATA_FOLDER}"
        ${EndIf}
      ${EndIf}
    ${EndIf}
  !macroend
!endif
