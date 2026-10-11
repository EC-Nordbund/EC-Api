-- Dateivorlagen der API in der Datenbank (09/2026)
--
-- Idempotent (MariaDB 10.5): kann mehrfach eingespielt werden. Beide Tabellen
-- bleiben nach dem Einspielen leer -- die Dateien kommen ueber die Pflegemaske
-- in EC-Verwaltung (Sonstiges -> Dateivorlagen) bzw. ueber "uebernehmen" aus
-- dem Dateisystem der laufenden API.
--
-- Dev:  cd dev && docker compose exec -T mysql mysql -uroot -proot ecnordbund < ../EC-Api/sql/datei-vorlagen.sql
-- Prod: mysql -u<user> -p ecnordbund < datei-vorlagen.sql   (VOR dem API-Deploy)
--
-- Fehlen die Tabellen, antwortet die Pflegemaske mit 503; Briefe, FZ-Antraege,
-- TN-Listen und Anmelde-Mails laufen weiter mit den Dateien aus dem
-- Dateisystem, genau wie bisher.
--
-- ---------------------------------------------------------------------------
-- Warum in der Datenbank: die API laeuft als Container ohne dauerhaftes
-- Volume, die Sicherung ist der Datenbank-Dump. Bestaetigungsbriefe,
-- Sicherungsscheine und Teilnahmebedingungen lagen bisher nur im
-- Build-Verzeichnis des Prod-Servers -- nicht im Git, nicht in der Sicherung,
-- und jede Aenderung brauchte einen Entwickler und ein Deployment.
--
-- Welche Vorlagen es gibt und wozu sie dienen, steht im Code
-- (src/vorlagen/katalog.ts). Hier liegen nur Datei und Historie; der Schluessel
-- ist der feste Bezug aus dem Katalog (z. B. `brief.bestaetigung.1`,
-- `brief.sicherungsschein.2027`, `tnliste.kueche`, `mail.dsgvo.teilnehmer`).
--
-- Obergrenze je Datei sind 10 MB (src/vorlagen/store.ts). Real sind es
-- 5 KB bis 1,4 MB; die Grenze schuetzt max_allowed_packet (Hex-Kodierung
-- verdoppelt die Groesse im Statement; Standard 16 MB, Dev 64 MB).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dateiVorlage` (
  `schluessel`    varchar(60)  NOT NULL COMMENT 'fester Bezug aus src/vorlagen/katalog.ts',
  `dateiname`     varchar(255) NOT NULL,
  `mimetype`      varchar(120) NOT NULL DEFAULT 'application/octet-stream',
  `groesse`       int(11)      NOT NULL DEFAULT 0 COMMENT 'Bytes',
  `sha256`        char(64)     NOT NULL COMMENT 'Hex; gleiche Datei = kein neuer Stand',
  `inhalt`        longblob     NOT NULL,
  `geaendert_am`  timestamp    NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `geaendert_von` int(11)      NOT NULL DEFAULT 0 COMMENT 'users.user_id, 0 = per Skript eingespielt',
  PRIMARY KEY (`schluessel`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Historie: jedes Ersetzen legt die bisherige Fassung hier ab (hoechstens die
-- letzten zehn je Schluessel, src/vorlagen/store.ts). Ein versehentlich
-- ueberschriebener Brief oder Sicherungsschein ist so einen Klick entfernt.
CREATE TABLE IF NOT EXISTS `dateiVorlageVersion` (
  `versionID`  int(11)      NOT NULL AUTO_INCREMENT,
  `schluessel` varchar(60)  NOT NULL,
  `dateiname`  varchar(255) NOT NULL,
  `mimetype`   varchar(120) NOT NULL DEFAULT 'application/octet-stream',
  `groesse`    int(11)      NOT NULL DEFAULT 0,
  `sha256`     char(64)     NOT NULL,
  `inhalt`     longblob     NOT NULL,
  `ts`         timestamp    NOT NULL DEFAULT current_timestamp(),
  `user_id`    int(11)      NOT NULL DEFAULT 0 COMMENT 'users.user_id, wer die Fassung abgeloest hat',
  `anmerkung`  varchar(200) NOT NULL DEFAULT '',
  PRIMARY KEY (`versionID`),
  KEY `schluessel` (`schluessel`, `versionID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Kontrolle
SELECT 'dateiVorlage' AS tabelle, COUNT(*) AS eintraege, COALESCE(SUM(`groesse`), 0) AS bytes FROM `dateiVorlage`
UNION ALL
SELECT 'dateiVorlageVersion', COUNT(*), COALESCE(SUM(`groesse`), 0) FROM `dateiVorlageVersion`;
