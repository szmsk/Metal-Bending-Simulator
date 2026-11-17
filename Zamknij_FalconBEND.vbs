' Zamknij lokalny serwer FalconBEND bez okna konsoli.
Dim shell, fso, folder, polecenie
Set fso = CreateObject("Scripting.FileSystemObject")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
Set shell = CreateObject("WScript.Shell")
polecenie = Chr(34) & folder & "\FalconBEND.exe" & Chr(34) & " --stop"
shell.Run polecenie, 0, True
