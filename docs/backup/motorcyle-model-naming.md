# Motorrad-Modellbezeichnungen (DE-Markt)

Referenz für Benennung, Identifikation und Clustering von Motorradmodellen im deutschen Markt.

## Kernaussage

**Der Modellname ist nicht die Identität.** Drei unabhängige Ebenen müssen im Datenmodell getrennt werden:

| Ebene | Beispiel | Änderungsfrequenz |
|---|---|---|
| Marketingname | „Yamaha MT-07" | selten, teils 10+ Jahre stabil |
| Technische Generation (Typcode) | RM04 → RM17/18 → RM33/34 → RM48–51 | alle 3–4 Jahre |
| Modelljahr | 2014 … 2026 | jährlich (Farben, Pakete, Preis) |

Die MT-07 heißt seit 2014 durchgehend „MT-07", hat aber bereits sechs+ Typcodes durchlaufen. `name + year` als Schlüssel wirft technisch inkompatible Fahrzeuge zusammen.

## Namensmuster

1. **Name bleibt, Generation wechselt still** – Yamaha MT-07/MT-09, Kawasaki Z900, Ducati Monster, Triumph Bonneville, Honda CBR1000RR (SC28 → SC33 → SC44 → SC50 → SC57 → SC59 → SC77 → SC82)
2. **Hubraum im Namen → Name wechselt bei Motorwechsel** – BMW R 1200 GS → R 1250 GS → R 1300 GS; KTM 1290 → 1390 Super Duke R; Honda CRF1000L → CRF1100L
3. **Name + Suffix für Varianten** – SP, S, R, RS, RR, GT, Adventure, Rally, Pro, Performance, Triple Black. Varianten derselben Generation, keine eigenen Modelle.
4. **Namens-Recycling nach Jahrzehnten** – BMW R 18 (2020 vs. 1936), Honda CB750 Hornet (2023) vs. CB750 Four (1969). Deshalb reicht `name + year` nicht; nötig ist `name + generation`.

### Fallstricke

- **Hubraum im Namen ≠ realer Hubraum**: MT-09 = 890 cm³, KTM 1290 = 1301 cm³, BMW F 900 = 895 cm³. Nie aus dem Namen ableiten.
- **Schreibweisen divergieren**: BMW „R 1300 GS" (Leerzeichen), Honda „CB750 Hornet", Ducati „Multistrada V4 S". Nutzer tippen „R1300GS". → Alias-/Synonym-Tabelle ist Pflicht.
- **Harley-Davidson** nutzt eigene Modellcodes (FLFBS = Fat Boy 114) parallel zum Namen.

## HSN/TSN (KBA)

Rechtlich verbindliche Identität in Deutschland, aus Zulassungsbescheinigung Teil I:

- **HSN** (Feld 2.1) – 4-stellig, Hersteller
- **TSN** (Feld 2.2) – 3-stellig alphanumerisch, Typ

Basis für Versicherung, Teilekataloge, Bewertung (Schwacke/DAT).

**Als Primärschlüssel ungeeignet:** Die TSN folgt der EG-Typgenehmigung, nicht dem Marketing. Eine TSN kann mehrere Ausstattungslinien und Modelljahre umfassen, ein Marketingmodell mehrere TSN haben. → Gutes Join-Key, schlechter Anzeige-Key. Als n:m-Beziehung zu `Generation` modellieren, nicht als Spalte.

## Datenmodell

```
Manufacturer (Hersteller)          BMW Motorrad  [HSN 0009]
 └ ModelFamily (Baureihe)          GS  /  Honda: CBR  /  Yamaha: MT
    └ Model (Modell)               "R 1300 GS"        ← Sucheinheit
       └ Generation (Typcode)      K81, 2023–         ← Wahrheitseinheit
          └ Variant (Ausstattung)  Basis | Adventure | Triple Black | 35 kW
             └ ModelYear           2024 | 2025 | 2026  ← Farben, Pakete, Preis
                └ TypeApproval     HSN/TSN, Euro-Norm
```

Stabiler Slug: `bmw/r-1300-gs/k81/adventure`

### Wann eine neue `Generation` anlegen

| Auslöser | Neue Generation? |
|---|---|
| Neuer Herstellertypcode (K.., SC.., RM.., ZR..) | ja |
| Neuer Rahmen oder Motor | ja |
| Neue Abgasnorm mit Re-Homologation | ja |
| Neue TSN | meist ja |
| Nur Farben, Pakete, Preis | nein → neues ModelYear |
| Leistungsvariante (35 kW / A2) | nein → Variant |

### Feldzuordnung

Hubraum, Leistung (kW **und** PS), Führerscheinklasse und Abgasnorm gehören auf `Generation`/`Variant`, nie auf `Model`. Segment, Fahrzeugklasse, Führerscheinklasse und Abgasnorm als Enums, nicht als Strings.

## Namensformel für Menschen

```
{Marke} {Modellname} {Variante} {Leistungsvariante} ({Zeitraum})
```

Fünf Eskalationsstufen – immer die **kürzeste im Kontext eindeutige** wählen:

| Stufe | Beispiel | Wann |
|---|---|---|
| 0 · Baureihe | `BMW GS` | nur Kategorieseiten, SEO, Navigation – **nie** für ein Fahrzeug |
| 1 · Modell | `BMW R 1300 GS` | wenn nur eine Generation/Variante existiert |
| 2 · + Variante | `BMW R 1300 GS Adventure` | sobald Ausstattungslinien existieren |
| 3 · + Zeitraum | `BMW R 1250 GS (2019–2023)` | sobald der Name mehrere Generationen hatte |
| 4 · + Typcode | `BMW R 1250 GS (2019–2023, K50)` | Technik, Teile, Werkstatt, HSN/TSN |

Stufe 2–3 ist der Normalfall für Menschen. Stufe 4 nur bei Kompatibilitätsfragen.

### Zeitraum statt Einzeljahr

„BMW GS 2020" ist wertlos – 2020 verkaufte BMW sechs GS-Modelle (G 310 GS, F 750 GS, F 850 GS, F 850 GS Adventure, R 1250 GS, R 1250 GS Adventure), von 313 bis 1254 cm³.

| falsch | richtig |
|---|---|
| BMW GS 2020 | BMW R 1250 GS (2019–2023) |
| Yamaha MT-07 2022 | Yamaha MT-07 (2021–2024) |
| Honda Fireblade 2021 | Honda CBR1000RR-R Fireblade SP (2020–2023) |

Regel: **Zeitraum = welches Motorrad. Einzeljahr = welche Ausführung.** Einzeljahr nur nennen, wenn tatsächlich das Modelljahr gemeint ist: „BMW R 1250 GS, Modelljahr 2020, Rallye-Paket, Style HP".

### Rendering-Regel: kürzester eindeutiger Name

```
1. Starte mit "{Marke} {Modellname}"
2. Im Zielkontext mehrdeutig? → + Variante
3. Immer noch mehrdeutig?     → + Zeitraum
4. Immer noch mehrdeutig?     → + Typcode
```

Der Zielkontext entscheidet: In einer Liste aktueller Neufahrzeuge reicht `BMW R 1300 GS`. In einer Gebrauchtliste 2010–2026 braucht es `BMW R 1300 GS (ab 2023)`, weil R 1200 GS und R 1250 GS danebenstehen.

→ **Bestandteile getrennt speichern, kontextabhängig rendern.** Kein fertiger Anzeigestring in der DB.

### Leistungsvariante sichtbar machen

Führerscheinrelevanz ist im DE-Markt kaufentscheidend und gehört in den Anzeigenamen – als Variante, nicht als eigenes Modell:

- `BMW F 900 GS (35 kW / A2)`
- `Yamaha MT-07 (35 kW / A2)`
- `KTM 125 Duke (A1 / B196)`

### Beispiele

| Baureihe | Exakte Beschreibung |
|---|---|
| BMW GS | `BMW R 1300 GS Adventure (ab 2024)` |
| BMW GS | `BMW G 310 GS (2017–2024, A2)` |
| Yamaha MT | `Yamaha MT-07 (ab 2025, Euro 5+)` |
| Honda Africa Twin | `Honda CRF1100L Africa Twin Adventure Sports DCT (ab 2022)` |
| KTM Duke | `KTM 1390 Super Duke R Evo (ab 2024)` |
| Ducati | `Ducati Multistrada V4 S (2021–2024)` |
| Kawasaki | `Kawasaki Z900 (2020–2024, 35-kW-Version)` |

## Cluster-Dimensionen

Nach Marketingrelevanz sortiert.

### 1. Führerscheinklasse (wichtigste DE-Dimension)

| EU-Klasse | Beschreibung | Führerschein |
|---|---|---|
| `L1e-B` | Mofa/Moped, 50 cm³, 45 km/h | AM |
| `L3e-A1` | Leichtkraftrad, 125 cm³ / 11 kW | A1, **B196** |
| `L3e-A2` | ≤ 35 kW, ≤ 0,2 kW/kg, nicht aus > 70 kW abgeleitet | A2 |
| `L3e-A3` | offen | A |
| `L4e` | Gespann | – |
| `L5e` | Trike | – |
| `L7e` | Quad | – |

**B196** ist der kommerziell interessanteste Cluster: Pkw-Führerscheininhaber, die mit Zusatzschulung 125er fahren dürfen. Große, wachsende, nicht-technikaffine Zielgruppe – deckt sich mit dem Produktprofil.

### 2. Bauart / Segment

Naked Bike, Supersportler, Sporttourer, Tourer, Reiseenduro, Enduro, Supermoto, Chopper/Cruiser, Streetfighter, Roadster, Roller, Cross, Trial, Gespann, Trike, Quad. (Analog mobile.de-Kategorien.)

### 3. Hubraumklasse

≤ 50 / 51–125 / 126–500 / 501–800 / 801–1000 / > 1000 cm³

### 4. Abgasnorm (harte Zeitgrenze)

Euro 4 / Euro 5 / **Euro 5+**

- seit 01.01.2024: alle neu homologierten Krafträder müssen Euro 5+ erfüllen
- seit 01.01.2025: gilt für alle Neuzulassungen
- enge Auslaufserien-Ausnahmen über das KBA bis Ende 2026

**Praktische Folge:** Viele „neue" 2024/25-Modelle sind reine Euro-5+-Re-Homologationen unter identischem Namen – genau der Fall, der ohne Generations-Ebene im Modell zusammenbricht.

### 5. Antrieb

Verbrenner / Elektro

### 6. Lifecycle

aktuell / Auslaufmodell / eingestellt – plus Baujahr-Range für den Gebrauchtmarkt.

## Nutzerführung

Nicht-technische Nutzer tippen „BMW GS" oder „meine 1250er". Das darf nicht scheitern:

1. **Eingabe akzeptieren** auf Baureihen-Ebene (unscharf, über Alias-Tabelle)
2. **Rückfrage stellen** bei Mehrdeutigkeit – mit Bild, Baujahr-Range und Leistung als Auswahlkriterien, nicht mit Typcodes
3. **Speichern und anzeigen** immer als eindeutige Stufe-3-Bezeichnung

Typcodes (K50, RM34, SC82) bleiben intern und erscheinen nur bei Teile- und Technikfragen.

## Quellen

- [ADAC – HSN und TSN Schlüsselnummern](https://www.adac.de/rund-ums-fahrzeug/auto-kaufen-verkaufen/kfz-zulassung/hsn-tsn-faq/)
- [Allianz – HSN & TSN: Die KBA-Schlüsselnummer finden](https://www.allianz.de/auto/kfz-versicherung/schluesselnummer/)
- [MotoMe – HSN/TSN-Suche Motorrad](https://motome.de/hsn-tsn-suche/)
- [POLO – Yamaha MT-07 2014–2017 (RM04, RM17, RM18)](https://magazin.polo-motorrad.com/polo-bike-datenbank/yamaha-mt-07-2014-2017-rm04-rm17-rm18-mtn-690/)
- [Raxim – Yamaha MT-07 ab 2025 (RM48–RM51), Euro 5+ & Y-AMT](https://mtp-racing.de/blog/yamaha-mt-07-from-2025-rm48-rm49-rm50-rm51-euro5-plus-y-amt-facelift-differences-accessory-compatibility)
- [cbr1000rr.de – Fireblade Typcodes SC28–SC82](https://www.cbr1000rr.de/)
- [Motorradonline – Das ändert sich mit Euro 5+](https://www.motorradonline.de/ratgeber/euro5-plus-was-aendert-sich-mit-euro5-fuer-motorraeder/)
- [motoin – Abgasnorm Euro 5+ ab 2025](https://www.motoin.de/magazin/news/abgasnorm-euro5/)
- [mobile.de – Motorrad-Suche (Fahrzeugkategorien)](https://www.mobile.de/s/motorrad)
- [Ultimate Motorcycling – BMW Model Letters and Numbers](https://ultimatemotorcycling.com/2020/12/26/bmw-motorcycles-what-the-model-letters-and-numbers-mean/)
