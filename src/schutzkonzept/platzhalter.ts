/**
 * Platzhalter in DOCX-Vorlagen.
 *
 * docx-templates wertet jeden `{{ ... }}`-Platzhalter als JavaScript aus. Die
 * `vm`-Sandbox davor ist KEINE Sicherheitsgrenze: aus ihr fuehrt ueber
 * `this.constructor.constructor("...")()` ein Weg in den API-Prozess. Eine
 * hochgeladene DOCX waere damit Codeausfuehrung auf dem Server -- die
 * Schutzkonzept-Verwaltung darf Vorlagen pflegen, Serverzugriff gehoert aber
 * nicht zu dieser Rolle (und ein uebernommener Portal-Zugang haette ihn sonst
 * gleich mit).
 *
 * Deshalb zwei Dinge hier:
 *  - `pruefeBefehle` laesst nur INS/FOR/END-FOR/IF/END-IF durch und in deren
 *    Ausdruecken nur Felder, Rechnen, Vergleiche und eine kleine Liste von
 *    Formatier-Methoden. EXEC, beliebige Funktionsaufrufe, `[ ]`, Backticks,
 *    Zuweisungen und `constructor`/`__proto__` sind gesperrt (fail closed).
 *    Geprueft wird beim Upload UND vor jedem Rendern, damit auch Vorlagen aus
 *    der Zeit vor dieser Pruefung erfasst sind.
 *  - `extrahiereKeys` liefert die Variablennamen fuer den Abgleich mit dem
 *    Formular im Builder (Warnungen, keine Sperre).
 *
 * Die Antworten der EC-Kreise kommen ohnehin nie als Code an: docx-templates
 * setzt sie als Werte in den Kontext, definition.ts lehnt interne
 * Bezeichnungen wie `__code__` ab, und der Worker filtert sie zusaetzlich
 * (siehe istVerboten).
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

/* --------------------------------------------------- Pruefung der Befehle -- */

/**
 * Erlaubte Befehle. Alles andere (EXEC, IMAGE, LINK, HTML, ALIAS, QUERY ...)
 * ist gesperrt: docx-templates fuehrt den Inhalt eines Befehls als JavaScript
 * aus, und `EXEC` ist genau dafuer gedacht.
 */
const ERLAUBTE_BEFEHLE = new Set(['INS', 'FOR', 'END-FOR', 'IF', 'END-IF'])

/**
 * Methoden, die ein Ausdruck aufrufen darf. Bewusst nur Formatierung auf
 * Werten -- `map`, `filter` & Co. nehmen eine Funktion entgegen und waeren
 * damit wieder ein Einfallstor fuer beliebigen Code.
 */
const ERLAUBTE_METHODEN = new Set([
  'toUpperCase',
  'toLowerCase',
  'trim',
  'includes',
  'startsWith',
  'endsWith',
  'toLocaleString',
  'toString',
  'toFixed',
  'join'
])

/** Einzelzeichen, die in einem Ausdruck vorkommen duerfen. */
const ERLAUBTE_ZEICHEN = /[\s()., ?:+\-*/%!<>=&|{}]/

/** Laengengrenze je Befehl -- gegen Parser-DoS mit einem Riesenausdruck. */
const MAX_CODE = 2000

export interface BefehlsFehler {
  type: string
  code: string
  grund: string
}

/** Fehlercode, mit dem der Worker eine unzulaessige Vorlage meldet. */
export const VORLAGE_UNZULAESSIG = 'VORLAGE_UNZULAESSIG:'

/**
 * Prueft einen einzelnen Ausdruck zeichenweise. Kein vollstaendiger Parser,
 * sondern eine bewusst enge Sperre: Was nicht eindeutig harmlos aussieht,
 * wird abgelehnt (fail closed).
 */
function pruefeAusdruck(code: string): string | null {
  if (code.length > MAX_CODE) return 'Der Ausdruck ist zu lang.'
  let i = 0
  // Letztes bedeutsames Zeichen bzw. Bezeichner davor -- fuer "Methodenaufruf
  // nur nach einem Punkt" und "kein f()() ".
  let vorigesZeichen = ''
  let vorigerName: string | null = null
  let nameHatPunkt = false
  while (i < code.length) {
    const c = code[i]
    // Strings ueberspringen; Backticks sind verboten (`${...}` waere Code).
    if (c === '"' || c === "'") {
      const ende = code.indexOf(c, i + 1)
      if (ende < 0) return 'Ein Text ist nicht geschlossen.'
      i = ende + 1
      vorigesZeichen = '"'
      vorigerName = null
      continue
    }
    if (c === '`') return 'Backticks sind in Vorlagen nicht erlaubt.'
    if (c === '[' || c === ']') {
      return 'Eckige Klammern sind in Vorlagen nicht erlaubt.'
    }
    if (c === ';' || c === '\\' || c === '#' || c === '@' || c === '~') {
      return `Das Zeichen "${c}" ist in Vorlagen nicht erlaubt.`
    }
    if (/[0-9]/.test(c)) {
      while (i < code.length && /[0-9._eE]/.test(code[i])) i++
      vorigesZeichen = '0'
      vorigerName = null
      continue
    }
    if (/[A-Za-z_$]/.test(c)) {
      const start = i
      while (i < code.length && /[\w$]/.test(code[i])) i++
      const name = code.slice(start, i)
      if (istVerboten(name)) {
        return `"${name}" darf in einer Vorlage nicht vorkommen.`
      }
      nameHatPunkt = vorigesZeichen === '.'
      vorigerName = name
      vorigesZeichen = 'a'
      continue
    }
    if (c === '(') {
      // Aufruf? Dann muss es eine erlaubte Methode nach einem Punkt sein.
      if (vorigesZeichen === 'a' && vorigerName !== null) {
        if (!nameHatPunkt || !ERLAUBTE_METHODEN.has(vorigerName)) {
          return `Der Aufruf von "${vorigerName}" ist in Vorlagen nicht erlaubt.`
        }
      } else if (vorigesZeichen === ')') {
        return 'Verkettete Aufrufe sind in Vorlagen nicht erlaubt.'
      }
      i++
      vorigesZeichen = '('
      vorigerName = null
      continue
    }
    if (c === '=') {
      // Nur Vergleiche: ==, ===, !=, !==, <=, >= -- keine Zuweisung, kein =>.
      const davor = code[i - 1]
      const danach = code[i + 1]
      if (!'=!<>'.includes(davor ?? '') && danach !== '=') {
        return 'Zuweisungen und Pfeilfunktionen sind in Vorlagen nicht erlaubt.'
      }
      if (danach === '>') {
        return 'Pfeilfunktionen sind in Vorlagen nicht erlaubt.'
      }
      i++
      vorigesZeichen = '='
      vorigerName = null
      continue
    }
    if (ERLAUBTE_ZEICHEN.test(c)) {
      i++
      if (!/\s/.test(c)) {
        vorigesZeichen = c
        if (c !== '.') vorigerName = null
      }
      continue
    }
    return `Das Zeichen "${c}" ist in Vorlagen nicht erlaubt.`
  }
  return null
}

/**
 * Alle Befehle einer Vorlage pruefen. Leere Liste = in Ordnung.
 *
 * Hintergrund: docx-templates wertet den Inhalt jedes `{{ }}` als JavaScript
 * aus, und seine `vm`-Sandbox ist keine Sicherheitsgrenze -- ueber
 * `this.constructor.constructor("...")()` fuehrt von dort ein Weg in den
 * API-Prozess. Eine hochgeladene DOCX waere sonst also Codeausfuehrung auf dem
 * Server. Die Verwaltung darf Vorlagen hochladen; Serverzugriff gehoert nicht
 * zu dieser Rolle. Erlaubt bleibt, was echte Vorlagen brauchen: Felder
 * einsetzen, rechnen, vergleichen, formatieren, FOR/IF.
 */
export function pruefeBefehle(befehle: Befehl[]): BefehlsFehler[] {
  const fehler: BefehlsFehler[] = []
  for (const b of befehle) {
    const type = String(b.type ?? '')
    if (!ERLAUBTE_BEFEHLE.has(type)) {
      fehler.push({
        type,
        code: String(b.code ?? '').slice(0, 120),
        grund: `Der Befehl ${type} ist in Vorlagen nicht erlaubt.`
      })
      continue
    }
    let code = String(b.code ?? '')
    if (type === 'END-FOR' || type === 'END-IF') continue
    if (type === 'FOR') {
      const m = FOR_RE.exec(code.trim())
      if (!m) {
        fehler.push({ type, code, grund: 'FOR erwartet "name IN liste".' })
        continue
      }
      if (istVerboten(m[1])) {
        fehler.push({ type, code, grund: `"${m[1]}" ist als Name gesperrt.` })
        continue
      }
      code = m[2]
    }
    const grund = pruefeAusdruck(code)
    if (grund) fehler.push({ type, code: code.slice(0, 120), grund })
  }
  return fehler
}

/** Meldung fuer den Verwalter aus den gefundenen Fundstellen. */
export function befehlsFehlerText(fehler: BefehlsFehler[]): string {
  const liste = fehler
    .slice(0, 5)
    .map(
      (f) => `{{${f.type === 'INS' ? '' : f.type + ' '}${f.code}}}: ${f.grund}`
    )
    .join(' ')
  const rest = fehler.length > 5 ? ` (und ${fehler.length - 5} weitere)` : ''
  return `Die Vorlage enthält Platzhalter, die nicht erlaubt sind. ${liste}${rest}`
}

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
