-- Protokoll fuer eingreifende Aenderungen an Anmeldungen (EC-Verwaltung)
--
-- Idempotent (MariaDB 10.5): kann mehrfach eingespielt werden.
-- Liegt im API-Repo, weil sie zum Deployment gehoert; die Dev-Umgebung mountet
-- sie direkt von hier (dev/docker-compose.yml).
--
-- Dev:  cd dev && docker compose exec -T mysql mysql -uroot -proot ecnordbund < ../EC-Api/sql/anmeldung-protokoll.sql
-- Prod: mysql -u<user> -p ecnordbund < anmeldung-protokoll.sql   (VOR dem API-Deploy)
--
-- Fehlt die Tabelle, verweigern Ruecknahme und Loeschung den Dienst (503) --
-- beides sind Eingriffe, die den bisherigen Stand ueberschreiben bzw. ganz
-- beseitigen; ohne "wer, wann, warum" waeren sie nicht nachvollziehbar. Die
-- bestehende Abmeldung laeuft dagegen weiter, sie ueberspringt nur den
-- Protokolleintrag (gleiche Abwaegung wie bei dublettenLog).

-- ---------------------------------------------------------------------------
-- Bewusst KEIN Fremdschluessel auf `anmeldungen`: der haeufigste Grund, hier
-- nachzusehen, ist eine geloeschte Anmeldung -- und genau deren Zeile gibt es
-- dann nicht mehr. Ein FK wuerde den Eintrag mitloeschen und das Protokoll
-- ausgerechnet im wichtigsten Fall leeren.
--
-- `personID`/`veranstaltungsID` stehen redundant daneben, damit eine geloeschte
-- Anmeldung ueber Person und Freizeit auffindbar bleibt; die anmeldeID kennt
-- nach der Loeschung niemand mehr auswendig.
--
-- `vorher`/`nachher` enthalten NUR Status-, Zahlungs- und Abmeldefelder als
-- JSON. KEINE Gesundheits-, Allergie- oder Bemerkungstexte und kein
-- extra_json: das sind Angaben nach DSGVO Art. 9 ueber Minderjaehrige. Ein
-- Protokoll, das sie mitschreibt, macht die Loeschung wirkungslos -- die Daten
-- waeren nur umgezogen (gleiche Regel wie portalAudit und dublettenLog).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `anmeldungProtokoll` (
  `protokollID`      int(11)      NOT NULL AUTO_INCREMENT,
  `ts`               timestamp    NOT NULL DEFAULT current_timestamp(),
  `anmeldeID`        varchar(15)  NOT NULL,
  `personID`         int(11)      NOT NULL DEFAULT 0,
  `veranstaltungsID` int(11)      NOT NULL DEFAULT 0,
  `user_id`          int(11)      NOT NULL DEFAULT 0 COMMENT 'users.user_id; 0 = unbekannt',
  `aktion`           varchar(30)  NOT NULL COMMENT 'abmelden|ruecknahme|loeschen',
  `begruendung`      varchar(500) NOT NULL DEFAULT '',
  `vorher`           text         NOT NULL COMMENT 'JSON, nur Status-/Zahlungsfelder',
  `nachher`          text         NOT NULL COMMENT 'JSON, leer bei loeschen',
  `ip`               varchar(45)  NOT NULL DEFAULT '',
  PRIMARY KEY (`protokollID`),
  KEY `anmeldeID` (`anmeldeID`, `ts`),
  KEY `veranstaltungsID` (`veranstaltungsID`, `ts`),
  KEY `personID` (`personID`, `ts`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Kontrolle
SELECT `aktion`, COUNT(*) AS eintraege, MAX(`ts`) AS zuletzt
  FROM `anmeldungProtokoll` GROUP BY `aktion`;
