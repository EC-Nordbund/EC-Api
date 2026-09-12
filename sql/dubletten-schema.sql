-- Dubletten-Pflege fuer Personen (EC-Verwaltung: /#/dublikate/personen)
--
-- Idempotent (MariaDB 10.5): kann mehrfach eingespielt werden.
-- Sie liegt im API-Repo und nicht in der lokalen dev/-Infrastruktur, weil sie
-- zum Deployment gehoert. Die Dev-Umgebung mountet sie direkt von hier
-- (dev/docker-compose.yml), damit es nur eine Fassung gibt.
--
-- Dev (bestehendes Volume):
--   cd dev && docker compose exec -T mysql mysql -uroot -proot ecnordbund < ../EC-Api/sql/dubletten-schema.sql
-- Prod: einmal komplett einspielen, VOR dem API-Deploy:
--   mysql -u<user> -p ecnordbund < dubletten-schema.sql
--
-- Anders als beim Portal ist das hier KEIN harter Startup-Guard: Erkennung,
-- Kandidatenliste, Paar-Detail und Merge laufen auch ohne diese Datei, weil sie
-- nur das Bestandsschema brauchen. Fehlt sie, antworten lediglich die beiden
-- /v6/dubletten/kein-duplikat-Routen mit 503 (eine Markierung ohne "wer/wann"
-- waere nicht nachvollziehbar) und der Merge ueberspringt den Protokolleintrag.

-- ---------------------------------------------------------------------------
-- `keinedublikate` existiert im Bestandsschema, wurde aber von keiner Zeile
-- Code benutzt -- entsprechend fehlen ihr alle Metadaten. "Diese zwei sind
-- keine Dubletten" ist eine fachliche Beurteilung, die ein echtes Duplikat
-- dauerhaft unsichtbar macht; ohne Urheber und Zeitpunkt ist sie nicht
-- hinterfragbar, und das einzige Korrekturmittel waere ein SQL-Eingriff.
-- Alle Spalten mit Default, damit moegliche Altzeilen unberuehrt bleiben.
-- PRIMARY KEY (personID_1, personID_2) bleibt wie er ist; der Anwendungscode
-- schreibt immer die kleinere ID nach personID_1 (siehe src/dubletten/keine.ts).
-- ---------------------------------------------------------------------------
ALTER TABLE `keinedublikate`
  ADD COLUMN IF NOT EXISTS `markiert_von` int(11) NOT NULL DEFAULT 0
      COMMENT 'users.user_id; 0 = unbekannt/Altbestand',
  ADD COLUMN IF NOT EXISTS `markiert_am`  timestamp NOT NULL DEFAULT current_timestamp(),
  ADD COLUMN IF NOT EXISTS `notiz`        varchar(500) NOT NULL DEFAULT '';

-- ---------------------------------------------------------------------------
-- Protokoll. Ein Merge ist irreversibel und loescht einen Personensatz --
-- ohne Protokoll kann niemand rekonstruieren, was passiert ist.
-- Bewusst nur IDs, Score und eine Konfliktkurzfassung, KEINE Personendaten
-- (gleiche Regel wie portalAudit in portal-schema.sql).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dublettenLog` (
  `dublettenLogID`    int(11) NOT NULL AUTO_INCREMENT,
  `ts`                timestamp NOT NULL DEFAULT current_timestamp(),
  `user_id`           int(11) NOT NULL DEFAULT 0 COMMENT 'users.user_id',
  `aktion`            varchar(30) NOT NULL COMMENT 'merge|keinDuplikat|keinDuplikatZurueck',
  `personID_behalten` int(11) NOT NULL,
  `personID_entfernt` int(11) NOT NULL,
  `score`             int(11) NOT NULL DEFAULT 0,
  `anmerkung`         varchar(500) NOT NULL DEFAULT ''
      COMMENT 'Regelcodes und Konfliktzusammenfassung, keine Personendaten',
  PRIMARY KEY (`dublettenLogID`),
  KEY `ts` (`ts`),
  KEY `personID_behalten` (`personID_behalten`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
