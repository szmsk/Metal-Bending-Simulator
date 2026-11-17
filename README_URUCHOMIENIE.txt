FalconBEND v3.7 - wersja do uruchamiania lokalnego na Windows 10/11 (64-bit)
=========================================================================

URUCHOMIENIE:
1. ROZPAKUJ cale archiwum ZIP w normalnym folderze, np. C:\FalconBEND.
2. Kliknij dwa razy FalconBEND.exe.
3. Przy PIERWSZYM uruchomieniu potrzebujesz zainstalowanego Node.js
   (wraz z npm) i internetu. Program sam wykona npm install i npm run build.
   Na ekranie przegladarki widac postep instalacji.
4. Po instalacji symulator otwiera sie samodzielnie w przegladarce.
5. PRZY KOLEJNYCH URUCHOMIENIACH: jedynie dwa klikniecia FalconBEND.exe.
   Nie uruchamiaj konsoli, nie wpisuj npm run dev.

ZAMYKANIE:
- Zamkniecie zakladki przegladarki nie wylacza serwera w tle.
- Aby wylaczyc lokalny serwer, kliknij Zamknij_FalconBEND.vbs.

WAZNE:
- Pierwsza instalacja jest wymagana, poniewaz archiwum nie zawiera
  gotowego folderu dist ani node_modules.
- Po pomyslnym pierwszym zbudowaniu FalconBEND dziala offline.
- Zachowaj folder dist i package-lock.json.
- Po aktualizacji plikow projektu aplikacja sama ponowi budowanie.
- Aplikacja dziala pod stalych adresem http://127.0.0.1:45971/.
  Pozwala to zachowac ustawienia zapisywane w przegladarce.
- Uruchom aplikacje w Chrome lub Edge na tym samym komputerze.
- Program NIE wymaga npm run dev przy kazdym uruchomieniu.
- Silnik kolizji nadal bazuje na przyblizonych obrysach narzedzi;
  nie uzywaj wyniku jako jedynego kryterium bezpieczenstwa pracy prasy.

GDY ZOBACZYSZ BLAD PRZY PIERWSZYM URUCHOMIENIU:
- Zainstaluj Node.js LTS z https://nodejs.org/
- Sprawdz polaczenie z internetem i dostep do registry.npmjs.org
- Kliknij przycisk "Sprobuj ponownie" na stronie instalacji.
- W razie problemow skopiuj komunikat z dziennika instalacji.

STRUKTURA:
FalconBEND.exe           - aplikacja uruchamiajaca (Windows x64)
Zamknij_FalconBEND.vbs  - zamykanie aplikacji
src/, public/            - kod i zasoby symulatora
package.json             - lista zaleznosci
launcher/                - kod zrodlowy lokalnego uruchamiania w Go
dist/                    - powstaje automatycznie po pierwszej instalacji
node_modules/            - powstaje automatycznie po pierwszej instalacji
