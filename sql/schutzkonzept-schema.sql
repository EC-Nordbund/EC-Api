-- Schutzkonzept: Formular-Builder (Portal) und Ausfuell-System der EC-Kreise
--
-- Idempotent (MariaDB 10.5): kann mehrfach eingespielt werden.
-- Setzt sql/portal-schema.sql voraus (portalUser, ecKreis-Spalten).
--
-- Dev (bestehendes Volume):
--   cd dev && docker compose exec -T mysql mysql -uroot -proot ecnordbund < ../EC-Api/sql/schutzkonzept-schema.sql
-- Prod: DIES IST DIE EINZIGE SQL-DATEI DES SCHUTZKONZEPT-MODULS. Am Stueck
--       einspielen, VOR dem API-Deploy:
--         mysql -u<user> -p ecnordbund < schutzkonzept-schema.sql
--       Die Datei legt Trigger an. Dafuer braucht der Benutzer das Recht
--       TRIGGER; bei aktivem Binlog zusaetzlich SUPER oder
--       log_bin_trust_function_creators=1. Fehlt ein Objekt (auch ein
--       Trigger), antworten die Schutzkonzept-Routen mit 503; die API prueft
--       alle 30 s neu, ein Neustart nach dem Einspielen ist nicht noetig.
--
--       DEFINER: Die Trigger stehen ohne DEFINER-Klausel, MariaDB traegt den
--       einspielenden Benutzer ein -- und ein Trigger laeuft fuer immer mit
--       dessen Rechten. Wird dieses Konto spaeter geloescht oder umbenannt
--       (Personalwechsel, Dump auf einem anderen Server eingespielt), bricht
--       jedes UPDATE/DELETE auf skKreisStand, skFormularVersion, skVorlage
--       und jedes INSERT in skKreisPdf mit ERROR 1449 ab ("definer does not
--       exist"); Speichern und Veroeffentlichen sind dann tot, die
--       Schema-Pruefung der API merkt nichts. Deshalb als DAUERHAFTES Konto
--       einspielen (am besten der DB-Benutzer der API, sofern er TRIGGER
--       hat), nie als persoenliches Konto. Die Kontrolle am Dateiende zeigt
--       den eingetragenen DEFINER. Vor dem Loeschen eines Kontos oder nach
--       einem Restore aus einem Dump (mysqldump schreibt DEFINER=`user`@`host`
--       hinein): Trigger mit DROP TRIGGER entfernen und die Datei als dem
--       richtigen Benutzer erneut einspielen (idempotent), oder DEFINER im
--       Dump vor dem Einspielen ersetzen.
--
--       BACKUP: mysqldump nimmt Trigger nur mit, wenn der Backup-Benutzer das
--       Recht TRIGGER hat -- sonst fehlen sie ohne Warnung im Dump. Nach
--       jedem Restore die Selbstkontrolle unten pruefen (Trigger 10 erwartet)
--       bzw. die Datei erneut einspielen.
--
-- Versionierung in einem Satz: eine Zeile mit status='published' ist
-- eingefroren. Das erzwingt nicht nur der API-Code, sondern auch die
-- Datenbank selbst (Trigger unten) -- ein vergessenes WHERE in einem kuenftigen
-- UPDATE kann eine veroeffentlichte Fassung nicht mehr veraendern.
--
-- JSON liegt in LONGTEXT (MariaDB-JSON ist ohnehin nur ein LONGTEXT-Alias),
-- DOCX- und PDF-Dateien liegen als LONGBLOB direkt in der DB.
-- Keine Foreign Keys, wie im restlichen Schema.

-- ---------------------------------------------------------------------------
-- Globale Verantwortung "Schutzkonzept-Verwalter" am Portal-Zugang.
-- ---------------------------------------------------------------------------
ALTER TABLE `portalUser`
  ADD COLUMN IF NOT EXISTS `is_schutzkonzept_verwalter` tinyint(1) NOT NULL DEFAULT 0
    AFTER `is_superuser`;

-- ---------------------------------------------------------------------------
-- Schutzkonzept-E-Mails eines EC-Kreises. Wer hier steht, bekommt einen
-- Login-Code und darf das Schutzkonzept dieses Kreises bearbeiten.
-- Gepflegt in der Verwaltung (EC-Kreise).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `skKreisEmail` (
  `skKreisEmailID` int(11) NOT NULL AUTO_INCREMENT,
  `ecKreisID`      int(11) NOT NULL,
  `email`          varchar(255) COLLATE utf8mb4_bin NOT NULL COMMENT 'kleingeschrieben, getrimmt',
  `erstellt`       timestamp NOT NULL DEFAULT current_timestamp(),
  `erstellt_von`   int(11) NOT NULL DEFAULT 0 COMMENT 'users.user_id der Verwaltung',
  PRIMARY KEY (`skKreisEmailID`),
  UNIQUE KEY `kreis_email` (`ecKreisID`, `email`),
  KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Versionen des (einen) Schutzkonzept-Formulars.
-- `definition` ist der Baum aus Bereichen, Abschnitten und Feldern (JSON).
-- `draft_lock` ist nur fuer Drafts gesetzt; der UNIQUE-Index erlaubt damit
-- hoechstens einen offenen Draft.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `skFormularVersion` (
  `formularVersionID`     int(11) NOT NULL AUTO_INCREMENT,
  `versionNr`             int(11) NOT NULL,
  `status`                enum('draft','published') NOT NULL DEFAULT 'draft',
  `definition`            longtext NOT NULL COMMENT 'JSON: {bereiche:[{abschnitte:[{felder}]}]}',
  `notiz`                 varchar(1000) NOT NULL DEFAULT '' COMMENT 'Aenderungsnotiz dieser Version',
  `basiert_auf_versionID` int(11) DEFAULT NULL,
  `revision`              int(11) NOT NULL DEFAULT 0 COMMENT 'optimistische Sperre, +1 je Speichern',
  `erstellt`              timestamp NOT NULL DEFAULT current_timestamp(),
  `erstellt_von`          int(11) NOT NULL COMMENT 'portalUser.portalUserID',
  `geaendert`             timestamp NOT NULL DEFAULT current_timestamp(),
  `published_am`          timestamp NULL DEFAULT NULL,
  `published_von`         int(11) DEFAULT NULL,
  `draft_lock`            tinyint(1) AS (IF(`status` = 'draft', 1, NULL)) PERSISTENT,
  PRIMARY KEY (`formularVersionID`),
  UNIQUE KEY `versionNr` (`versionNr`),
  UNIQUE KEY `draft_lock` (`draft_lock`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- DOCX-Vorlagen je Formularversion. Beim Anlegen einer neuen Version werden
-- die Zeilen kopiert, damit jede Version ihren eigenen, unveraenderlichen
-- Satz Vorlagen hat.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `skVorlage` (
  `vorlageID`         int(11) NOT NULL AUTO_INCREMENT,
  `formularVersionID` int(11) NOT NULL,
  `bezeichnung`       varchar(200) NOT NULL,
  `dateiname`         varchar(255) NOT NULL,
  `sortierung`        int(11) NOT NULL DEFAULT 0,
  `inhalt`            longblob NOT NULL,
  `sha256`            char(64) NOT NULL,
  `groesse`           int(11) NOT NULL,
  `platzhalter`       longtext NOT NULL COMMENT 'JSON: in der DOCX gefundene Variablennamen',
  `erstellt`          timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`vorlageID`),
  KEY `formularVersionID` (`formularVersionID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Staende eines EC-Kreises. Jeder Stand haengt an genau einer
-- Formularversion. `daten` ist flach: { key: wert }, einzige Ausnahme sind
-- Tabellen-Felder (Array aus flachen Objekten).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `skKreisStand` (
  `standID`              int(11) NOT NULL AUTO_INCREMENT,
  `ecKreisID`            int(11) NOT NULL,
  `formularVersionID`    int(11) NOT NULL,
  `versionNr`            int(11) NOT NULL COMMENT 'fortlaufend je Kreis',
  `status`               enum('draft','published') NOT NULL DEFAULT 'draft',
  `daten`                longtext NOT NULL COMMENT 'JSON, flach',
  `fortschritt`          tinyint(3) NOT NULL DEFAULT 0 COMMENT 'Prozent',
  `bereiche_gespeichert` longtext NOT NULL COMMENT 'JSON: Liste der Bereich-IDs',
  `basiert_auf_standID`  int(11) DEFAULT NULL,
  `revision`             int(11) NOT NULL DEFAULT 0,
  `erstellt`             timestamp NOT NULL DEFAULT current_timestamp(),
  `erstellt_von`         varchar(255) NOT NULL COMMENT 'E-Mail oder portal:<portalUserID>',
  `geaendert`            timestamp NOT NULL DEFAULT current_timestamp(),
  `geaendert_von`        varchar(255) NOT NULL,
  `published_am`         timestamp NULL DEFAULT NULL,
  `published_von`        varchar(255) DEFAULT NULL,
  `draft_lock`           int(11) AS (IF(`status` = 'draft', `ecKreisID`, NULL)) PERSISTENT,
  PRIMARY KEY (`standID`),
  UNIQUE KEY `kreis_version` (`ecKreisID`, `versionNr`),
  UNIQUE KEY `draft_lock` (`draft_lock`),
  KEY `formularVersionID` (`formularVersionID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Beim Veroeffentlichen erzeugte PDFs, eine Zeile je Vorlage.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `skKreisPdf` (
  `pdfID`     int(11) NOT NULL AUTO_INCREMENT,
  `standID`   int(11) NOT NULL,
  `vorlageID` int(11) NOT NULL,
  `dateiname` varchar(255) NOT NULL,
  `inhalt`    longblob NOT NULL,
  `groesse`   int(11) NOT NULL,
  `erstellt`  timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`pdfID`),
  UNIQUE KEY `stand_vorlage` (`standID`, `vorlageID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Einmal-Codes: 6-stelliger Login-Code per Mail (HMAC mit dem Secret) und
-- Uebergabe-Token aus dem Portal (sha256). Kein Code liegt im Klartext vor.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `skLoginCode` (
  `codeID`       int(11) NOT NULL AUTO_INCREMENT,
  `zweck`        enum('login','uebergabe') NOT NULL,
  `email`        varchar(255) COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'nur zweck=login',
  `portalUserID` int(11) DEFAULT NULL COMMENT 'nur zweck=uebergabe',
  `ecKreisID`    int(11) DEFAULT NULL COMMENT 'nur zweck=uebergabe',
  `code_hash`    char(64) NOT NULL,
  `erstellt`     timestamp NOT NULL DEFAULT current_timestamp(),
  `gueltig_bis`  timestamp NOT NULL,
  `versuche`     int(11) NOT NULL DEFAULT 0,
  `benutzt_am`   timestamp NULL DEFAULT NULL,
  `ip`           varchar(45) NOT NULL DEFAULT '',
  PRIMARY KEY (`codeID`),
  KEY `email` (`email`),
  KEY `code_hash` (`code_hash`),
  KEY `gueltig_bis` (`gueltig_bis`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Uebergabe-Links merken sich die Sitzungs-Generation des Portal-Zugangs:
-- ein Passwort-Reset (token_gen + 1) entwertet auch noch nicht eingeloeste
-- Links. Nachtraeglich, damit bestehende Installationen die Spalte bekommen.
ALTER TABLE `skLoginCode`
  ADD COLUMN IF NOT EXISTS `token_gen` int(11) DEFAULT NULL
    COMMENT 'nur zweck=uebergabe: portalUser.token_gen beim Erzeugen'
    AFTER `ecKreisID`;

-- ---------------------------------------------------------------------------
-- Falsche Login-Codes je Adresse -- ueber alle Codes hinweg, damit ein neu
-- angeforderter Code keine frischen Rateversuche bringt. Limits in
-- src/schutzkonzept/config.ts. Zeilen fuer unbekannte Adressen gehoeren dazu
-- (sonst verriete die Sperre, welche Adressen hinterlegt sind).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `skLoginFehlversuch` (
  `fehlversuchID` int(11) NOT NULL AUTO_INCREMENT,
  `email`         varchar(255) COLLATE utf8mb4_bin NOT NULL,
  `ip`            varchar(45) NOT NULL DEFAULT '',
  `ts`            timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`fehlversuchID`),
  KEY `email_ts` (`email`, `ts`),
  KEY `ts` (`ts`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Audit-Spur des Schutzkonzept-Systems. Nur Kennungen, keine Inhalte.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `skAudit` (
  `skAuditID` int(11) NOT NULL AUTO_INCREMENT,
  `ts`        timestamp NOT NULL DEFAULT current_timestamp(),
  `akteur`    varchar(255) NOT NULL COMMENT 'E-Mail oder portal:<portalUserID>',
  `aktion`    varchar(50) NOT NULL,
  `ziel`      varchar(100) NOT NULL DEFAULT '',
  `ip`        varchar(45) NOT NULL DEFAULT '',
  PRIMARY KEY (`skAuditID`),
  KEY `ts` (`ts`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- E-Mail-Spalten binaer vergleichen. Die Standard-Collation utf8mb4_general_ci
-- haelt 'a' und 'ä' (auch 's' und 'ſ') fuer gleich: Wer die IDN-Domain
-- ec-nördbund.de besitzt, bekam mit jugend@ec-nördbund.de den Login-Code
-- der hinterlegten Adresse jugend@ec-nordbund.de -- der Vergleich traf, die
-- Mail ging an die Variante. Die Adresse ist ohnehin kleingeschrieben
-- gespeichert (normalisiereEmail), eine Collation ohne Akzentgleichheit
-- verliert also nichts. Fuer bestehende Installationen nachtraeglich; die
-- Abfragen in auth.ts sagen zusaetzlich `COLLATE utf8mb4_bin`, damit ein
-- nicht migriertes Schema den Fehler nicht wieder oeffnet.
-- ---------------------------------------------------------------------------
ALTER TABLE `skKreisEmail`
  MODIFY `email` varchar(255) COLLATE utf8mb4_bin NOT NULL COMMENT 'kleingeschrieben, getrimmt';
ALTER TABLE `skLoginCode`
  MODIFY `email` varchar(255) COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'nur zweck=login';
ALTER TABLE `skLoginFehlversuch`
  MODIFY `email` varchar(255) COLLATE utf8mb4_bin NOT NULL;

-- ---------------------------------------------------------------------------
-- Abschnitte bestaetigen (Feature 3). Liste der bestaetigten Abschnitt-IDs
-- als JSON -- bewusst NICHT in `daten`: die Daten bleiben flach und sind nur
-- Antworten. Ein neuer Draft startet mit '[]' (Antworten werden uebernommen,
-- Bestaetigungen nicht). Der Trigger skKreisStand_bu friert die Spalte mit
-- dem Stand ein; das Portal kann so nachlesen, was bestaetigt war.
-- ---------------------------------------------------------------------------
ALTER TABLE `skKreisStand`
  ADD COLUMN IF NOT EXISTS `abschnitte_bestaetigt` longtext NOT NULL DEFAULT '[]'
    COMMENT 'JSON: Liste bestaetigter Abschnitt-IDs (definition.ts abschnittsHash)'
    AFTER `bereiche_gespeichert`;

-- ---------------------------------------------------------------------------
-- Zaehler fuer die Stand-Nummer je Kreis.
--
-- Bis 09/2026 war die naechste Nummer MAX(versionNr)+1 ueber die noch
-- vorhandenen Zeilen. Ein verworfener Draft wird aber GELOESCHT, und die
-- Nummer stand da schon in Entwurfs-PDFs ("ENTWURF ... Stand 2"), die der
-- Kreis herumgeschickt hat. Der naechste Draft bekam dieselbe Nummer mit
-- anderem Inhalt. Der Zaehler zaehlt monoton, unabhaengig von geloeschten
-- Zeilen; stand.ts erhoeht ihn in derselben Transaktion wie den INSERT
-- (INSERT ... ON DUPLICATE KEY UPDATE sperrt die Zeile bis zum Commit).
--
-- Ohne Zeile faellt stand.ts auf MAX(versionNr) zurueck und legt sie an;
-- das Seed darunter macht bestehende Installationen trotzdem gleich
-- vollstaendig (und ist bei Wiederholung wirkungslos).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `skKreisZaehler` (
  `ecKreisID`        int(11) NOT NULL,
  `letzte_versionNr` int(11) NOT NULL DEFAULT 0 COMMENT 'zuletzt vergebene skKreisStand.versionNr',
  PRIMARY KEY (`ecKreisID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `skKreisZaehler` (`ecKreisID`, `letzte_versionNr`)
  SELECT `ecKreisID`, MAX(`versionNr`) FROM `skKreisStand` GROUP BY `ecKreisID`
  ON DUPLICATE KEY UPDATE `letzte_versionNr` = GREATEST(`letzte_versionNr`, VALUES(`letzte_versionNr`));

-- ---------------------------------------------------------------------------
-- Dasselbe fuer die Formularversion (formular.ts neueVersion / verwirfVersion,
-- naechsteFormularVersionNr). Genau eine Zeile (id = 1).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `skFormularZaehler` (
  `id`               tinyint(1) NOT NULL DEFAULT 1,
  `letzte_versionNr` int(11) NOT NULL DEFAULT 0 COMMENT 'zuletzt vergebene skFormularVersion.versionNr',
  PRIMARY KEY (`id`),
  CONSTRAINT `skFormularZaehler_eine_zeile` CHECK (`id` = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `skFormularZaehler` (`id`, `letzte_versionNr`)
  SELECT 1, COALESCE(MAX(`versionNr`), 0) FROM `skFormularVersion`
  ON DUPLICATE KEY UPDATE `letzte_versionNr` = GREATEST(`letzte_versionNr`, VALUES(`letzte_versionNr`));

-- ---------------------------------------------------------------------------
-- Erinnerungs-Protokoll (Feature 2): eine Zeile je verschickter Stufe eines
-- Datumsfelds (feld.erinnerung in der Formulardefinition). Geschrieben vom
-- taeglichen Job in src/schutzkonzept/erinnerung.ts, NACH dem Versand.
--
-- Der UNIQUE-Index ist die harte Sperre gegen Doppelversand: zwei parallele
-- Laeufe (Job + Test-Route) koennen dieselbe Stufe nicht zweimal eintragen.
-- Der Job prueft zusaetzlich VOR dem Versand je Kreis, ob die Stufe fuer
-- (feld_key, zeile, datum) schon protokolliert ist -- ueber alle Staende des
-- Kreises hinweg, damit ein neu veroeffentlichter Stand mit unveraendertem
-- Datum die Mail nicht ein zweites Mal ausloest.
--
-- feld_key: Key des Datumsfelds; bei Tabellenspalten `tabelle.spalte`.
-- zeile:    1-basierte Tabellenzeile, -1 = kein Tabellenfeld (NULL taugt
--           nicht fuer UNIQUE: NULL <> NULL).
-- datum:    das erinnerte Datum aus den Daten des Stands, nicht der Sendetag.
-- stufe:    'vorher-<tage>' (Tage vor dem Datum), 'tag' (am Datum selbst),
--           'ueberfaellig-<woche>' (1..4 Wochen danach).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `skErinnerung` (
  `erinnerungID` int(11) NOT NULL AUTO_INCREMENT,
  `standID`      int(11) NOT NULL COMMENT 'skKreisStand.standID (veroeffentlicht)',
  `ecKreisID`    int(11) NOT NULL,
  `feld_key`     varchar(130) NOT NULL COMMENT 'Feld-Key, bei Spalten tabelle.spalte',
  `zeile`        int(11) NOT NULL DEFAULT -1 COMMENT '1-basiert, -1 = kein Tabellenfeld',
  `datum`        date NOT NULL COMMENT 'das erinnerte Datum',
  `stufe`        varchar(30) NOT NULL COMMENT 'vorher-<tage> | tag | ueberfaellig-<woche>',
  `empfaenger`   int(11) NOT NULL DEFAULT 0 COMMENT 'Anzahl zugestellter Mails',
  `gesendet`     timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`erinnerungID`),
  UNIQUE KEY `einmal` (`standID`, `feld_key`, `zeile`, `datum`, `stufe`),
  KEY `kreis_feld` (`ecKreisID`, `feld_key`, `zeile`, `datum`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Unveraenderlichkeit, von der Datenbank erzwungen.
--
-- Erlaubt bleibt genau der Uebergang draft -> published (OLD.status ist dann
-- noch 'draft'). Alles, was eine veroeffentlichte Zeile anfasst, bricht mit
-- SQLSTATE 45000 ab. TRUNCATE (Dev-Seed) loest keine Trigger aus.
-- ---------------------------------------------------------------------------
DELIMITER //

CREATE TRIGGER IF NOT EXISTS `skFormularVersion_bu` BEFORE UPDATE ON `skFormularVersion`
FOR EACH ROW BEGIN
  IF OLD.`status` = 'published' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'skFormularVersion: veroeffentlichte Version ist unveraenderlich';
  END IF;
END//

CREATE TRIGGER IF NOT EXISTS `skFormularVersion_bd` BEFORE DELETE ON `skFormularVersion`
FOR EACH ROW BEGIN
  IF OLD.`status` = 'published' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'skFormularVersion: veroeffentlichte Version ist unveraenderlich';
  END IF;
END//

CREATE TRIGGER IF NOT EXISTS `skVorlage_bi` BEFORE INSERT ON `skVorlage`
FOR EACH ROW BEGIN
  IF EXISTS (SELECT 1 FROM `skFormularVersion`
              WHERE `formularVersionID` = NEW.`formularVersionID` AND `status` = 'published') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'skVorlage: Version ist veroeffentlicht';
  END IF;
END//

CREATE TRIGGER IF NOT EXISTS `skVorlage_bu` BEFORE UPDATE ON `skVorlage`
FOR EACH ROW BEGIN
  IF EXISTS (SELECT 1 FROM `skFormularVersion`
              WHERE `formularVersionID` IN (OLD.`formularVersionID`, NEW.`formularVersionID`)
                AND `status` = 'published') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'skVorlage: Version ist veroeffentlicht';
  END IF;
END//

CREATE TRIGGER IF NOT EXISTS `skVorlage_bd` BEFORE DELETE ON `skVorlage`
FOR EACH ROW BEGIN
  IF EXISTS (SELECT 1 FROM `skFormularVersion`
              WHERE `formularVersionID` = OLD.`formularVersionID` AND `status` = 'published') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'skVorlage: Version ist veroeffentlicht';
  END IF;
END//

CREATE TRIGGER IF NOT EXISTS `skKreisStand_bu` BEFORE UPDATE ON `skKreisStand`
FOR EACH ROW BEGIN
  IF OLD.`status` = 'published' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'skKreisStand: veroeffentlichter Stand ist unveraenderlich';
  END IF;
END//

CREATE TRIGGER IF NOT EXISTS `skKreisStand_bd` BEFORE DELETE ON `skKreisStand`
FOR EACH ROW BEGIN
  IF OLD.`status` = 'published' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'skKreisStand: veroeffentlichter Stand ist unveraenderlich';
  END IF;
END//

-- PDFs entstehen nur waehrend des Veroeffentlichens (Stand noch draft) und
-- werden danach nie wieder angefasst.
CREATE TRIGGER IF NOT EXISTS `skKreisPdf_bi` BEFORE INSERT ON `skKreisPdf`
FOR EACH ROW BEGIN
  IF NOT EXISTS (SELECT 1 FROM `skKreisStand`
                  WHERE `standID` = NEW.`standID` AND `status` = 'draft') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'skKreisPdf: nur fuer einen Stand im Veroeffentlichen';
  END IF;
END//

CREATE TRIGGER IF NOT EXISTS `skKreisPdf_bu` BEFORE UPDATE ON `skKreisPdf`
FOR EACH ROW BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'skKreisPdf: unveraenderlich';
END//

CREATE TRIGGER IF NOT EXISTS `skKreisPdf_bd` BEFORE DELETE ON `skKreisPdf`
FOR EACH ROW BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'skKreisPdf: unveraenderlich';
END//

DELIMITER ;

-- ---------------------------------------------------------------------------
-- Selbstkontrolle. Jede Zeile muss "da" zeigen.
--
-- Liest information_schema. Hat das Konto darauf keinen Zugriff (ERROR 1044,
-- z. B. root@'%' auf dem Prod-Server), bricht der Import GENAU HIER ab -- alle
-- Tabellen, Spalten und Trigger oben sind dann bereits angelegt. Ersatzweise
-- ohne information_schema pruefen:
--   SHOW TABLES LIKE 'sk%';                       -- 11 Zeilen
--   SHOW TRIGGERS;                                -- 10 Zeilen mit Trigger sk...
--   SHOW COLUMNS FROM portalUser LIKE 'is_schutzkonzept_verwalter';
--   SHOW COLUMNS FROM skKreisStand LIKE 'abschnitte_bestaetigt';
--   SHOW FULL COLUMNS FROM skKreisEmail LIKE 'email';  -- Collation utf8mb4_bin
-- Die API selbst prueft das Schema ueber SHOW-Befehle (config.ts).
-- ---------------------------------------------------------------------------
SELECT 'portalUser.is_schutzkonzept_verwalter' AS objekt, IF(COUNT(*)=1,'da','FEHLT') AS status
  FROM information_schema.columns
 WHERE table_schema = DATABASE() AND table_name = 'portalUser'
   AND column_name = 'is_schutzkonzept_verwalter'
UNION ALL SELECT t.n, IF(COUNT(i.table_name)=1,'da','FEHLT')
  FROM (SELECT 'skKreisEmail' n UNION ALL SELECT 'skFormularVersion' UNION ALL SELECT 'skVorlage'
        UNION ALL SELECT 'skKreisStand' UNION ALL SELECT 'skKreisPdf' UNION ALL SELECT 'skLoginCode'
        UNION ALL SELECT 'skLoginFehlversuch' UNION ALL SELECT 'skAudit'
        UNION ALL SELECT 'skKreisZaehler' UNION ALL SELECT 'skFormularZaehler'
        UNION ALL SELECT 'skErinnerung') t
  LEFT JOIN information_schema.tables i
    ON i.table_schema = DATABASE() AND i.table_name = t.n
 GROUP BY t.n
UNION ALL SELECT 'skLoginCode.token_gen', IF(COUNT(*)=1,'da','FEHLT')
  FROM information_schema.columns
 WHERE table_schema = DATABASE() AND table_name = 'skLoginCode'
   AND column_name = 'token_gen'
UNION ALL SELECT 'skKreisStand.abschnitte_bestaetigt', IF(COUNT(*)=1,'da','FEHLT')
  FROM information_schema.columns
 WHERE table_schema = DATABASE() AND table_name = 'skKreisStand'
   AND column_name = 'abschnitte_bestaetigt'
UNION ALL SELECT 'E-Mail-Spalten binaer (utf8mb4_bin)', IF(COUNT(*)=3,'da','FEHLT')
  FROM information_schema.columns
 WHERE table_schema = DATABASE() AND column_name = 'email'
   AND table_name IN ('skKreisEmail', 'skLoginCode', 'skLoginFehlversuch')
   AND collation_name = 'utf8mb4_bin'
UNION ALL SELECT 'Trigger (10 erwartet)', IF(COUNT(*)=10,'da','FEHLT')
  FROM information_schema.triggers
 WHERE trigger_schema = DATABASE() AND trigger_name LIKE 'sk%';

-- Zur Kenntnis (siehe DEFINER im Dateikopf): Mit den Rechten dieses Kontos
-- laufen die Trigger. Es muss dauerhaft existieren -- und es sollte genau
-- eines sein.
SELECT GROUP_CONCAT(DISTINCT `definer` SEPARATOR ', ') AS trigger_definer
  FROM information_schema.triggers
 WHERE trigger_schema = DATABASE() AND trigger_name LIKE 'sk%';

-- ---------------------------------------------------------------------------
-- Einmalige Bereinigung des Mail-Protokolls. Bis 09/2026 stand der Login-Code
-- im Betreff der Mail und damit im Klartext in `gesendeteEmails`. Die Codes
-- sind laengst abgelaufen; trotzdem entfernen.
--
-- Steht bewusst GANZ AM ENDE: `gesendeteEmails` gehoert der Verwaltung und
-- wird von keiner sql/*.sql-Datei angelegt. Fehlt sie, bricht der
-- mysql-Batch-Client hier ab -- dann ist aber das gesamte Schutzkonzept-Schema
-- samt Triggern und Selbstkontrolle bereits eingespielt, und es bleibt kein
-- halber Stand zurueck (genau den melden die Routen sonst als 503).
-- ---------------------------------------------------------------------------
UPDATE `gesendeteEmails`
   SET `content` = REGEXP_REPLACE(`content`, '(Anmeldecode f[^ ]{1,8}r das Schutzkonzept): [0-9]{6}', '\\1')
 WHERE `content` LIKE '%Anmeldecode f%r das Schutzkonzept: %';
