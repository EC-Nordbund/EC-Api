-- Download-Bereich des EC-Portals (09/2026)
--
-- Idempotent (MariaDB 10.5): kann mehrfach eingespielt werden.
--
-- Dev:  cd dev && docker compose exec -T mysql mysql -uroot -proot ecnordbund < ../EC-Api/sql/portal-downloads.sql
-- Prod: mysql -u<user> -p ecnordbund < portal-downloads.sql   (VOR dem API-Deploy)
--
-- Fehlt die Tabelle, antwortet der Download-Bereich mit 503; der Rest des
-- Portals laeuft weiter.

-- ---------------------------------------------------------------------------
-- Dateien liegen als longblob IN der Datenbank, nicht im Dateisystem.
--
-- Begruendung: die API laeuft als Container ohne dauerhaftes Volume, und die
-- Sicherung des Systems ist der Datenbank-Dump. Eine Datei daneben im
-- Dateisystem waere nach dem naechsten Deployment weg -- und niemand merkt es,
-- bis ein Freizeitleiter auf den Link klickt. Gleiches Muster wie skKreisPdf
-- im Schutzkonzept-Modul.
--
-- `inhalt` steht bewusst in derselben Zeile wie die Metadaten (kein Splitten
-- in zwei Tabellen): jede Liste liest die Spalte ohnehin nie mit, die Abfragen
-- zaehlen die Spalten einzeln auf.
--
-- Obergrenze fuer eine Datei sind 10 MB (in src/portal/downloads.ts). Das
-- liegt deutlich unter max_allowed_packet (64 MB in Dev; MariaDB-Standard
-- 16 MB) und passt zu dem, was hier wirklich verteilt wird: Formulare,
-- Merkblaetter, Abrechnungsvorlagen.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `portalDownload` (
  `downloadID`    int(11)      NOT NULL AUTO_INCREMENT,
  `bereich`       varchar(10)  NOT NULL COMMENT 'freizeit | kreis',
  `kategorie`     varchar(80)  NOT NULL DEFAULT '' COMMENT 'frei pflegbar, gruppiert die Liste',
  `titel`         varchar(200) NOT NULL,
  `beschreibung`  varchar(500) NOT NULL DEFAULT '',
  `dateiname`     varchar(255) NOT NULL,
  `mimetype`      varchar(120) NOT NULL DEFAULT 'application/octet-stream',
  `groesse`       int(11)      NOT NULL DEFAULT 0 COMMENT 'Bytes',
  `inhalt`        longblob     NOT NULL,
  `sortierung`    int(11)      NOT NULL DEFAULT 0,
  `aktiv`         tinyint(1)   NOT NULL DEFAULT 1 COMMENT '0 = im Portal unsichtbar, bleibt in der Verwaltung',
  `erstellt`      timestamp    NOT NULL DEFAULT current_timestamp(),
  `geaendert`     timestamp    NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `geaendert_von` int(11)      NOT NULL DEFAULT 0 COMMENT 'users.user_id',
  PRIMARY KEY (`downloadID`),
  KEY `bereich` (`bereich`, `aktiv`, `kategorie`, `sortierung`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Kontrolle
SELECT `bereich`, `kategorie`, COUNT(*) AS dateien, SUM(`groesse`) AS bytes
  FROM `portalDownload` GROUP BY `bereich`, `kategorie`;
