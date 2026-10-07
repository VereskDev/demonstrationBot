' Hidden launcher for the Windows scheduled task "AssistantBot" (runs at logon).
' start-bot.cmd holds the restart loop; log goes to data\bot.out.log.
' Stop: schtasks /End /TN AssistantBot, then kill node.exe running src\main.ts.
Dim sh, dir
Set sh = CreateObject("WScript.Shell")
dir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\") - 1)
sh.CurrentDirectory = dir
sh.Run "cmd /c """ & dir & "\start-bot.cmd""", 0, False
