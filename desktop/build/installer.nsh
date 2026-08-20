!macro customInstall
  DetailPrint "Preparing WhatsApp Agent local PostgreSQL service..."
  nsExec::ExecToLog 'sc stop WhatsAppAgentPostgres'
  nsExec::ExecToLog 'sc delete WhatsAppAgentPostgres'
  IfFileExists "$APPDATA\whatsapp-agent-desktop\postgres-data\PG_VERSION" skipPostgresInit
    CreateDirectory "$APPDATA\whatsapp-agent-desktop\postgres-data"
    nsExec::ExecToLog '"$INSTDIR\resources\runtime\postgres\bin\initdb.exe" -D "$APPDATA\whatsapp-agent-desktop\postgres-data" -U postgres -A trust -E UTF8'
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
