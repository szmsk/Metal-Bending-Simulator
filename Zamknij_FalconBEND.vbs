Option Explicit

' FalconBEND v3.9.1: niezalezne od polozenia EXE zamykanie lokalnego serwera.
' Weryfikujemy znacznik aplikacji, aby nie zatrzymac innych serwerow.
Const FIRST_PORT = 45971
Const LAST_PORT = 45979
Const MARKER_PREFIX = "FalconBEND-Local-"

Dim port, stopped
stopped = 0

For port = FIRST_PORT To LAST_PORT
    If StopFalconBEND(port) Then
        stopped = stopped + 1
    End If
Next

If stopped > 0 Then
    MsgBox "FalconBEND zostal zamkniety." & vbCrLf & _
           "Mozesz zamknac karte aplikacji w przegladarce.", _
           vbInformation, "FalconBEND"
Else
    MsgBox "FalconBEND nie jest teraz uruchomiony." & vbCrLf & _
           "Nie znaleziono lokalnego serwera aplikacji.", _
           vbInformation, "FalconBEND"
End If

Function StopFalconBEND(ByVal currentPort)
    Dim request, baseUrl, marker
    StopFalconBEND = False
    baseUrl = "http://127.0.0.1:" & CStr(currentPort)

    ' Brak aktywnego serwera to normalna sytuacja, nie blad skryptu.
    On Error Resume Next
    Set request = CreateObject("WinHttp.WinHttpRequest.5.1")
    If Err.Number <> 0 Then Exit Function
    request.SetTimeouts 300, 300, 450, 450
    request.Open "GET", baseUrl & "/__falcon_health", False
    request.Send
    If Err.Number <> 0 Then Exit Function
    If request.Status <> 200 Then Exit Function

    marker = Trim(CStr(request.ResponseText))
    If Left(marker, Len(MARKER_PREFIX)) <> MARKER_PREFIX Then Exit Function

    ' Ta sciezka wymaga specjalnego naglowka i przyjmuje tylko POST.
    Err.Clear
    request.Open "POST", baseUrl & "/__falcon_stop", False
    If Err.Number <> 0 Then Exit Function
    request.SetRequestHeader "X-FalconBEND-Action", "1"
    If Err.Number <> 0 Then Exit Function
    request.Send
    If Err.Number <> 0 Then Exit Function
    If request.Status = 204 Then StopFalconBEND = True
    Set request = Nothing
    On Error GoTo 0
End Function
