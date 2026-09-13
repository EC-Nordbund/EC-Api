/**
 * Platzhalter in DOCX-Vorlagen.
 *
 * docx-templates wertet jeden `{{ ... }}`-Platzhalter als JavaScript aus.
 * Das ist hier gewollt: Vorlagen laedt ausschliesslich die
 * Schutzkonzept-Verwaltung hoch (portalUser.is_schutzkonzept_verwalter), und
 * ihr wird -- wie den Vorlagen in EC-Api/templates -- vertraut. Eine Vorlage
 * darf also rechnen, formatieren und mit EXEC eigene Hilfsvariablen anlegen.
 *
 * Was NICHT vertrauenswuerdig ist, sind die eingesetzten Antworten der
 * EC-Kreise. Die kommen aber nie als Code an: docx-templates setzt sie als
 * Werte in den Kontext, und definition.ts lehnt interne Bezeichnungen wie
 * `__code__` ab, mit denen ein Wert den Code-Slot ueberschreiben koennte
 * (zusaetzlich filtert der Worker solche Schluessel, siehe istVerboten).
 *
 * Hier steht deshalb nur noch die Erkennung der Variablennamen fuer den
 * Abgleich mit dem Formular im Builder (Warnungen, keine Sperre).
 */

export interface Befehl {
  type: string
  code: string
}

/**
 * Schluessel, die nie aus den Daten in den Auswertungskontext gelangen
 * duerfen: `__code__`/`__result__` sind die Uebergabe-Slots von
 * docx-templates, `constructor`/`prototype` waeren Wege in die Prototypkette.
 */
export function istVerboten(name: string): boolean {
  const ohneDollar = name.startsWith('$') ? name.slice(1) : name
  return (
    ohneDollar.startsWith('__') ||
    ohneDollar.endsWith('__') ||
    ohneDollar === 'constructor' ||
    ohneDollar === 'prototype'
  )
}

/** `FOR raum IN liste` -- gleiche Aufteilung wie docx-templates. */
const FOR_RE = /^(\S+)\s+IN\s+(.+)/i

/** Woerter, die in Ausdruecken vorkommen, aber keine Formularfelder sind. */
const RESERVIERT = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'IN',
  'new',
  'typeof',
  'this',
  'Math',
  'String',
  'Number',
  'Date',
  'JSON',
  'Array',
  'Object',
  'Boolean',
  'parseInt',
  'parseFloat',
  'isNaN',
  'var',
  'let',
  'const',
  'function',
  'return',
  'if',
  'else',
  'for',
  'while',
  'of',
  'in',
  'instanceof'
])

/**
 * Variablennamen aus den Befehlen einer Vorlage (fuer den Abgleich mit dem
 * Formular). Liefert nur die Namen der obersten Ebene:
 * `{{FOR raum IN gruppenraeume}} ... {{$raum.name}}` ergibt `gruppenraeume` --
 * die Schleifenvariable und alles mit `$` davor nicht. Heuristik auf
 * Textbasis (portiert aus dem Prototyp form-tool): Strings werden entfernt,
 * dann alle Bezeichner ohne vorangestellten Punkt gesammelt. Was eine
 * Vorlage per EXEC selbst definiert, zaehlt nicht als Formularfeld.
 */
export function extrahiereKeys(befehle: Befehl[]): string[] {
  const keys = new Set<string>()
  const eigene = new Set<string>()
  for (const b of befehle) {
    if (b.type === 'FOR') {
      const m = FOR_RE.exec(b.code.trim())
      if (m) eigene.add(m[1])
    } else if (b.type === 'EXEC') {
      for (const m of b.code.matchAll(
        /(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g
      )) {
        eigene.add(m[1])
      }
    }
  }
  for (const b of befehle) {
    let code = b.code
    if (b.type === 'FOR') {
      const m = FOR_RE.exec(code.trim())
      if (!m) continue
      code = m[2]
    } else if (!['INS', 'IF', 'EXEC'].includes(b.type)) {
      continue
    }
    const ohneStrings = code.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '')
    for (const m of ohneStrings.matchAll(/(?<![\w.$])([A-Za-z_][\w]*)/g)) {
      const id = m[1]
      const davor = ohneStrings.slice(0, m.index)
      const danach = ohneStrings.slice((m.index ?? 0) + id.length)
      // Objekt-Schluessel wie {foo: 1} sind keine Variablen
      if (/[{,]\s*$/.test(davor) && /^\s*:/.test(danach)) continue
      if (RESERVIERT.has(id) || eigene.has(id) || istVerboten(id)) continue
      keys.add(id)
    }
  }
  return [...keys].sort()
}
