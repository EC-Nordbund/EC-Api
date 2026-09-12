-- EC-Portal: Selbstbedienungs-Portal für Freizeitleiter und Ortsverantwortliche
--
-- Idempotent (MariaDB 10.5): kann mehrfach eingespielt werden.
-- Sie liegt im API-Repo und nicht in der lokalen dev/-Infrastruktur, weil sie
-- zum Deployment gehoert: ohne sie antworten die /portal/*-Routen mit 503.
-- Die Dev-Umgebung mountet sie direkt von hier (dev/docker-compose.yml), damit
-- es nur eine Fassung gibt und keine Kopie veralten kann.
--
-- Dev (bestehendes Volume):
--   cd dev && docker compose exec -T mysql mysql -uroot -proot ecnordbund < ../EC-Api/sql/portal-schema.sql
-- Prod: DIES IST DIE EINZIGE SQL-DATEI DES PORTAL-MODULS. Sie enthaelt alle
--       Schema-Aenderungen am Stueck und ist idempotent -- einmal komplett
--       einspielen, VOR dem API-Deploy:
--         mysql -u<user> -p ecnordbund < portal-schema.sql
--       Fehlt die ecKreis-Spalte, antworten alle /portal/*-Routen mit 503
--       (Startup-Guard in src/portal/config.ts).

-- ---------------------------------------------------------------------------
-- Portal-Accounts. Bewusst getrennt von `users` (das bleibt die Verwaltung):
-- anderes Hash-Verfahren, anderes JWT-Secret, anderer Rechtekreis.
-- Keine Foreign Keys — das Bestandsschema nutzt sie außer bei `anmeldungen`
-- nirgends, und sie würden Anonymisierung und Dump-Importreihenfolge stören.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `portalUser` (
  `portalUserID`  int(11) NOT NULL AUTO_INCREMENT,
  `personID`      int(11) NOT NULL,
  `email`         varchar(255) NOT NULL COMMENT 'Login-Kennung',
  `password_hash` varchar(255) DEFAULT NULL COMMENT 'NULL = Einladung noch offen',
  `is_superuser`  tinyint(1) NOT NULL DEFAULT 0,
  `aktiv`         tinyint(1) NOT NULL DEFAULT 1,
  `erstellt`      timestamp NOT NULL DEFAULT current_timestamp(),
  `erstellt_von`  int(11) NOT NULL DEFAULT 0 COMMENT 'users.user_id der Verwaltung',
  `last_login`    timestamp NULL DEFAULT NULL,
  `pw_changed_at` timestamp NULL DEFAULT NULL COMMENT 'nur zur Information',
  `token_gen`     int(11) NOT NULL DEFAULT 0 COMMENT 'Zaehler: jeder Passwortwechsel entwertet alle laufenden Sitzungen',
  `failed_logins` int(11) NOT NULL DEFAULT 0,
  `locked_until`  timestamp NULL DEFAULT NULL,
  `notiz`         varchar(500) NOT NULL DEFAULT '',
  PRIMARY KEY (`portalUserID`),
  UNIQUE KEY `email` (`email`),
  UNIQUE KEY `personID` (`personID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Einmal-Token für Einladung und "Passwort vergessen".
-- Nur der Hash liegt in der DB: ein Backup-Leak gibt keine benutzbaren Links.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `portalToken` (
  `portalTokenID` int(11) NOT NULL AUTO_INCREMENT,
  `portalUserID`  int(11) NOT NULL,
  `token_hash`    char(64) NOT NULL COMMENT 'sha256-hex des Klartext-Tokens',
  `zweck`         enum('invite','reset') NOT NULL,
  `erstellt`      timestamp NOT NULL DEFAULT current_timestamp(),
  `gueltig_bis`   timestamp NOT NULL,
  `benutzt_am`    timestamp NULL DEFAULT NULL,
  `ip`            varchar(45) NOT NULL DEFAULT '',
  PRIMARY KEY (`portalTokenID`),
  UNIQUE KEY `token_hash` (`token_hash`),
  KEY `portalUserID` (`portalUserID`),
  KEY `gueltig_bis` (`gueltig_bis`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Audit-Spur. Nicht `userLogging` nachnutzen: die Tabelle wird von keiner Zeile
-- Code beschrieben, hat kein festes Format und keine Indizes. Hier landen nur
-- IDs, nie Inhalte (Gesundheitsdaten!).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `portalAudit` (
  `portalAuditID` int(11) NOT NULL AUTO_INCREMENT,
  `ts`            timestamp NOT NULL DEFAULT current_timestamp(),
  `portalUserID`  int(11) DEFAULT NULL,
  `aktion`        varchar(50) NOT NULL COMMENT 'login.ok|login.fail|pw.set|fz.add|liste.tn|...',
  `ziel`          varchar(100) NOT NULL DEFAULT '' COMMENT '"person:123" / "veranstaltung:7"',
  `ip`            varchar(45) NOT NULL DEFAULT '',
  PRIMARY KEY (`portalAuditID`),
  KEY `portalUserID` (`portalUserID`),
  KEY `ts` (`ts`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- FZ-Verantwortliche/r als echte Personen-Referenz.
-- `fz_verantwortlicher` (Freitext) bleibt und wird von der Verwaltung im selben
-- UPDATE mitgeschrieben — fz-mail-system/cron.php nutzt es als Mail-Anrede und
-- bleibt dadurch unverändert lauffähig.
-- ---------------------------------------------------------------------------
ALTER TABLE `ecKreis`
  ADD COLUMN IF NOT EXISTS `fz_verantwortlicher_personID` int(11) DEFAULT NULL
    AFTER `fz_verantwortlicher`,
  ADD KEY IF NOT EXISTS `fz_verantwortlicher_personID` (`fz_verantwortlicher_personID`);

-- Nachtrag: Sitzungs-Generation.
-- Erste Fassung verglich die Ablaufpruefung ueber Zeitstempel (JWT-iat gegen
-- pw_changed_at). Beide haben nur Sekundenaufloesung -- faellt ein
-- Passwortwechsel in dieselbe Sekunde wie die Token-Ausgabe, blieb der alte
-- Token gueltig. Ein Zaehler ist exakt und hat keine Zeitfallen.
ALTER TABLE `portalUser`
  ADD COLUMN IF NOT EXISTS `token_gen` int(11) NOT NULL DEFAULT 0
    AFTER `pw_changed_at`;

-- ---------------------------------------------------------------------------
-- Zweite Rolle je EC-Kreis: die/der Ortsverantwortliche.
--
-- Bewusst getrennt von fz_verantwortlicher_personID: die beiden Aufgaben haben
-- nichts miteinander zu tun. Der FZ-Verantwortliche sieht Fuehrungszeugnisse,
-- der Ortsverantwortliche pflegt die Mitgliederliste des Kreises. Wer beides
-- macht, wird in beiden Spalten eingetragen.
-- ---------------------------------------------------------------------------
ALTER TABLE `ecKreis`
  ADD COLUMN IF NOT EXISTS `ortsverantwortlicher_personID` int(11) DEFAULT NULL
    AFTER `fz_verantwortlicher_personID`,
  ADD KEY IF NOT EXISTS `ortsverantwortlicher_personID` (`ortsverantwortlicher_personID`);


-- ---------------------------------------------------------------------------
-- Selbstkontrolle. Nach dem Einspielen ausfuehren -- jede Zeile muss "da"
-- zeigen. Ein "FEHLT" bedeutet, dass die API die /portal/*-Routen mit 503
-- abschaltet (Startup-Guard in src/portal/config.ts).
--
--   mysql -u<user> -p ecnordbund -e "SOURCE portal-schema.sql" && ...
--
-- Die Abfrage veraendert nichts und kann jederzeit wiederholt werden.
-- ---------------------------------------------------------------------------
SELECT 'portalUser' AS objekt, IF(COUNT(*)=1,'da','FEHLT') AS status
  FROM information_schema.tables
 WHERE table_schema = DATABASE() AND table_name = 'portalUser'
UNION ALL SELECT 'portalToken', IF(COUNT(*)=1,'da','FEHLT')
  FROM information_schema.tables
 WHERE table_schema = DATABASE() AND table_name = 'portalToken'
UNION ALL SELECT 'portalAudit', IF(COUNT(*)=1,'da','FEHLT')
  FROM information_schema.tables
 WHERE table_schema = DATABASE() AND table_name = 'portalAudit'
UNION ALL SELECT 'portalUser.token_gen', IF(COUNT(*)=1,'da','FEHLT')
  FROM information_schema.columns
 WHERE table_schema = DATABASE() AND table_name = 'portalUser'
   AND column_name = 'token_gen'
UNION ALL SELECT 'ecKreis.fz_verantwortlicher_personID', IF(COUNT(*)=1,'da','FEHLT')
  FROM information_schema.columns
 WHERE table_schema = DATABASE() AND table_name = 'ecKreis'
   AND column_name = 'fz_verantwortlicher_personID'
UNION ALL SELECT 'ecKreis.ortsverantwortlicher_personID', IF(COUNT(*)=1,'da','FEHLT')
  FROM information_schema.columns
 WHERE table_schema = DATABASE() AND table_name = 'ecKreis'
   AND column_name = 'ortsverantwortlicher_personID';
