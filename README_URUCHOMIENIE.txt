FalconBEND v3.9 | Samodzielny launcher dla Windows 10/11 (64-bit)
====================================================================

NAPRAWIONY BLAD: "brak package.json"

1. Uruchom FalconBEND.exe (mozesz go skopiowac na Pulpit).
   Nie musisz kopiowac obok package.json ani folderow src/ i public/.
2. Pierwszy start: musisz miec Node.js (z npm) i dostep do internetu.
   Aplikacja sama wypakuje kod do folderu uzytkownika, zainstaluje
   zaleznosci i zbuduje wersje lokalna. W przegladarce widac postep.
3. Kolejne starty: dwuklik FalconBEND.exe, bez konsoli i bez internetu.

Program zapisuje wbudowane zrodla i wynik budowania w lokalnym folderze
uzytkownika, zwykle:
%LOCALAPPDATA%\FalconBEND\versions\<wersja>

Aplikacja otworzy sie w przegladarce pod adresem 127.0.0.1:45971.
Zamknij_FalconBEND.vbs konczy lokalny serwer (w tym samym folderze co EXE).

Jesli uruchomisz EXE z kompletnymi zrodlami obok, program moze korzystac
z plikow projektu w tym folderze; w przeciwnym razie uzywa zrodel wbudowanych.
Nie trzeba nigdy wydawac recznie "npm run dev".

Brak Node.js lub npm:
  https://nodejs.org/  -> zainstaluj Node.js LTS, a potem uruchom EXE.
Brak internetu przy pierwszym starcie: instalacja npm nie uda sie; sprobuj
po polaczeniu z internetem. Nastepne uruchomienia beda offline.

OSTRZEZENIE SMARTSCREEN:
  Launcher EXE nie jest podpisany certyfikatem zaufanego wydawcy, dlatego
  Windows moze wciaz ostrzegac. Nie wylaczaj ochrony SmartScreen.

WAZNE: to symulator z przyblizonymi modelami narzedzi. Wynik "bez kolizji"
nie jest gwarancja bezpieczenstwa rzeczywistej prasy krawedziowej.
