-- Mitarbeit in einem EC-Kreis, getrennt von der Mitgliedschaft (2026-09)
--
-- `personen.ecKreis` trug bisher zwei Bedeutungen: Mitglied im Kreis (mit
-- `ecMitglied`) UND Mitarbeit dort (Fuehrungszeugnis-Pflicht, FZ-Liste im
-- Portal, Monats-Excel des FZ-Systems). Beides faellt oft zusammen, aber nicht
-- immer: wer in einem Kreis Mitglied ist und in einem anderen mitarbeitet,
-- muss sein Zeugnis dort vorzeigen, wo er mitarbeitet.
--
-- Ab jetzt:
--   personen.ecKreis  = Mitgliedschaft (genau ein Kreis oder keiner),
--                       pflegt die/der Ortsverantwortliche im Portal.
--   ecKreisMitarbeit  = Mitarbeit (beliebig viele Kreise), pflegt die/der
--                       FZ-Verantwortliche im Portal, dazu die Verwaltung.
-- FZ-Liste, Zaehler, Eintragsrecht, Verwaltungs-FZ-Liste und cron.php lesen
-- ausschliesslich diese Tabelle. Keine Historie: Entfernen ist ein DELETE.
-- Keine Foreign Keys, wie ueberall im Bestand (siehe portal-schema.sql).
--
-- Idempotent (MariaDB 10.5): kann mehrfach eingespielt werden.
--
-- Dev:  cd dev && docker compose exec -T mysql mysql -uroot -proot ecnordbund < ../EC-Api/sql/kreis-mitarbeit.sql
-- Prod: mysql -u<user> -p ecnordbund < kreis-mitarbeit.sql
--
-- Reihenfolge beim Ausrollen: erst dieses SQL, dann EC-Api, dann Portal und
-- Verwaltung, zuletzt fz-mail-system. Fehlt die Tabelle, schalten sich die
-- /portal/*-Routen mit 503 ab (Schema-Guard in src/portal/scope.ts), und
-- cron.php bricht im Kreis-Lauf ab -- also nicht vertauschen.

CREATE TABLE IF NOT EXISTS `ecKreisMitarbeit` (
  `ecKreisMitarbeitID` int(11) NOT NULL AUTO_INCREMENT,
  `personID`      int(11) NOT NULL,
  `ecKreisID`     int(11) NOT NULL,
  `seit`          timestamp NOT NULL DEFAULT current_timestamp(),
  `erzeugt_durch` varchar(20) NOT NULL DEFAULT '' COMMENT 'portal | qr | verwaltung | migration',
  PRIMARY KEY (`ecKreisMitarbeitID`),
  UNIQUE KEY `person_kreis` (`personID`, `ecKreisID`),
  KEY `ecKreisID` (`ecKreisID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Einmalige Uebernahme des Bestands: jede Person mit gesetztem Mitgliedskreis
-- gilt dort auch als mitarbeitend -- so war es bis heute gemeint, und die
-- FZ-Listen sehen nach dem Einspielen aus wie vorher.
--
-- Laeuft nur, solange noch keine Migrationszeile existiert: die Datei wird
-- wiederholt eingespielt, und ein zweiter Lauf darf spaeter eingetragene
-- reine Mitglieder nicht nachtraeglich zu Mitarbeitenden machen. INSERT IGNORE
-- faengt zusaetzlich Doppelte ueber den UNIQUE ab. Der JOIN laesst verwaiste
-- ecKreis-Werte aussen vor (keine FKs im Bestand).
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO `ecKreisMitarbeit` (`personID`, `ecKreisID`, `erzeugt_durch`)
SELECT p.personID, p.ecKreis, 'migration'
  FROM personen p
  JOIN ecKreis k ON k.ecKreisID = p.ecKreis
 WHERE p.ecKreis IS NOT NULL
   AND p.anonymisiert = 0
   AND NOT EXISTS (SELECT 1 FROM ecKreisMitarbeit m WHERE m.erzeugt_durch = 'migration');

-- ---------------------------------------------------------------------------
-- Selbstkontrolle. Nach dem Einspielen ausfuehren -- jede Zeile muss "da"
-- zeigen, und die Migrationszahl sollte der Zahl der Personen mit Kreis
-- entsprechen (beim ersten Lauf).
-- ---------------------------------------------------------------------------
SELECT 'ecKreisMitarbeit' AS objekt, IF(COUNT(*)=1,'da','FEHLT') AS status
  FROM information_schema.tables
 WHERE table_schema = DATABASE() AND table_name = 'ecKreisMitarbeit'
UNION ALL SELECT 'ecKreisMitarbeit.person_kreis (UNIQUE)', IF(COUNT(*)>=1,'da','FEHLT')
  FROM information_schema.statistics
 WHERE table_schema = DATABASE() AND table_name = 'ecKreisMitarbeit'
   AND index_name = 'person_kreis'
UNION ALL SELECT CONCAT('Migrationszeilen: ', COUNT(*)), 'info'
  FROM ecKreisMitarbeit WHERE erzeugt_durch = 'migration';
