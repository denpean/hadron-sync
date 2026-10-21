# Parallel Editor

Zweispaltiger Markdown-Editor (Original links, Übersetzung rechts) für Ubuntu / Zorin OS (Electron + TipTap).

## Funktionen

- **Absatzgenaue Ausrichtung:** Absatz *n* des Originals steht immer auf gleicher Höhe wie Absatz *n* der Übersetzung. Die kürzere Seite erhält automatisch mehr Abstand. Beide Spalten scrollen gemeinsam.
- **Hervorhebung:** Der Absatz, der gerade bearbeitet wird, und sein Gegenstück im Original sind dezent farbig hinterlegt.
- **WYSIWYG-Bearbeitung** der Übersetzung (Klick in einen Absatz; Fett, Kursiv, Überschriften, Listen, Zitat, Code, Link, Tabellen). Das Original ist schreibgeschützt.
- **Suchen & Ersetzen** (Strg+F / Strg+H): Groß-/Kleinschreibung, reguläre Ausdrücke, Suche in Übersetzung/Original/beiden. Ersetzt wird nur in der Übersetzung.
- **Import:** Markdown (`.md`, `.markdown`, `.txt`) und OpenDocument-Text (`.odt`).
- **Export:** Markdown und ODT (Original oder Übersetzung).
- **Projektdatei** (`.pep`) speichert beide Texte samt Zuordnung.

## Zuordnung der Absätze

Beim Import wird der Text in Top-Level-Blöcke zerlegt (Absatz, Überschrift, Liste, Zitat, Codeblock, Tabelle). Zugeordnet wird **nach Reihenfolge**; eine inhaltliche Zuordnung findet nicht statt. Weichen die Absatzzahlen ab, korrigierst du per **Rechtsklick** auf eine Zelle:
leere Zelle einfügen/entfernen (verschiebt die folgenden Absätze), mit vorheriger/nächster Zelle verbinden, in einzelne Absätze zerlegen. Am Originaltext ändert das nichts, nur an der Verteilung auf Zeilen.

## Bedienung

| Aktion | Wie |
|---|---|
| Absatz bearbeiten | Klick in die Übersetzung |
| Nächster / vorheriger Absatz | Alt+↓ / Alt+↑ |
| Bearbeitung beenden | Esc oder Klick außerhalb |
| Rückgängig außerhalb des Editors | Strg+Z / Strg+Y |

## Entwickeln

```bash
npm install
npm run build      # bündelt die Oberfläche nach dist/
npm start          # startet die App
npm test           # Unit-Tests (Markdown/ODT/Suche)
npm run dist       # .deb und AppImage (benötigt Netzzugriff für electron-builder)
```

## Bekannte Einschränkungen

- ODT-Import/-Export: Text, Überschriften, Listen, Zitate, Codeblöcke, Links, einfache Tabellen, Fett/Kursiv/Durchgestrichen. Bilder, Fußnoten, Kommentare und Seitenformatierung werden nicht übernommen.
- Bearbeitete Absätze werden von TipTap neu serialisiert (z. B. `*` → `-` bei Listen). Unveränderte Absätze bleiben byteidentisch.
- Suche arbeitet auf dem Markdown-Quelltext; die Hervorhebung der Treffer erfolgt auf dem dargestellten Text und kann bei Formatierungszeichen im Suchbegriff abweichen.
