!macro customUnInstall
  DetailPrint "Stopping WhatsApp Agent local PostgreSQL service..."
  nsExec::ExecToLog 'sc stop WhatsAppAgentPostgres'
  nsExec::ExecToLog 'sc delete WhatsAppAgentPostgres'

  DetailPrint "Removing WhatsApp Agent local data..."
  RMDir /r "$APPDATA\whatsapp-agent-desktop"
!macroend
