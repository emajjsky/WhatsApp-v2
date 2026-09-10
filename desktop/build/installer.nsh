!macro customCheckAppRunning
  DetailPrint "Closing previous WhatsApp Agent processes..."
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /T /IM "WhatsApp Agent.exe"'
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /T /IM "api-server.exe"'
  Sleep 1000
!macroend

!macro customInstall
  DetailPrint "Installing Microsoft Visual C++ runtime..."
  IfFileExists "$INSTDIR\resources\runtime\prerequisites\VC_redist.x64.exe" vcredistFound vcredistMissing
  vcredistFound:
    ExecWait '"$INSTDIR\resources\runtime\prerequisites\VC_redist.x64.exe" /install /quiet /norestart' $0
    IntCmp $0 0 vcredistReady
    IntCmp $0 1638 vcredistReady
    IntCmp $0 3010 vcredistReady
    MessageBox MB_ICONSTOP "Microsoft Visual C++ 运行库安装失败（退出码：$0）。请重试安装。"
    Abort
  vcredistMissing:
    MessageBox MB_ICONSTOP "安装包缺少 Microsoft Visual C++ 运行库，请重新下载安装包。"
    Abort
  vcredistReady:

  DetailPrint "Preparing WhatsApp Agent local PostgreSQL service..."
  nsExec::ExecToLog 'sc stop WhatsAppAgentPostgres'
  nsExec::ExecToLog 'sc delete WhatsAppAgentPostgres'
  IfFileExists "$APPDATA\whatsapp-agent-desktop\postgres-data\PG_VERSION" skipPostgresInit
    RMDir /r "$APPDATA\whatsapp-agent-desktop\postgres-data"
    CreateDirectory "$APPDATA\whatsapp-agent-desktop\postgres-data"
    ExecWait '"$INSTDIR\resources\runtime\postgres\bin\initdb.exe" -D "$APPDATA\whatsapp-agent-desktop\postgres-data" -U postgres -A trust -E UTF8 --locale=C' $0
    IntCmp $0 0 skipPostgresInit
    MessageBox MB_ICONSTOP "本地 PostgreSQL 初始化失败（退出码：$0）。安装已停止，请重试。"
    Abort
  skipPostgresInit:
  nsExec::ExecToLog '"$SYSDIR\icacls.exe" "$APPDATA\whatsapp-agent-desktop\postgres-data" /grant "*S-1-5-20:(OI)(CI)F" /T /C'
  nsExec::ExecToLog '"$INSTDIR\resources\runtime\postgres\bin\pg_ctl.exe" register -N WhatsAppAgentPostgres -D "$APPDATA\whatsapp-agent-desktop\postgres-data" -S auto -U "NT AUTHORITY\NetworkService" -o "-h 127.0.0.1 -p 15432"'
  nsExec::ExecToLog 'sc start WhatsAppAgentPostgres'
!macroend

!macro customUnInstall
  DetailPrint "Stopping WhatsApp Agent local PostgreSQL service..."
  nsExec::ExecToLog 'sc stop WhatsAppAgentPostgres'
  nsExec::ExecToLog 'sc delete WhatsAppAgentPostgres'
!macroend
