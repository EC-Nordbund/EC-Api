-- Materialverwaltung des EC-Portals (09/2026)
--
-- Idempotent (MariaDB 10.5): kann mehrfach eingespielt werden.
-- Setzt sql/portal-schema.sql voraus (Tabelle portalUser).
--
-- Dev:  cd dev && docker compose exec -T mysql mysql -uroot -proot ecnordbund < ../EC-Api/sql/material-schema.sql
-- Prod: mysql -u<user> -p ecnordbund < material-schema.sql   (VOR dem API-Deploy)
--
-- Fehlen die Tabellen, antworten die /portal/material/*-Routen mit 503; der
-- Rest des Portals laeuft weiter (die Spalte am portalUser wird getrennt und
-- fehlertolerant gelesen, siehe src/portal/scope.ts).

-- ---------------------------------------------------------------------------
-- Rolle "Materialwart" am Portal-Zugang. Wird in EC-Verwaltung unter
-- Sonstiges -> Portal-Zugaenge vergeben; Superuser haben sie implizit.
-- Bewusst AFTER is_superuser und nicht hinter der Schutzkonzept-Spalte, damit
-- diese Datei auch ohne das Schutzkonzept-Schema laeuft.
-- ---------------------------------------------------------------------------
ALTER TABLE `portalUser`
  ADD COLUMN IF NOT EXISTS `is_material_verwalter` tinyint(1) NOT NULL DEFAULT 0
    COMMENT 'Materialwart: Material pflegen, Antraege bearbeiten'
    AFTER `is_superuser`;

-- ---------------------------------------------------------------------------
-- Kategorien (Sport, Kueche, Spiele ...). Frei pflegbar durch Materialwarte.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `materialKategorie` (
  `materialKategorieID` int(11)     NOT NULL AUTO_INCREMENT,
  `bezeichnung`         varchar(80) NOT NULL,
  `sortierung`          int(11)     NOT NULL DEFAULT 0,
  `erstellt`            timestamp   NOT NULL DEFAULT current_timestamp(),
  `geaendert`           timestamp   NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`materialKategorieID`),
  UNIQUE KEY `bezeichnung` (`bezeichnung`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Das Material selbst.
--
-- bereich:     'allgemein'  sieht jeder Portal-Nutzer,
--              'referenten' nur Freizeitleitung (Umfang voll), Materialwarte
--              und Superuser (Drucker, Stifte ...).
-- freigegeben: 0 = nur fuer Materialwarte sichtbar (frisch angelegt).
-- aktiv:       0 = archiviert. Kein DELETE: Antragspositionen verweisen auf
--              die Zeile, und ein alter Antrag soll lesbar bleiben.
-- Keine Foreign Keys, wie im uebrigen Bestand.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `material` (
  `materialID`          int(11)       NOT NULL AUTO_INCREMENT,
  `bereich`             enum('allgemein','referenten') NOT NULL DEFAULT 'allgemein',
  `materialKategorieID` int(11)       DEFAULT NULL,
  `name`                varchar(200)  NOT NULL,
  `beschreibung`        varchar(2000) NOT NULL DEFAULT '',
  `bestand`             int(11)       NOT NULL DEFAULT 1 COMMENT 'Gesamtanzahl im Lager',
  `lagerort`            varchar(200)  NOT NULL DEFAULT '',
  `freigegeben`         tinyint(1)    NOT NULL DEFAULT 0 COMMENT '0 = nur fuer Materialwarte sichtbar',
  `aktiv`               tinyint(1)    NOT NULL DEFAULT 1 COMMENT '0 = archiviert',
  `erstellt`            timestamp     NOT NULL DEFAULT current_timestamp(),
  `erstellt_von`        int(11)       NOT NULL DEFAULT 0 COMMENT 'portalUser.portalUserID',
  `geaendert`           timestamp     NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `geaendert_von`       int(11)       NOT NULL DEFAULT 0 COMMENT 'portalUser.portalUserID',
  PRIMARY KEY (`materialID`),
  KEY `sichtbar` (`aktiv`, `freigegeben`, `bereich`),
  KEY `materialKategorieID` (`materialKategorieID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Foto, 1:1 zum Material, in eigener Tabelle: die Katalogliste liest nie
-- Blobs. Zwei Fassungen, beide vom Browser verkleinert (kein sharp in der
-- API): `inhalt` bis 1200 px fuer den Detaildialog, `vorschau` ~240 px fuer
-- die Liste. Die Vorschauen aller sichtbaren Materialien gehen in EINEM
-- Request raus (ein <img src> traegt keinen Auth-Header, und /portal hat ein
-- Limit von 120 Requests pro Minute).
-- Liegt in der DB, nicht im Dateisystem -- Begruendung in portal-downloads.sql.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `materialFoto` (
  `materialID` int(11)     NOT NULL,
  `mimetype`   varchar(60) NOT NULL,
  `groesse`    int(11)     NOT NULL COMMENT 'Bytes von inhalt',
  `inhalt`     longblob    NOT NULL COMMENT 'max. 1200 px, vom Client verkleinert',
  `vorschau`   mediumblob  NOT NULL COMMENT '~240 px JPEG fuer die Liste',
  `geaendert`  timestamp   NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`materialID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Ausleih-Antraege.
--
-- status: offen -> genehmigt | abgelehnt -> abgeschlossen; storniert nur aus
--         offen durch den Antragsteller. Uebergaenge prueft der Code
--         (src/material/antrag.ts), kein Trigger noetig.
-- von/bis: DATE, Tage inklusiv. Vergleiche laufen in SQL (UTC-Falle).
-- anlass:  denormalisiert -- die Veranstaltung verschwindet drei Monate nach
--          ihrem Ende aus dem Portal-Scope, der Antrag soll lesbar bleiben.
-- veranstaltungsID / ecKreisID: optionaler Bezug; Orts- und Kreisveranstal-
--          tungen stehen nicht in `veranstaltungen`, deshalb Freitext moeglich.
-- erinnert_am: wird je Statuswechsel auf NULL gesetzt, damit ein spaeter
--          genehmigter Antrag die Rueckgabe-Erinnerung noch bekommt.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `materialAntrag` (
  `materialAntragID`  int(11)       NOT NULL AUTO_INCREMENT,
  `portalUserID`      int(11)       NOT NULL COMMENT 'Antragsteller',
  `status`            enum('offen','genehmigt','abgelehnt','abgeschlossen','storniert') NOT NULL DEFAULT 'offen',
  `von`               date          NOT NULL,
  `bis`               date          NOT NULL COMMENT 'inklusiv',
  `veranstaltungsID`  int(11)       DEFAULT NULL,
  `ecKreisID`         int(11)       DEFAULT NULL,
  `anlass`            varchar(200)  NOT NULL COMMENT 'denormalisiert: Veranstaltung oder Freitext',
  `kommentar`         varchar(2000) NOT NULL DEFAULT '' COMMENT 'Antragsteller',
  `antwort`           varchar(2000) NOT NULL DEFAULT '' COMMENT 'Materialwart',
  `erstellt`          timestamp     NOT NULL DEFAULT current_timestamp(),
  `geaendert`         timestamp     NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `entschieden_am`    timestamp     NULL DEFAULT NULL,
  `entschieden_von`   int(11)       DEFAULT NULL COMMENT 'portalUser.portalUserID',
  `abgeschlossen_am`  timestamp     NULL DEFAULT NULL,
  `abgeschlossen_von` int(11)       DEFAULT NULL,
  `erinnert_am`       timestamp     NULL DEFAULT NULL COMMENT 'Erinnerungsmail verschickt',
  PRIMARY KEY (`materialAntragID`),
  KEY `belegung` (`status`, `von`, `bis`),
  KEY `eigene` (`portalUserID`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Positionen eines Antrags. mengeGenehmigt: NULL = noch nicht entschieden,
-- 0 = gestrichen. eingeladen/zurueck sind die Packlisten-Haken des Nutzers.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `materialAntragPosition` (
  `materialAntragPositionID` int(11)    NOT NULL AUTO_INCREMENT,
  `materialAntragID`         int(11)    NOT NULL,
  `materialID`               int(11)    NOT NULL,
  `menge`                    int(11)    NOT NULL COMMENT 'beantragt',
  `mengeGenehmigt`           int(11)    DEFAULT NULL COMMENT 'NULL = offen, 0 = gestrichen',
  `eingeladen`               tinyint(1) NOT NULL DEFAULT 0,
  `zurueck`                  tinyint(1) NOT NULL DEFAULT 0,
  `geaendert`                timestamp  NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`materialAntragPositionID`),
  UNIQUE KEY `antrag_material` (`materialAntragID`, `materialID`),
  KEY `materialID` (`materialID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Materiallisten-Vorlagen ("Teencamp-Grundliste"): eine benannte Liste von
-- Material mit Mengen, die der Nutzer im Katalog als Auswahl laedt.
--
-- Pflege nur durch Materialwarte (Vorgabe). bereich wie beim Material:
-- 'allgemein' sieht jeder, 'referenten' nur, wer auch das Spezial-Material
-- sieht -- eine allgemeine Vorlage darf deshalb kein referenten-Material
-- enthalten (prueft der Code). Kein aktiv-Flag: Vorlagen haengen an nichts,
-- Loeschen ist echtes Loeschen. Archiviertes Material bleibt in der Vorlage
-- stehen und wird beim Laden uebersprungen, sonst wuerde eine Vorlage durch
-- eine Ausmusterung unbenutzbar.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `materialVorlage` (
  `materialVorlageID` int(11)       NOT NULL AUTO_INCREMENT,
  `name`              varchar(120)  NOT NULL,
  `beschreibung`      varchar(1000) NOT NULL DEFAULT '',
  `bereich`           enum('allgemein','referenten') NOT NULL DEFAULT 'allgemein',
  `sortierung`        int(11)       NOT NULL DEFAULT 0,
  `erstellt`          timestamp     NOT NULL DEFAULT current_timestamp(),
  `erstellt_von`      int(11)       NOT NULL DEFAULT 0 COMMENT 'portalUser.portalUserID',
  `geaendert`         timestamp     NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `geaendert_von`     int(11)       NOT NULL DEFAULT 0 COMMENT 'portalUser.portalUserID',
  PRIMARY KEY (`materialVorlageID`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `materialVorlagePosition` (
  `materialVorlagePositionID` int(11) NOT NULL AUTO_INCREMENT,
  `materialVorlageID`         int(11) NOT NULL,
  `materialID`                int(11) NOT NULL,
  `menge`                     int(11) NOT NULL,
  PRIMARY KEY (`materialVorlagePositionID`),
  UNIQUE KEY `vorlage_material` (`materialVorlageID`, `materialID`),
  KEY `materialID` (`materialID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Selbstkontrolle: jede Zeile muss 'da' zeigen. Alternativ, falls
-- information_schema nicht lesbar ist:
--   SHOW TABLES LIKE 'material%';                        -- 7 Zeilen
--   SHOW COLUMNS FROM portalUser LIKE 'is_material_verwalter';
-- ---------------------------------------------------------------------------
SELECT 'portalUser.is_material_verwalter' AS objekt, IF(COUNT(*)=1,'da','FEHLT') AS status
  FROM information_schema.columns
 WHERE table_schema = DATABASE() AND table_name = 'portalUser'
   AND column_name = 'is_material_verwalter'
UNION ALL SELECT t.n, IF(COUNT(i.table_name)=1,'da','FEHLT')
  FROM (SELECT 'materialKategorie' n UNION ALL SELECT 'material'
        UNION ALL SELECT 'materialFoto' UNION ALL SELECT 'materialAntrag'
        UNION ALL SELECT 'materialAntragPosition'
        UNION ALL SELECT 'materialVorlage' UNION ALL SELECT 'materialVorlagePosition') t
  LEFT JOIN information_schema.tables i
    ON i.table_schema = DATABASE() AND i.table_name = t.n
 GROUP BY t.n;
