# JobOS – markedsføringsnettsted

Statisk nettsted (HTML + én CSS + litt vanilla JS). Ingen byggesteg, ingen rammeverk.
Alle lenker er relative, så siden fungerer på GitHub Pages under en understi (`https://<bruker>.github.io/<repo>/`).

## Struktur

```
index.html           Forside (hero, løsninger, telefon-mockup, integrasjoner, verdier, sitater)
funksjoner.html      Funksjoner med ankere: #ordre #timer #lager #dokumentasjon #hms #planlegging #tilbud #offline
fag.html             Bransjer – samme app, fagspesifikk logo (elektro, rør, snekker, maler)
priser.html          Planer, priskalkulator (vs. 359 kr) og FAQ
integrasjoner.html   Tripletex, PowerOffice Go, Visma, Fiken, OneDrive, Google Drive
om-oss.html          Om oss + #tjenester
kontakt.html         Kontaktskjema (mailto:) + #demo og #brukerstotte
last-ned.html        iOS (TestFlight), Android (kommer), web
app.html             JobOS Kontor – kontorsiden i nettleseren (Firebase- eller demomodus, se under)
tilbud.html          Kundeportal for tilbud: tilbud.html?t=TOKEN (godta/avslå uten innlogging)
logg-inn.html        Innlogging/registrering via Firebase Identity Toolkit REST
personvern.html      Personvern + #databehandleravtale (utkast)
vilkar.html          Vilkår (utkast)
404.html             GitHub Pages feilside
assets/style.css     Felles stilark (fargetokens i :root)
assets/main.js       Mobilmeny, nedtrekksmeny, FAQ, priskalkulator
assets/auth.js       Innloggingslogikk (kun logg-inn.html), sender videre til app.html
assets/firestore.js  Felles REST-klient: innlogging, token-fornyelse, Firestore JSON <-> Value
assets/office.js     Kontorsiden (faner, datalag, demodata)
assets/office.css    Stiler for app.html og tilbud.html
assets/tilbud.js     Kundeportalen
assets/firebase-config.js  window.JOBOS_FIREBASE = { apiKey, projectId }
assets/logo.svg, assets/logo-white.svg, favicon.svg
robots.txt, sitemap.xml, .nojekyll
```

## Vedlikehold

- Header og footer er kopiert inn i hver side. Endrer du menyen, må alle sidene oppdateres.
- Firebase: fyll inn `apiKey` og `projectId` i `assets/firebase-config.js`. Tom `apiKey` viser en vennlig melding i stedet for å logge inn.
- `sitemap.xml`, `robots.txt` og `og:url`/`og:image` bruker `https://heggerob.github.io/jobos-web/` – bytt til endelig domene.
- Lokal test: `python3 -m http.server 4190 --directory website`

## Kontor (app.html)

Én side med faner styrt av `#hash`: `#oversikt`, `#ordre`, `#planlegging`, `#timer`, `#kjorebok`, `#utstyr`,
`#katalog`, `#innkjop`, `#kunder`, `#tilbud`, `#hms`, `#skjema`, `#ansatte`. Dyplenker som `#ordre/<jobId>`,
`#tilbud/<quoteId>`, `#kunder/<id>`, `#hms/<id>`, `#skjema/<id>` og `#innkjop/<id>` åpner sidepanelet direkte.

- **Skjema** (`formSubmissions`): liste med fremdrift (besvarte felt / felt uten overskrifter) og filter Alle/Kladd/Fullført.
  Sidepanelet viser svarene gruppert under overskriftene, kun lesing. Bilder og signaturer ligger i appen og vises som
  «N bilder i appen». «Skriv ut» lager et eget utskriftsark (`#print-sheet`) og kaller `window.print()`.
- **Katalog** (`materials`): søk, kategoribrikker, innpris kan endres direkte i tabellen (kroner → `costPriceCents`),
  «Ny vare»/rediger, og «Importer CSV» (semikolon eller komma, UTF-8 eller Windows-1252). Kolonner gjenkjennes fra
  overskriften (varenummer/varenr/sku, navn, enhet, innpris/pris, leverandør, ean, kategori); uten gjenkjent overskrift
  brukes den rekkefølgen. Varer med samme varenummer (uten hensyn til store/små bokstaver) oppdateres.
- **Innkjøp** (`purchaseOrders`): liste med sum eks. mva. «Marker som mottatt» setter `status: "received"` og øker
  `stockQuantity` på katalogvarer med samme varenummer (som iOS-appen: ordren lagres først, så varene).
  «Skriv ut / PDF» gir en innkjøpsordre med firma, leverandør, linjer og sum eks. mva.

**Firebase-modus** (når `apiKey` og `projectId` er satt):
- Innlogging via Identity Toolkit REST. `idToken`, `refreshToken`, `uid`, `email` og utløpstid lagres i
  `sessionStorage` (`jobos_*`). Tokenet fornyes automatisk via `securetoken.googleapis.com` før det utløper og ved 401.
- Firmaene finnes med collection group-spørring på `members` der `uid == <uid>` (samme som iOS-appen).
  Flere firma gir firmavelger; valgt firma huskes i `sessionStorage` (`jobos_companyId`).
- Data leses fra `companies/{id}/{samling}` og skrives med PATCH av hele dokumentet (Firestore-typede verdier).
  `version` økes og `updatedAt` settes der modellen har dem. Felter som er `Double` i iOS-modellene
  (`quantity`, `vatRate`, `distanceKm`, `latitude`, `longitude` …) sendes alltid som `doubleValue`.
- Invitasjoner skrives til `invitations/{id}` der id er `"<companyId>_<e-post>"` prosentkodet med bare bokstaver/tall
  uendret – identisk med iOS-appen, så web og app ikke lager duplikater.
- Kundesvar hentes inn automatisk når Tilbud-fanen åpnes (og med «Hent kundesvar»).

**Demomodus** (tom `apiKey`, knappen «Prøv demo», eller `app.html?demo=1`):
- Realistiske eksempeldata for «Fjordlys Elektro AS» lagres i `localStorage` under `jobos-web-demo`.
  Alt kan redigeres. «Tilbakestill» i banneret eller brukermenyen lager nye data (datoer relativt til i dag).
- «Del med kunde» lager lenken `tilbud.html?t=TOKEN&demo=1`, som leser/skriver samme `localStorage`
  – hele flyten (del → kunden godtar → «Hent kundesvar») kan dermed testes uten server.

## Kundeportal (tilbud.html)

- `tilbud.html?t=TOKEN` leser `publicQuotes/TOKEN` uten innlogging (`?key=API_KEY`) og viser tilbudet.
- «Godta tilbud» (navn + avkrysning) eller «Avslå» (navn + valgfri kommentar) gjør PATCH med
  `updateMask` på `status`, `respondedName`, `respondedAt` og `respondedComment` – det Firestore-reglene tillater.
- `t=demo` eller tom `apiKey` viser et innebygd eksempeltilbud (svaret lagres i `sessionStorage`).
- Både `app.html` og `tilbud.html` har `noindex`.

**Forutsetninger i Firebase:** reglene i `firebase/firestore.rules` (collection group-lesing av `members`,
`publicQuotes` og `invitations`). Collection group-spørringen på `members.uid` kan kreve en enkeltfelt-indeks
med «collection group scope» i Firestore-konsollen. Begrens API-nøkkelen til domenet i Google Cloud Console.
