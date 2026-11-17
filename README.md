# FalconBEND v3.7: uruchamianie na Windows bez terminala

**Najprostszy sposób:** rozpakuj całe archiwum ZIP i uruchom `FalconBEND.exe` dwuklikiem. Program otworzy się w domyślnej przeglądarce pod adresem `http://127.0.0.1:45971/`. Nie musisz wpisywać `npm run dev`.

- **Pierwsze uruchomienie:** program automatycznie wykona instalację zależności npm i produkcyjny build w tle, pokazując postęp w przeglądarce. Wymaga zainstalowanego Node.js z npm i dostępu do internetu. **Nie udało się dołączyć gotowego builda**, bo rejestr npm nie był osiągalny w środowisku tworzenia paczki.
- **Kolejne uruchomienia:** `FalconBEND.exe` otwiera gotową lokalną wersję bez npm, internetu i konsoli, dopóki źródła projektu nie zostaną zmienione.
- **Zamknięcie serwera:** kliknij `Zamknij_FalconBEND.vbs` (zamknięcie karty przeglądarki nie wyłącza serwera w tle).
- **Po aktualizacji projektu:** zamknij wcześniej uruchomiony serwer, a następnie uruchom EXE z nowego folderu. Jeśli źródła się zmieniły, program ponowi jednorazowe budowanie.
- **Bezpieczeństwo:** serwer nasłuchuje wyłącznie na `127.0.0.1`, więc nie udostępnia symulatora w sieci lokalnej. Ustawienia kamery i maszyny zapisane w przeglądarce pozostają pod tym samym portem.

Do korzystania wymagana jest przeglądarka Chrome lub Edge, Windows 10/11 x64 oraz jednorazowo Node.js LTS z npm. W razie błędu pierwszej instalacji na ekranie będą widoczne komunikaty npm i przycisk ponownej próby. Uruchamianie produkcyjne odbywa się przez wbudowany serwer Go, a nie serwer deweloperski Vite.

**Ograniczenie symulatora:** geometria narzędzi i korpusu maszyny może być przybliżona. Program nie zastępuje weryfikacji kolizji na rzeczywistych narzędziach.

---

## Dokumentacja projektu (dla programistów)

# FalconBEND v3: symulator gięcia, prasa Ermaksan

Projekt rozwijany na podstawie przesłanego archiwum SigmaBEND (React + TypeScript + Vite + Three.js).
Zakres: **ręczna kolejność gięć**, model sprężynowania i wykrywanie kolizji z bryłami 3D na Ermaksan Power-Bend Falcon 4100-175.

## Poprawka v3.6.1: instalacja zależności npm / esbuild

- W `package.json` zmieniono `esbuild` z `^0.25.0` na `^0.28.2`.
  Ta wersja spełnia wymagania Vite 8 (`^0.27.0 || ^0.28.0`) oraz `tsx 4.23.x` (`~0.28.0`).
- Usunięto nieaktualny `bun.lock`, w którym bezpośrednia zależność `esbuild`
  nadal była zablokowana na wersji 0.25.x. Projekt jest wydawany jako projekt **npm**.
- Po rozpakowaniu uruchom **raz** `npm install`, następnie `npm run dev`.
  Nie trzeba wykonywać dodatkowego `npm install -D esbuild@^0.28.0`.
- Pierwsze `npm install` utworzy `package-lock.json` dla npm. Zachowaj ten plik
  przy dalszych zmianach projektu, żeby uzyskać powtarzalne wersje zależności.
- Przy aktualizacji w istniejącym folderze, gdzie pozostało stare `node_modules`
  lub stary `package-lock.json`, wykonaj jednokrotnie `npm install` w folderze
  z nowym `package.json`. Nie kopiuj starego pliku blokady z wcześniejszych paczek.

**Kontrola poprawności:** `node --test tests/dependencyConfig.test.mjs` działa
bez instalowania pakietów, natomiast pełnego `npm install` i `npm run build`
nie udało się wykonać w środowisku przygotowania archiwum, bo niedostępny
był rejestr npm (`EAI_AGAIN`).

## Uruchomienie

Wymagany Node.js 22+, npm i dostęp do rejestru pakietów. W katalogu głównym:

```bash
npm install
npm run dev
```

Otwórz `http://localhost:3000`. Nie jest wymagany klucz API do lokalnej symulacji.

Po zainstalowaniu zależności uruchom:

```bash
npm run lint
npm test
npm run build
```

## Zmiany w v3

1. **Przycisk „Powrót” w prawym górnym rogu okna 3D.** Przywraca główny kąt kamery oraz pokazuje wybrany krok w 80% przebiegu skoku, gdy gięcie jest najbardziej widoczne. Zatrzymuje odtwarzanie. Nie resetuje kolejności ani nie usuwa danych projektu.
2. **Linie gięcia na blasze.** Dla każdej zaplanowanej linii jest rysowana widoczna przerywana linia przez szerokość detalu, także przed wykonaniem zagięcia. Aktywny bend ma inny kolor.
3. **Usunięto symulację wkładania i wyjmowania detalu 2D.** Nie jest pokazywana w interfejsie, nie jest liczona i nie trafia do raportów.
4. **Detekcja przestrzenna 3D dla brył pryzmatycznych.** Zamiast jednej płaszczyzny X/Y model bierze pod uwagę *objętości*: wielokątny przekrój X/Y i rzeczywisty zakres Z każdego obiektu. Kolizja wymaga przecięcia obu obrysów XY oraz nałożenia zakresów Z. Uwzględnia:
   - całą szerokość blachy, jej przesunięcie Z, łuki gięcia i ramiona;
   - stempel i matrycę o skończonej długości; osobne zakresy Z dla segmentów;
   - belkę górną, uchwyt stempla, obsadę i stół dolny;
   - oddzielne palce zderzaka na osi Z i ich belkę;
   - dwie boczne ramy C prasy, oddzielone w Z o rozstaw stojaków;
   - potencjalną samokolizję nieprzylegających fragmentów blachy.
5. **Ustawienia w „Narzędzia i Prasa”**: długość i pozycja narzędzi, pozycja Z detalu, rozstaw i szerokość palców. Segmenty stempla i matrycy można wpisać w formacie `startZ;koniecZ` (mm), po jednym na linię, np. `-250;0` i `0;250`.
6. **Raporty** pokazują pozycję Z wykrytego kontaktu i szacowane przenikanie. Nadal stosowane jest adaptacyjne próbkowanie przebiegu (nie ciągła gwarantowana detekcja).

## Istotne ograniczenia

To jest **3D dla brył o niezmiennym przekroju wzdłuż Z**. Jest to rzetelny geometryczny test objętości tych brył, ale **NIE jest pełnym silnikiem kolizji dla dowolnych modeli 3D**: nie importuje rzeczywistego STEP, nie uwzględnia krzywych i skośnych powierzchni o zmiennym przekroju wzdłuż długości ani ruchów manipulacyjnych w 6 osiach.

- Domyślne wymiary korpusu i narzędzi są orientacyjne. Trzeba je zastąpić pomiarami/rysunkami CAD rzeczywistej prasy i osprzętu. Nie pozwalają potwierdzić bezkolizyjności fizycznej maszyny.
- Strefa prawidłowego kontaktu technologicznego między stemplem, blachą i matrycą jest **uproszczona do lokalnej kieszeni XY**. W tej strefie świadomie nie zgłaszamy kontaktów narzędziowych jako kolizji. Konieczna jest kalibracja i weryfikacja względem geometrii narzędzi i rzeczywistego procesu.
- Penetracja mm w raporcie jest szacowana z geometrii przekroju, a nie wyliczana jako MES. Obrót detalu między gięciami jest modelowany w przekroju; nie weryfikujemy przestrzennego przełożenia części przez operatora.
- Pozostaje aproksymacja ruchu narzędzia, sprężynowania i gięcia. Próbki skoku są adaptacyjne, ale **nie dają formalnej gwarancji wykrycia każdego zderzenia pomiędzy klatkami**.
- Sam wynik „nie wykryto kolizji w modelu” nie daje zgody na uruchomienie fizycznej prasy. Przed zastosowaniem produkcyjnym wymagane są niezależna walidacja i próby zgodne z instrukcją producenta i BHP.

## Testy i weryfikacja w tym środowisku

Silnik TypeScript przechodzi kompilację w izolowanym zestawie bez zależności przeglądarkowych. Testy obejmują m.in. kontakt graniczny Z, różne pozycje narzędzi, segmentację, próbki skoku i ostrzeżenia o przeciążeniu.

Nie udało się wykonać pełnego `npm install` z powodu braku dostępnych zależności w lokalnym cache npm. Z tego względu nie twierdzimy, że kompletna aplikacja została tutaj uruchomiona w przeglądarce; należy zweryfikować `npm run lint` i `npm run build` po instalacji pakietów.

## Poprawka v3.1: Powrót do widoku gięcia

- **Powrót** ustawia bieżące gięcie na 80% skoku i kamerę blisko profilu,
  niemal prostopadle do jego przekroju (jak na zrzucie referencyjnym),
  zamiast starego szerokiego widoku izometrycznego.
- Kamera odnosi się do przedniego lica blachy (+Z), więc po naciśnięciu **Powrót** po zmianie szerokości
  arkusza kamera ustawia się przed nową powierzchnią blachy.
- **Zapisz widok** pozwala ustawić kadr myszą i zapisać go jako dokładny
  docelowy widok przycisku **Powrót**. Ustawienie zachowuje się w przeglądarce
  w `localStorage`. Jest to widok użytkownika, a nie nowa geometria gięcia.
- Przycisk kasuje także bezwładność OrbitControls, żeby kamera nie odjeżdżała
  zaraz po przywróceniu.

Nie zmieniano algorytmów wykrywania kolizji ani geometrii maszyny.


## Poprawka v3.2: kamera działa po kolizji

- **Kolizja zatrzymuje wyłącznie ruch gięcia**. Odtwarzanie zatrzymuje się na klatce wykrycia kolizji. Blacha i narzędzia zostają w miejscu do oględzin.
- **Widok 3D nadal działa**: lewy przycisk myszy obraca kamerę, prawy przesuwa widok, kółko przybliża i oddala. Kamera jest odświeżana niezależnie od stanu odtwarzania.
- **Naprawiono błąd pętli renderowania**: poprzedni kod podczas startu symulacji mógł anulować oczekującą klatkę kamery bez odblokowania kolejnych odświeżeń. Zastąpiono dwa osobne harmonogramy jednym `src/engine/frameLoop.ts` bez blokady `renderBusy`.
- Po kolizji pojawia się komunikat o pauzie. Można ręcznie cofnąć skok, zmienić krok, zresetować symulację lub przywrócić widok „Powrót”.
- Po kolejnej próbie `Symuluj`, jeśli konfiguracja wciąż prowadzi do kolizji, animacja ponownie zatrzyma się na przeszkodzie. To ograniczenie dotyczy tylko ruchu gięcia, nie kamery ani edycji parametrów.

### Testy v3.2

Dodatkowe testy `tests/frameLoop.test.ts` weryfikują rozdzielenie zatrzymania odtwarzania od możliwości odświeżania kamery, brak anulowania kolejki przez start gięcia, łączenie zmian kamery i ponowne uruchamianie bez skoku czasu. Łącznie **22/22 testy jednostkowe przeszły** w izolowanym środowisku Node po kompilacji TypeScript. Zmodyfikowany komponent TSX przeszedł kontrolę składni. Nie przeprowadzono w tym środowisku kompletnego testu przeglądarkowego/WebGL.

## Poprawka v3.3: czyste bryły korpusu i precyzyjniejsza kamera

- Usunięto pionową niebieską listwę przechodzącą przez otwartą gardziel stojaka C.
  Ozdobne listwy występują wyłącznie na górnym i dolnym ramieniu stojaka,
  lekko odsunięte od powierzchni, bez migotania współpłaszczyznowych ścian.
- Stół dolny, obsada matrycy i górna belka zostały podzielone na odcinki Z,
  które kończą się przed bocznymi stojakami (2 mm szczeliny montażowej).
  Odpowiednie objętości w `collision3d.ts` mają te same zakresy Z co bryły renderowane.
- Przekrój stojaka C jest współdzielony przez wizualizację i model kolizyjny.
  Podział i geometria mają charakter **poglądowy**, a nie pomierzonego modelu CAD.
- OrbitControls ma wolniejszy obrót, pan i zoom, mniejszą bezwładność,
  a przesuwanie jest zgodne z płaszczyzną ekranu.
- W prawym górnym rogu dodano przycisk **Kamera**, panel ze sliderem czułości
  20-100% (domyślnie 40%). Ustawienie jest zapisywane w `localStorage`.
- Lewy klawisz: obrót, prawy: przesunięcie, kółko: zoom.
- Odświeżanie w trybie programowego WebGL podniesiono z ~22 do ~31 FPS
  w miarę możliwości sprzętu. Silnik gięcia i niezależne sterowanie kamerą po
  kolizji pozostały zachowane.

### Testy v3.3

27 testów logiki i geometrii (22 poprzednie + 5 nowych) przechodzi
po transpiliacji i uruchomieniu przez Node.js. Kompilacja samego silnika
TypeScript przebiega bez błędów; składnia zmodyfikowanego TSX została
zweryfikowana przez kompilator TypeScript. Pełnego builda React/Vite ani
wizualnej walidacji w przeglądarce nie można było wykonać bez zależności npm.

**Uwaga:** bez dokładnych modeli CAD osprzętu i korpusu zmiany dotyczą
poglądowej wizualizacji i symulacji przybliżonych brył. Brak wykrytej kolizji
nie dowodzi fizycznej wykonalności gięcia.

## Poprawka v3.4: fałszywy brak kolizji dla C 50 × 80 × 50 mm

Ten przypadek został zgłoszony z rzeczywistej krawędziarki: **na maszynie dochodzi do kolizji, a przybliżony model stempla w programie jej nie zgłaszał**. Problem **nie został sztucznie „naprawiony” przez oznaczenie każdego profilu C jako niewykonalnego**. Detektor korzysta z wybranej geometrii narzędzia i jawnie oznacza niepewność.

### Co zmieniono

- Dodano szablon **„Profil C 50×80×50 mm (sprawdzenie kolizji)”** z dwoma gięciami 90°. **Uwaga:** grubość 2 mm, długość 1000 mm i promień 2,5 mm to wartości przykładowe, nie dane Twojego rzeczywistego detalu.
- Dla **już zagiętych ramion** sprawdzany jest prześwit względem stempla, mocowania i belki na całym skoku. W wersji v3.4 mały prześwit zatrzymywał animację. **Od v3.6 ostrzeżenie nie zatrzymuje ruchu, tylko kontakt z obrysem przeszkody.** Kamera pozostaje aktywna.
- Początkowy margines kontrolny to **8 mm**. Jest to **arbitralny próg ostrzegawczy**, nie norma bezpieczeństwa, dokładność pomiarowa ani dodatkowa geometria stempla. Nie zamienia małego prześwitu w rzeczywistą penetrację brył.
- Wynik „nie wykryto przenikania” jest oznaczany jako **niezweryfikowany**, nie zielonym potwierdzeniem możliwości produkcji.
- Kontrola pokrycia całej szerokości detalu przez segmenty **obu** narzędzi w osi Z; brak pokrycia unieważnia ocenę wykonalności.
- Zagęszczono próbkowanie skoku (domyślnie maks. 0,8 mm ruchu / 0,65° zmiany kąta pomiędzy próbkami), dodano ruch łuków do kryterium adaptacji i uniezależniono porównanie od liczby ich wierzchołków.
- Podczas animacji sprawdzane są pozycje **pomiędzy sąsiednimi klatkami**, a wykrytą blokadę doprecyzowuje wyszukiwanie połówkowe; nie przeskakuje się przez wykryty punkt zatrzymania.

### Wynik kontrolny dla C 50×80×50

Założenia: **t = 2 mm, długość gięcia 1000 mm, stal DC01, V16, kolejność G1→G2, wartości obrysów wyłącznie z biblioteki poglądowej**.

- Stempel prosty PS.135.85.R08/FX (profil **uproszczony**): przy drugim gięciu obliczony minimalny prześwit do już zagiętego ramienia wynosi około **5,93 mm**. Detektor zgłasza **RYZYKO**, nie potwierdza kolizji brył ani możliwości wykonania fizycznego.
- Szerszy stempel TOP.175.60.R5 (profil **uproszczony**): przy drugim gięciu detektor zgłasza **rzeczywiste przecięcie modeli geometrycznych**.
- Zmiana grubości, długości, promienia, matrycy, stempla, mocowania, ułożenia czy kolejności gięć może zmienić wynik. **Nie znamy rzeczywistych obrysów narzędzi użytkownika.**

### Co trzeba zmierzyć / dodać przed porównywaniem z produkcją

1. Grubość blachy, materiał, promienie po gięciu oraz informację, czy 50/80/50 mm to **wymiary zewnętrzne**, wewnętrzne czy długości prostych odcinków na rozwinięciu. Obecny model traktuje je jako długości segmentów w rozwinięciu.
2. Przekroje **rzeczywistego stempla** (zwłaszcza jego ramion / prześwitu) i jego mocowania, matrycy i obsady, najlepiej CAD lub pomiary w mm.
3. Rzeczywistą kolejność gięć, obrót / przełożenie detalu, ustawienie segmentów w osi Z i palców zderzaka.
4. Zdjęcie miejsca, w którym fizycznie pojawia się kolizja, i informację na którym etapie ruchu.

**Granica możliwości:** nadal są to wyciągnięte przekroje 2D o stałej szerokości Z, nie pełne modele STEP ani symulacja formowania MES. Próbkowanie jest dyskretne, nie gwarantuje wykrycia każdej kolizji. Nawet pomyślny wynik obliczeń nie stanowi zgody na wykonanie gięcia bez niezależnej weryfikacji w hali, zgodnie z dokumentacją i procedurami BHP.

### Weryfikacja

34 testy jednostkowe logiki silnika w izolowanym środowisku Node/TypeScript: **34/34 pozytywne**. Zmienione pliki TSX mają poprawną składnię według transpiler TypeScript. Pełnego builda przeglądarkowego React/Three.js i porównania z rzeczywistą maszyną **nie zweryfikowano** (w środowisku brak kompletu zależności npm i dokładnego modelu osprzętu).


## Wersja v3.5: dane z fotografii narzędzi użytkownika (17.11.2026)

Rozpoznano etykiety i porównano z katalogiem producenta Rolleri:

- **PS.135.85.R08**: wysokość całkowita 135 mm / robocza 105 mm, 85°, R0,8 mm, obciążenie 1000 kN/m. Wariant FX na etykiecie jest nieczytelny, nie zakłada się sposobu segmentacji.
- **TOP.175.60.R5**: wysokość całkowita 175 mm / robocza 145 mm, 60°, R5, obciążenie 1600 kN/m.
- **M.460.R**: jeden korpus 4V z rowkami 16/22/35/50 mm, 85°, R2/R2/R2/R3, wysokość 60 mm, obciążenie 800 kN/m. W bibliotece są cztery ustawienia tego samego narzędzia.

Źródła producenta:
- https://www.rolleritools.com/tools-6437/press-brakes/tools/type-r1-punches/ps13585r08-6700
- https://www.rolleritools.com/tools-6437/press-brakes/tools/type-r1-punches/top17560r5-6594
- https://www.rolleritools.com/tools-6437/press-brakes/tools/type-r1-dies/m460r-6802

**Uwaga: zdjęcia z tabliczkami identyfikują typ i parametry, ale nie wystarczają do odtworzenia rzeczywistych wielokątnych przekrojów.** Profile kolizyjne w kodzie pozostają uproszczone. Nie deklaruj fizycznej bezkolizyjności, zwłaszcza dla drugiego gięcia profilu C 50×80×50. Do dokładniejszego wyniku potrzebny jest boczny obrys w skali 1:1 z DXF producenta i rysunek rzeczywistego zacisku górnego. Ocenę należy potwierdzić testem na maszynie zgodnie z procedurami BHP.


## Wersja v3.6: kontynuacja gięcia aż do kontaktu (17.11.2026)

**Zasada działania:**
- Ostrzeżenia o małym prześwicie (np. 8 mm) są wyświetlane, ale **nie zatrzymują animacji**.
- Symulacja przesuwa blachę do pierwszego kontaktu z poglądową bryłą stempla, uchwytu, stołu, zderzaka, ramy lub inną nieprzylegającą częścią blachy. Normalny kontakt technologiczny stempel–blacha–matryca w lokalnej strefie formowania nadal jest wyłączony z blokowania.
- Kontakt numeryczny jest określany przy prześwicie **0,01 mm lub mniejszym** albo wykrytym przecięciu. To wyłącznie tolerancja obliczeniowa obrazu, **nie** tolerancja bezpieczeństwa maszyny.
- Silnik sprawdza klatki pośrednie i dogęszcza próby w pobliżu kolizji, następnie doprecyzowuje moment graniczny przez 14 podziałów przedziału. Ogranicza to przeskakiwanie przez krótkotrwały kontakt, ale nie daje gwarancji ciągłego wykrywania.
- Po zatrzymaniu pozostaje aktywny obrót/przesuwanie/zoom kamery, suwak ręczny, zmiana kroku i reset. Ponowne Play w tym samym momencie nie przepycha materiału przez przeszkodę.
- Usunięto fikcyjną minimalną wartość 0,21 mm w wyliczaniu głębokości przenikania w pewnej klasie przecinających się wielokątów. Takie przecięcie nadal jest traktowane jako kontakt, ale nie raportuje arbitralnie 0,21 mm w momencie dotknięcia.

**Przykład regresyjny:** C 50×80×50 mm, G2, wartości przykładowe t=2 mm, V16. Wąski stempel PS.135.85.R08: przy ok. 6 mm prześwitu ostrzeżenie bez zatrzymania; szerszy TOP.175.60.R5: zatrzymanie w okolicach 77,5% skoku, przy prześwicie ok. 0,01 mm obliczonym dla *uproszczonych przekrojów*. Nie jest to odwzorowanie rzeczywistej kolizji na Ermaksanie bez dokładnych modeli narzędzi.

**Ograniczenia:** model brył wyciągniętych z 2D wzdłuż osi Z, schematyczne kontury narzędzi/mocowań, dyskretne próbkowanie. Brak wykrytego kontaktu nie potwierdza bezpieczeństwa ani fizycznej możliwości gięcia.

## Uruchamianie na Windows z repozytorium GitHub

1. Pobierz repozytorium (Code -> Download ZIP) i rozpakuj.
2. Kliknij dwukrotnie `Uruchom_FalconBEND.bat`. Skrypt rozpakowuje `FalconBEND.exe` z `FalconBEND_Launcher_Binary.zip` tylko przy pierwszym starcie.
3. Aplikacja otworzy się w lokalnej przeglądarce. Działającą usługę zamkniesz plikiem `Zamknij_FalconBEND.vbs`.

Przy pierwszym uruchomieniu nadal potrzebne są Node.js i internet do instalacji zależności. Później program działa lokalnie, bez `npm run dev`. Plik `FalconBEND.exe` jest celowo pakowany do archiwum, aby ograniczyć rozmiar repozytorium.

**Uwaga techniczna:** wyniki kolizji opierają się na przybliżonych bryłach narzędzi i korpusu. Brak wykrytej kolizji nie jest potwierdzeniem bezpiecznego gięcia na rzeczywistej prasie.
