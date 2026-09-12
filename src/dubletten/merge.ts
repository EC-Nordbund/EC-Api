import type { PoolConnection } from 'promise-mysql'
import { ecError } from '../helpers/error'
import { queryP, withConnection } from '../helpers/mysql'
import { invalidiere } from './cache'
import { normAdresse, normEmail, normTelefon } from './normalisieren'
import { paarKey } from './keine'

/**
 * Zwei Personensaetze zusammenfuehren.
 *
 * Diese Funktion ersetzt die frueher in graphql.ts eingebettete `mergePersonen`.
 * Was dort nicht stimmte und hier behoben ist:
 *
 * 1. KEINE TRANSAKTION. Die alte Fassung setzte ueber zwanzig Einzelstatements
 *    auf einer Verbindung aus getMySQL() ab -- die gibt sich nach 10 Sekunden
 *    selbst frei, ist also fuer eine Transaktion ungeeignet. Brach irgendetwas
 *    in der Mitte ab, blieb alles Vorherige wirksam: Anmeldungen hingen an der
 *    einen Person, Adressen an der anderen, und der Personensatz war noch da.
 *    Der haeufigste Ausloeser war der Schlussakt selbst: eine adressen-Zeile,
 *    die wegen UNIQUE(personID,strasse,plz,ort) nicht verschoben und wegen des
 *    Fremdschluessels anmeldungen.adressID nicht geloescht werden konnte,
 *    blockierte DELETE FROM personen.
 * 2. `UPDATE IGNORE` / `DELETE IGNORE` verschluckten genau diese Kollisionen
 *    still. Hier wird jeder Konflikt entweder bewusst aufgeloest oder als
 *    Fehler gemeldet.
 * 3. SECHS Personen-Referenzen wurden nie mitgezogen: users.person_id,
 *    portalUser.personID, DSGVO_Person.personID, keinedublikate und die beiden
 *    ecKreis-Zustaendigkeiten. Ein Verwaltungs-Login zeigte nach dem Merge auf
 *    einen geloeschten Satz.
 * 4. Der Adress-Join verglich `e1.strasse = e2.strasse` zweimal und `ort` nie.
 * 5. Der Alias-Eintrag in `dublikate` war ein spaltenloses INSERT ... SELECT und
 *    kollidierte mit dem Primaerschluessel, sobald dieselbe Namenskombination
 *    ein zweites Mal gemergt wurde.
 *
 * Die GraphQL-Mutation `mergePersons` ruft weiterhin genau diese Funktion; sie
 * wird dadurch strenger (Konflikte melden statt still halb ausfuehren), was die
 * beabsichtigte Reparatur ist.
 */

export type LoginStrategie = 'abbrechen' | 'uebernehmen' | 'verwerfen'
export type AnmeldungStrategie = 'abbrechen' | 'verwerfenAbgemeldet'

export interface MergeOptionen {
  loginStrategie?: LoginStrategie
  anmeldungStrategie?: AnmeldungStrategie
  /** users.user_id, fuer das Protokoll. */
  durchgefuehrtVon?: number
  /** Score aus der Erkennung, nur fuer das Protokoll. */
  score?: number
}

export interface MergeErgebnis {
  behalten: number
  entfernt: number
  verschoben: Record<string, number>
  zusammengefasst: Array<{ tabelle: string; anzahl: number; grund: string }>
  aliasEingetragen: boolean
}

export interface Kollisionen {
  anmeldungenGleicheVeranstaltung: Array<{
    veranstaltungsID: number
    bezeichnung: string
  }>
  akGleicherTagUndAk: Array<{ akID: number; date: string }>
  tagsDoppelt: number[]
  kontakteDoppelt: { eMails: string[]; telefone: string[]; adressen: string[] }
  portalZugangBeide: boolean
  mergeMoeglich: boolean
  blocker: string[]
}

type Lese = (sql: string, params?: unknown[]) => Promise<any[]>

/** Leseadapter fuer eine Transaktionsverbindung. */
function leseVon(conn: PoolConnection): Lese {
  return (sql: string, params: unknown[] = []) => conn.query(sql, params)
}

/**
 * Prueft, was einem Merge im Weg steht -- ohne etwas zu schreiben.
 *
 * Dieselbe Funktion beantwortet die Vorschau in der Oberflaeche UND entscheidet
 * im Merge selbst. Zwei getrennte Implementierungen wuerden unvermeidlich
 * auseinanderlaufen, und dann zeigt die Seite "geht" und der Klick scheitert.
 */
export async function analysiereKollisionen(
  lese: Lese,
  behalten: number,
  entfernen: number
): Promise<Kollisionen> {
  const k: Kollisionen = {
    anmeldungenGleicheVeranstaltung: [],
    akGleicherTagUndAk: [],
    tagsDoppelt: [],
    kontakteDoppelt: { eMails: [], telefone: [], adressen: [] },
    portalZugangBeide: false,
    mergeMoeglich: true,
    blocker: []
  }

  // anmeldungen: UNIQUE(veranstaltungsID, personID)
  const doppelteAnmeldung = await lese(
    `SELECT a.veranstaltungsID, v.bezeichnung
       FROM anmeldungen a
       JOIN anmeldungen b ON b.veranstaltungsID = a.veranstaltungsID
       LEFT JOIN veranstaltungen v ON v.veranstaltungsID = a.veranstaltungsID
      WHERE a.personID = ? AND b.personID = ?
      GROUP BY a.veranstaltungsID, v.bezeichnung`,
    [behalten, entfernen]
  )
  k.anmeldungenGleicheVeranstaltung = doppelteAnmeldung.map((r) => ({
    veranstaltungsID: r.veranstaltungsID,
    bezeichnung: r.bezeichnung ?? `Veranstaltung ${r.veranstaltungsID}`
  }))

  // akPerson: UNIQUE(personID, akID, date)
  const doppelteAk = await lese(
    `SELECT a.akID, DATE_FORMAT(a.date, '%Y-%m-%d') AS date
       FROM akPerson a
       JOIN akPerson b ON b.akID = a.akID AND b.date = a.date
      WHERE a.personID = ? AND b.personID = ?`,
    [behalten, entfernen]
  )
  k.akGleicherTagUndAk = doppelteAk.map((r) => ({
    akID: r.akID,
    date: r.date
  }))

  // tagsPersonen: PK(tagID, personID)
  const doppelteTags = await lese(
    `SELECT a.tagID FROM tagsPersonen a
       JOIN tagsPersonen b ON b.tagID = a.tagID
      WHERE a.personID = ? AND b.personID = ?`,
    [behalten, entfernen]
  )
  k.tagsDoppelt = doppelteTags.map((r) => r.tagID)

  // Kontaktdaten: Gleichheit wird mit DENSELBEN Normalisierern bestimmt wie in
  // der Erkennung. Mit reiner SQL-Gleichheit wuerden "Musterstr. 9" und
  // "Musterstraße 9" als zwei Adressen an einer Person landen.
  const [mailsB, mailsE] = await Promise.all([
    lese('SELECT eMailID, eMail, isOld FROM eMails WHERE personID = ?', [
      behalten
    ]),
    lese('SELECT eMailID, eMail, isOld FROM eMails WHERE personID = ?', [
      entfernen
    ])
  ])
  const mailSet = new Set(mailsB.map((m) => normEmail(m.eMail)))
  k.kontakteDoppelt.eMails = mailsE
    .filter((m) => mailSet.has(normEmail(m.eMail)))
    .map((m) => m.eMail)

  const [telB, telE] = await Promise.all([
    lese('SELECT telefonID, telefon, isOld FROM telefone WHERE personID = ?', [
      behalten
    ]),
    lese('SELECT telefonID, telefon, isOld FROM telefone WHERE personID = ?', [
      entfernen
    ])
  ])
  const telSet = new Set(
    telB.map((t) => normTelefon(t.telefon)).filter((v) => v)
  )
  k.kontakteDoppelt.telefone = telE
    .filter((t) => {
      const n = normTelefon(t.telefon)
      return n && telSet.has(n)
    })
    .map((t) => t.telefon)

  const [adrB, adrE] = await Promise.all([
    lese(
      'SELECT adressID, strasse, plz, ort, isOld FROM adressen WHERE personID = ?',
      [behalten]
    ),
    lese(
      'SELECT adressID, strasse, plz, ort, isOld FROM adressen WHERE personID = ?',
      [entfernen]
    )
  ])
  const adrSet = new Set(
    adrB.map((a) => normAdresse(a.strasse, a.plz, a.ort)).filter((v) => v)
  )
  k.kontakteDoppelt.adressen = adrE
    .filter((a) => {
      const n = normAdresse(a.strasse, a.plz, a.ort)
      return n && adrSet.has(n)
    })
    .map((a) => `${a.strasse}, ${a.plz} ${a.ort}`)

  // portalUser: UNIQUE(personID) -- zwei Zugaenge koennen nicht zu einer Person
  try {
    const pu = await lese(
      'SELECT personID FROM portalUser WHERE personID IN (?, ?)',
      [behalten, entfernen]
    )
    k.portalZugangBeide = pu.length === 2
  } catch {
    /* portalUser erst mit portal-schema.sql vorhanden */
  }

  /* ------------------------------------------------------------- Blocker -- */
  if (k.anmeldungenGleicheVeranstaltung.length > 0) {
    const namen = k.anmeldungenGleicheVeranstaltung
      .map((v) => `„${v.bezeichnung}"`)
      .join(', ')
    k.blocker.push(
      `Beide Personen sind zur selben Veranstaltung angemeldet (${namen}). ` +
        'Bitte zuerst eine der beiden Anmeldungen klären – welche gilt, lässt ' +
        'sich hier nicht entscheiden.'
    )
  }
  if (k.portalZugangBeide) {
    k.blocker.push(
      'Beide Personen haben einen Portal-Zugang. Zwei Zugänge bedeuten zwei ' +
        'Mailadressen und zwei Passwörter – bitte zuerst entscheiden, welcher ' +
        'bestehen bleibt, und den anderen deaktivieren.'
    )
  }
  k.mergeMoeglich = k.blocker.length === 0

  return k
}

/** Liest die Kollisionen ohne Transaktion, fuer die Vorschau. */
export function kollisionenVorschau(
  behalten: number,
  entfernen: number
): Promise<Kollisionen> {
  return analysiereKollisionen(
    (sql, params) => queryP(sql, (params ?? []) as unknown[]),
    behalten,
    entfernen
  )
}

/** Alle Stellen, an denen eine personID haengen kann. */
const REFERENZEN: Array<{ tabelle: string; spalte: string }> = [
  { tabelle: 'adressen', spalte: 'personID' },
  { tabelle: 'akPerson', spalte: 'personID' },
  { tabelle: 'anmeldungen', spalte: 'personID' },
  { tabelle: 'eMails', spalte: 'personID' },
  { tabelle: 'telefone', spalte: 'personID' },
  { tabelle: 'fz', spalte: 'personID' },
  { tabelle: 'fz', spalte: 'gesehenVon' },
  { tabelle: 'fzAntrag', spalte: 'personID' },
  { tabelle: 'juleica', spalte: 'personID' },
  { tabelle: 'tagsPersonen', spalte: 'personID' },
  { tabelle: 'dublikate', spalte: 'zielPersonID' },
  { tabelle: 'DSGVO_Person', spalte: 'personID' },
  { tabelle: 'users', spalte: 'person_id' },
  { tabelle: 'portalUser', spalte: 'personID' },
  { tabelle: 'ecKreis', spalte: 'fz_verantwortlicher_personID' },
  { tabelle: 'ecKreis', spalte: 'ortsverantwortlicher_personID' },
  { tabelle: 'keinedublikate', spalte: 'personID_1' },
  { tabelle: 'keinedublikate', spalte: 'personID_2' }
]

export async function mergePersonen(
  personID_behalten: number,
  personID_entfernen: number,
  opt: MergeOptionen = {}
): Promise<MergeErgebnis> {
  const behalten = Number(personID_behalten)
  const entfernen = Number(personID_entfernen)

  if (!Number.isInteger(behalten) || !Number.isInteger(entfernen)) {
    throw new ecError('Ungültige Personen-IDs.', 400)
  }
  if (behalten <= 0 || entfernen <= 0) {
    throw new ecError('Ungültige Personen-IDs.', 400)
  }
  if (behalten === entfernen) {
    throw new ecError(
      'Eine Person kann nicht mit sich selbst zusammengeführt werden.',
      400
    )
  }

  const loginStrategie: LoginStrategie = opt.loginStrategie ?? 'abbrechen'
  const anmeldungStrategie: AnmeldungStrategie =
    opt.anmeldungStrategie ?? 'abbrechen'

  const ergebnis = await withConnection<MergeErgebnis>(async (conn) => {
    const q = (sql: string, params: unknown[] = []) => conn.query(sql, params)
    const lese = leseVon(conn)
    const verschoben: Record<string, number> = {}
    const zusammengefasst: MergeErgebnis['zusammengefasst'] = []
    const zaehle = (t: string, n: number) => {
      if (n > 0) verschoben[t] = (verschoben[t] ?? 0) + n
    }

    /* ----------------------------------------------------- A Vorbedingungen */
    // FOR UPDATE serialisiert zwei gleichzeitige Merges auf denselben Saetzen.
    // Ohne das koennten beide die Referenzen verschieben und der zweite liefe
    // beim DELETE ins Leere.
    const saetze = await q(
      `SELECT personID, vorname, nachname,
              DATE_FORMAT(gebDat, '%Y-%m-%d') AS gebDatISO,
              ecKreis, ecMitglied, Notizen, erstellt, anonymisiert
         FROM personen
        WHERE personID IN (?, ?)
        FOR UPDATE`,
      [behalten, entfernen]
    )

    const satzBehalten = saetze.find((s: any) => s.personID === behalten)
    const satzEntfernen = saetze.find((s: any) => s.personID === entfernen)

    if (!satzEntfernen) {
      // Deckt den Doppelklick ab: der zweite Aufruf findet die Person nicht mehr.
      throw new ecError(
        `Person ${entfernen} existiert nicht (mehr) – möglicherweise wurde sie bereits zusammengeführt.`,
        404
      )
    }
    if (!satzBehalten) {
      throw new ecError(`Person ${behalten} existiert nicht.`, 404)
    }
    if (satzBehalten.anonymisiert === 1 || satzEntfernen.anonymisiert === 1) {
      // Die Daten eines anonymisierten Satzes wieder mit einer Person zu
      // verbinden waere ein Rueckschritt hinter eine bewusste Loeschung.
      throw new ecError(
        'Einer der beiden Datensätze ist anonymisiert und darf nicht zusammengeführt werden.',
        409
      )
    }

    /* ------------------------------------------------- B Kollisionsanalyse */
    const koll = await analysiereKollisionen(lese, behalten, entfernen)

    const anmeldungBlocker = koll.anmeldungenGleicheVeranstaltung.length > 0
    const darfAnmeldungLoesen = anmeldungStrategie === 'verwerfenAbgemeldet'
    const portalBlocker = koll.portalZugangBeide
    const darfPortalLoesen = loginStrategie !== 'abbrechen'

    if (anmeldungBlocker && !darfAnmeldungLoesen) {
      throw new ecError(koll.blocker[0], 409)
    }
    if (portalBlocker && !darfPortalLoesen) {
      throw new ecError(
        koll.blocker[koll.blocker.length - 1] ??
          'Beide Personen haben einen Portal-Zugang.',
        409
      )
    }

    /* --------------------------------------------------- C Kontakttabellen */
    // Muster je Tabelle: hat der bleibende Satz denselben Wert schon, ist die
    // Zeile des anderen redundant. Sie darf aber nicht einfach geloescht werden,
    // weil anmeldungen per Fremdschluessel darauf zeigt -- also erst die
    // Verweise umbiegen, dann loeschen. Das ersetzt die drei JOIN-UPDATEs der
    // alten Fassung samt ihrem Adress-Bug.
    // `norm` fasst SCHREIBVARIANTEN zusammen ("Musterstr." / "Musterstraße").
    // `indexSpalten` sind die Wertspalten des UNIQUE-Index -- daran entscheidet
    // sich, ob ein UPDATE ueberhaupt erlaubt ist.
    //
    // Beide werden gebraucht, und das ist keine Doppelung: die semantische
    // Normalisierung verwirft bewusst Werte ohne Beweiskraft (eine
    // fuenfstellige Durchwahl wie "222-20" liefert normTelefon als leer, damit
    // sie kein Dubletten-Signal wird). Fuer den Merge zaehlt das aber nicht --
    // dort verletzt genau diese Nummer den Index, wenn beide Saetze sie haben.
    // Genau daran ist ein Merge in Produktion mit ER_DUP_ENTRY gescheitert.
    const kontaktTabellen = [
      {
        tabelle: 'eMails',
        idSpalte: 'eMailID',
        fkSpalte: 'eMailID',
        felder: 'eMailID, eMail, isOld',
        norm: (r: any) => normEmail(r.eMail),
        indexSpalten: ['eMail'],
        indexWerte: (r: any) => [r.eMail]
      },
      {
        tabelle: 'telefone',
        idSpalte: 'telefonID',
        fkSpalte: 'telefonID',
        felder: 'telefonID, telefon, isOld',
        norm: (r: any) => normTelefon(r.telefon),
        indexSpalten: ['telefon'],
        indexWerte: (r: any) => [r.telefon]
      },
      {
        tabelle: 'adressen',
        idSpalte: 'adressID',
        fkSpalte: 'adressID',
        felder: 'adressID, strasse, plz, ort, isOld',
        norm: (r: any) => normAdresse(r.strasse, r.plz, r.ort),
        indexSpalten: ['strasse', 'plz', 'ort'],
        indexWerte: (r: any) => [r.strasse, r.plz, r.ort]
      }
    ]

    /**
     * Sucht die Zeile des Behalten-Satzes, die einem UPDATE im Weg staende.
     *
     * Bewusst per SQL statt per Vergleich in JS: der Index entscheidet nach der
     * Collation der Spalte (utf8_general_ci ist case-insensitiv und behandelt
     * auch "ä" und "a" als gleich). Das in JS nachzubauen waere geraten -- die
     * Datenbank weiss es genau.
     */
    const indexTreffer = async (
      t: (typeof kontaktTabellen)[number],
      zeile: any
    ): Promise<any | undefined> => {
      const bedingung = t.indexSpalten
        .map((s) => `\`${s}\` <=> ?`)
        .join(' AND ')
      const treffer = await q(
        `SELECT ${t.felder} FROM \`${t.tabelle}\`
          WHERE personID = ? AND ${bedingung}
          LIMIT 1`,
        [behalten, ...t.indexWerte(zeile)]
      )
      return treffer[0]
    }

    for (const t of kontaktTabellen) {
      const zeilenB = await q(
        `SELECT ${t.felder} FROM \`${t.tabelle}\` WHERE personID = ?`,
        [behalten]
      )
      const zeilenE = await q(
        `SELECT ${t.felder} FROM \`${t.tabelle}\` WHERE personID = ?`,
        [entfernen]
      )

      const vorhanden = new Map<string, any>()
      for (const z of zeilenB) {
        const n = t.norm(z)
        if (n) vorhanden.set(n, z)
      }

      let verschobenN = 0
      let zusammengefasstN = 0

      for (const z of zeilenE) {
        const n = t.norm(z)
        // Erst die semantische Gleichheit (fasst Schreibvarianten zusammen),
        // dann die Frage an den Index: wuerde das UPDATE kollidieren? Ohne den
        // zweiten Schritt laeuft der Merge bei Werten, die `norm` verwirft, in
        // ein ER_DUP_ENTRY.
        const gegenstueck =
          (n ? vorhanden.get(n) : undefined) ?? (await indexTreffer(t, z))

        if (!gegenstueck) {
          await q(
            `UPDATE \`${t.tabelle}\` SET personID = ? WHERE \`${t.idSpalte}\` = ?`,
            [behalten, z[t.idSpalte]]
          )
          verschobenN++
          continue
        }

        // Verweise aus anmeldungen auf die bleibende Zeile umbiegen ...
        await q(
          `UPDATE anmeldungen SET \`${t.fkSpalte}\` = ? WHERE \`${t.fkSpalte}\` = ?`,
          [gegenstueck[t.idSpalte], z[t.idSpalte]]
        )
        // ... dann die redundante Zeile entfernen.
        await q(`DELETE FROM \`${t.tabelle}\` WHERE \`${t.idSpalte}\` = ?`, [
          z[t.idSpalte]
        ])
        // Die juengere Information gewinnt: war die entfernte Zeile aktuell und
        // die bleibende als alt markiert, ist der Wert offenbar noch in Gebrauch.
        if (z.isOld === 0 && gegenstueck.isOld === 1) {
          await q(
            `UPDATE \`${t.tabelle}\` SET isOld = 0 WHERE \`${t.idSpalte}\` = ?`,
            [gegenstueck[t.idSpalte]]
          )
        }
        zusammengefasstN++
      }

      zaehle(t.tabelle, verschobenN)
      if (zusammengefasstN > 0) {
        zusammengefasst.push({
          tabelle: t.tabelle,
          anzahl: zusammengefasstN,
          grund: 'gleicher Wert bei beiden Datensätzen'
        })
      }
    }

    /* ------------------------------------------------------- D anmeldungen */
    if (anmeldungBlocker && darfAnmeldungLoesen) {
      // Nur abgemeldete Anmeldungen ohne Geldbewegung duerfen weg. Alles andere
      // traegt Zahlungen und Gesundheitsangaben und wird nicht im Rahmen einer
      // Dublettenpflege stillschweigend entsorgt.
      for (const v of koll.anmeldungenGleicheVeranstaltung) {
        const loeschbar = await q(
          `SELECT anmeldeID FROM anmeldungen
            WHERE personID = ? AND veranstaltungsID = ?
              AND abmeldeZeitpunkt IS NOT NULL
              AND bisherBezahlt = 0 AND rueckbezahlt = 0`,
          [entfernen, v.veranstaltungsID]
        )
        if (loeschbar.length === 0) {
          throw new ecError(
            `Die doppelte Anmeldung zu „${v.bezeichnung}" kann nicht verworfen ` +
              'werden: sie ist nicht abgemeldet oder es sind Zahlungen erfasst.',
            409
          )
        }
        for (const a of loeschbar) {
          await q('DELETE FROM anmeldungen WHERE anmeldeID = ?', [a.anmeldeID])
        }
        zusammengefasst.push({
          tabelle: 'anmeldungen',
          anzahl: loeschbar.length,
          grund: `abgemeldete Doppelanmeldung zu „${v.bezeichnung}" verworfen`
        })
      }
    }

    const restAnmeldungen = await q(
      'SELECT anmeldeID FROM anmeldungen WHERE personID = ?',
      [entfernen]
    )
    for (const a of restAnmeldungen) {
      await q('UPDATE anmeldungen SET personID = ? WHERE anmeldeID = ?', [
        behalten,
        a.anmeldeID
      ])
    }
    zaehle('anmeldungen', restAnmeldungen.length)

    /* ----------------------------------------------------- E Mengentabellen */
    // Vereinigen statt verlieren: vorhandene Kombinationen bleiben, der Rest
    // zieht um. `ON DUPLICATE KEY UPDATE spalte = VALUES(spalte)` setzt den
    // Wert auf sich selbst und macht das INSERT bei Kollision damit wirkungslos.
    // `spalte = tabelle.spalte` waere hier nicht moeglich: Quell- und Zieltabelle
    // sind dieselbe, der Bezug also mehrdeutig (ER_NON_UNIQ_ERROR).
    const tagsVorher = await q(
      'SELECT COUNT(*) n FROM tagsPersonen WHERE personID = ?',
      [entfernen]
    )
    await q(
      `INSERT INTO tagsPersonen (tagID, personID, notiz)
            SELECT tagID, ?, notiz FROM tagsPersonen WHERE personID = ?
       ON DUPLICATE KEY UPDATE tagID = VALUES(tagID)`,
      [behalten, entfernen]
    )
    await q('DELETE FROM tagsPersonen WHERE personID = ?', [entfernen])
    zaehle('tagsPersonen', Number(tagsVorher[0]?.n ?? 0))
    if (koll.tagsDoppelt.length > 0) {
      zusammengefasst.push({
        tabelle: 'tagsPersonen',
        anzahl: koll.tagsDoppelt.length,
        grund: 'Tag war bei beiden Datensätzen gesetzt'
      })
    }

    const akVorher = await q(
      'SELECT COUNT(*) n FROM akPerson WHERE personID = ?',
      [entfernen]
    )
    await q(
      `INSERT INTO akPerson (personID, akID, date, neuerStatus)
            SELECT ?, akID, date, neuerStatus FROM akPerson WHERE personID = ?
       ON DUPLICATE KEY UPDATE akID = VALUES(akID)`,
      [behalten, entfernen]
    )
    await q('DELETE FROM akPerson WHERE personID = ?', [entfernen])
    zaehle('akPerson', Number(akVorher[0]?.n ?? 0))
    if (koll.akGleicherTagUndAk.length > 0) {
      zusammengefasst.push({
        tabelle: 'akPerson',
        anzahl: koll.akGleicherTagUndAk.length,
        grund: 'derselbe Arbeitskreis am selben Tag'
      })
    }

    const dsgvoVorher = await q(
      'SELECT COUNT(*) n FROM DSGVO_Person WHERE personID = ?',
      [entfernen]
    )
    await q(
      `INSERT INTO DSGVO_Person (personID, dseID, ts)
            SELECT ?, dseID, ts FROM DSGVO_Person WHERE personID = ?
       ON DUPLICATE KEY UPDATE dseID = VALUES(dseID)`,
      [behalten, entfernen]
    )
    await q('DELETE FROM DSGVO_Person WHERE personID = ?', [entfernen])
    zaehle('DSGVO_Person', Number(dsgvoVorher[0]?.n ?? 0))

    /* ------------------------------------------------- F Einfache Referenzen */
    const einfach: Array<[string, string]> = [
      ['fz', 'personID'],
      ['fz', 'gesehenVon'],
      ['fzAntrag', 'personID'],
      ['juleica', 'personID'],
      ['dublikate', 'zielPersonID'],
      // Ab hier die Stellen, die der alte Merge uebersah:
      ['users', 'person_id'],
      ['ecKreis', 'fz_verantwortlicher_personID'],
      ['ecKreis', 'ortsverantwortlicher_personID']
    ]
    for (const [tabelle, spalte] of einfach) {
      const res: any = await q(
        `UPDATE \`${tabelle}\` SET \`${spalte}\` = ? WHERE \`${spalte}\` = ?`,
        [behalten, entfernen]
      )
      zaehle(tabelle, res?.affectedRows ?? 0)
    }

    /* ------------------------------------------------------- G portalUser */
    try {
      const pu = await q(
        'SELECT portalUserID, personID FROM portalUser WHERE personID IN (?, ?)',
        [behalten, entfernen]
      )
      const puBehalten = pu.find((r: any) => r.personID === behalten)
      const puEntfernen = pu.find((r: any) => r.personID === entfernen)

      if (puEntfernen && !puBehalten) {
        await q('UPDATE portalUser SET personID = ? WHERE personID = ?', [
          behalten,
          entfernen
        ])
        zaehle('portalUser', 1)
      } else if (puEntfernen && puBehalten) {
        // Hierher kommt man nur mit ausdruecklicher Strategie (sonst 409 oben).
        const wegID =
          loginStrategie === 'uebernehmen'
            ? puBehalten.portalUserID
            : puEntfernen.portalUserID
        const bleibtPersonID =
          loginStrategie === 'uebernehmen' ? entfernen : null

        await q('DELETE FROM portalToken WHERE portalUserID = ?', [wegID])
        await q('DELETE FROM portalUser WHERE portalUserID = ?', [wegID])
        if (bleibtPersonID !== null) {
          await q('UPDATE portalUser SET personID = ? WHERE personID = ?', [
            behalten,
            entfernen
          ])
        }
        zusammengefasst.push({
          tabelle: 'portalUser',
          anzahl: 1,
          grund:
            loginStrategie === 'uebernehmen'
              ? 'Zugang des entfernten Datensatzes übernommen'
              : 'Zugang des entfernten Datensatzes verworfen'
        })
      }
    } catch (err) {
      // Tabelle fehlt (portal-schema.sql nicht eingespielt) -> nichts zu tun.
      if (
        !/doesn't exist|Unknown table/i.test(String((err as Error).message))
      ) {
        throw err
      }
    }

    /* --------------------------------------------------- H keinedublikate */
    // Ohne diesen Schritt taucht ein als "kein Duplikat" markiertes Paar nach
    // dem Merge wieder auf, weil die Markierung auf die geloeschte ID zeigt.
    const keine = await q(
      `SELECT personID_1, personID_2, markiert_von, notiz
         FROM keinedublikate
        WHERE personID_1 = ? OR personID_2 = ?`,
      [entfernen, entfernen]
    )
    let keineUmgezogen = 0
    for (const z of keine) {
      const partner = z.personID_1 === entfernen ? z.personID_2 : z.personID_1
      if (partner === behalten) continue // Selbstpaar, faellt weg
      const { klein, gross } = paarKey(behalten, partner)
      await q(
        `INSERT INTO keinedublikate (personID_1, personID_2, markiert_von, notiz)
              VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE notiz = VALUES(notiz)`,
        [klein, gross, z.markiert_von ?? 0, z.notiz ?? '']
      ).catch(async (err: Error) => {
        // Ohne dubletten-schema.sql fehlen markiert_von und notiz.
        if (/Unknown column/i.test(err.message)) {
          await q(
            `INSERT IGNORE INTO keinedublikate (personID_1, personID_2)
                  VALUES (?, ?)`,
            [klein, gross]
          )
        } else throw err
      })
      keineUmgezogen++
    }
    await q(
      'DELETE FROM keinedublikate WHERE personID_1 = ? OR personID_2 = ?',
      [entfernen, entfernen]
    )
    zaehle('keinedublikate', keineUmgezogen)

    /* ------------------------------------------------------- I Stammdaten */
    // Der bleibende Satz gewinnt, mit drei Ausnahmen, bei denen sonst
    // Information verloren geht.
    const updates: string[] = []
    const werte: unknown[] = []

    if (satzBehalten.ecKreis === null && satzEntfernen.ecKreis !== null) {
      updates.push('ecKreis = ?')
      werte.push(satzEntfernen.ecKreis)
    }
    const notizAlt = String(satzEntfernen.Notizen ?? '').trim()
    if (notizAlt) {
      const notizNeu = String(satzBehalten.Notizen ?? '')
      updates.push('Notizen = ?')
      werte.push(
        `${notizNeu}${notizNeu ? '\n' : ''}-- aus zusammengeführtem Datensatz #${entfernen} --\n${notizAlt}`
      )
    }
    if (satzEntfernen.erstellt && satzBehalten.erstellt) {
      const eB = new Date(satzBehalten.erstellt).getTime()
      const eE = new Date(satzEntfernen.erstellt).getTime()
      if (eE < eB) {
        updates.push('erstellt = ?')
        werte.push(satzEntfernen.erstellt)
      }
    }
    if (updates.length > 0) {
      await q(`UPDATE personen SET ${updates.join(', ')} WHERE personID = ?`, [
        ...werte,
        behalten
      ])
    }

    /* ------------------------------------------------------ J Alias-Eintrag */
    // Dieser Eintrag ist der Grund, warum Website und Portal nach dem Merge
    // nicht sofort wieder eine Dublette unter der alten Schreibweise anlegen:
    // beide schlagen den Namen in `dublikate` nach, wenn sie keine Person
    // finden. Explizite Spaltenliste (das alte spaltenlose INSERT bricht,
    // sobald die Tabelle eine Spalte bekommt) und ON DUPLICATE KEY UPDATE gegen
    // den Primaerschluessel (vorname, nachname, gebDat), der beim zweiten Merge
    // derselben Namenskombination sonst mitten im Vorgang zuschlaegt.
    // Laeuft NACH Schritt F, damit das Umbiegen alter Aliase diesen Eintrag
    // nicht ueberschreibt.
    await q(
      `INSERT INTO dublikate (vorname, nachname, gebDat, zielPersonID)
            VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE zielPersonID = VALUES(zielPersonID)`,
      [
        satzEntfernen.vorname,
        satzEntfernen.nachname,
        satzEntfernen.gebDatISO,
        behalten
      ]
    )

    /* -------------------------------------------------- K Sicherheitsnetz */
    // Zaehlt alle bekannten Referenzstellen. Bleibt irgendwo etwas haengen,
    // wird die gesamte Transaktion zurueckgerollt statt einen halb gemergten
    // Zustand zu hinterlassen -- genau das war das Verhalten der alten Fassung.
    // DIESE LISTE MITPFLEGEN, wenn eine neue Tabelle auf personen verweist.
    for (const r of REFERENZEN) {
      try {
        const res = await q(
          `SELECT COUNT(*) n FROM \`${r.tabelle}\` WHERE \`${r.spalte}\` = ?`,
          [entfernen]
        )
        const n = Number(res[0]?.n ?? 0)
        if (n > 0) {
          throw new ecError(
            `Zusammenführen abgebrochen: in ${r.tabelle}.${r.spalte} verweisen ` +
              `noch ${n} Datensätze auf Person ${entfernen}. Es wurde nichts geändert.`,
            409
          )
        }
      } catch (err) {
        if (err instanceof ecError) throw err
        // Tabelle/Spalte gibt es in dieser Datenbank nicht -- ueberspringen.
        if (
          !/doesn't exist|Unknown table|Unknown column/i.test(
            String((err as Error).message)
          )
        ) {
          throw err
        }
      }
    }

    /* ------------------------------------------------------------ L Loeschen */
    await q('DELETE FROM personen WHERE personID = ?', [entfernen])

    /* ---------------------------------------------------------- M Protokoll */
    // In derselben Transaktion: ein zurueckgerollter Merge darf keinen
    // Log-Eintrag hinterlassen. Nur IDs und Kurzfassung, keine Personendaten
    // (gleiche Regel wie portalAudit).
    const anmerkung = [
      zusammengefasst.map((z) => `${z.tabelle}:${z.anzahl}`).join(' '),
      koll.blocker.length ? `blocker-geloest:${koll.blocker.length}` : ''
    ]
      .filter((v) => v)
      .join(' | ')
    await q(
      `INSERT INTO dublettenLog
         (user_id, aktion, personID_behalten, personID_entfernt, score, anmerkung)
       VALUES (?, 'merge', ?, ?, ?, ?)`,
      [
        opt.durchgefuehrtVon ?? 0,
        behalten,
        entfernen,
        opt.score ?? 0,
        anmerkung.slice(0, 500)
      ]
    ).catch((err: Error) => {
      // Ohne dubletten-schema.sql gibt es die Tabelle nicht. Das ist kein Grund,
      // einen fachlich korrekten Merge zurueckzurollen.
      if (!/doesn't exist|Unknown table/i.test(err.message)) throw err
      console.warn(
        '[dubletten] dublettenLog fehlt – Merge protokolliert nicht. ' +
          'sql/dubletten-schema.sql einspielen.'
      )
    })

    return {
      behalten,
      entfernt: entfernen,
      verschoben,
      zusammengefasst,
      aliasEingetragen: true
    }
  }).catch((err: unknown) => {
    // Fachliche Fehler tragen bereits eine verstaendliche Meldung.
    if (err instanceof ecError) throw err
    // Alles andere ist ein Fehler von uns, aber der rohe Datenbanktext
    // ("ER_DUP_ENTRY: Duplicate entry '222-20' for key 'telefon'") landete
    // sonst ungefiltert im Dialog der Sachbearbeiterin. Die Transaktion ist an
    // dieser Stelle bereits zurueckgerollt, es ist also nichts halb passiert --
    // genau das soll die Meldung auch sagen.
    const text = String((err as Error)?.message ?? err)
    if (/ER_DUP_ENTRY/i.test(text)) {
      throw new ecError(
        'Zusammenführen abgebrochen: die beiden Datensätze haben einen Wert, ' +
          'den die Datenbank nur einmal je Person erlaubt, und er ließ sich ' +
          'nicht automatisch zusammenfassen. Es wurde nichts geändert. ' +
          `(technisch: ${text})`,
        409
      )
    }
    throw err
  })

  // Erst nach erfolgreichem Commit: der Cache darf nicht verworfen werden,
  // wenn die Transaktion gescheitert ist.
  invalidiere()
  return ergebnis
}
