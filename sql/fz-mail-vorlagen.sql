-- Pflegbare Mailtexte des FZ-Systems (2026-09)
--
-- ERZEUGT aus fz-mail-system/vorlagen.php -- nicht von Hand aendern, sondern
-- dort und neu erzeugen (tools/vorlagen-sql.php).
--
-- Idempotent (MariaDB 10.5): kann mehrfach eingespielt werden. Vorhandene
-- Texte bleiben unangetastet, weil sie ab dem ersten Einspielen in der
-- Verwaltung gepflegt werden.
--
-- Dev:  cd dev && docker compose exec -T mysql mysql -uroot -proot ecnordbund < ../EC-Api/sql/fz-mail-vorlagen.sql
-- Prod: mysql -u<user> -p ecnordbund < fz-mail-vorlagen.sql
--
-- Reihenfolge beim Ausrollen: erst dieses SQL, dann die API (liefert die
-- Pflegemaske), dann das FZ-System (liest die Tabelle). Fehlt die Tabelle,
-- nimmt der Cron weiter die Texte aus vorlagen.php -- es geht also nichts
-- verloren, wenn die Reihenfolge einmal nicht eingehalten wird.

CREATE TABLE IF NOT EXISTS `fzMailVorlage` (
  `schluessel`    varchar(50)  NOT NULL COMMENT 'fester Bezug im Code, nicht aenderbar',
  `name`          varchar(120) NOT NULL COMMENT 'Anzeigename in der Verwaltung',
  `beschreibung`  varchar(500) NOT NULL DEFAULT '' COMMENT 'wann diese Mail rausgeht',
  `empfaenger`    varchar(20)  NOT NULL DEFAULT 'person' COMMENT 'person | kreis',
  `platzhalter`   varchar(255) NOT NULL DEFAULT '' COMMENT 'erlaubte Platzhalter, kommagetrennt',
  `betreff`       varchar(255) NOT NULL,
  `text`          mediumtext   NOT NULL COMMENT 'HTML',
  `geaendert_am`  timestamp    NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `geaendert_von` int(11)      NOT NULL DEFAULT 0 COMMENT 'users.user_id, 0 = Auslieferung',
  PRIMARY KEY (`schluessel`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Historie. Diese Texte entscheiden im Ernstfall darueber, dass jemand nicht
-- mehr mit Kindern arbeiten darf -- wer wann was formuliert hat, muss
-- nachlesbar bleiben, und ein versehentlich ueberschriebener Text muss
-- zurueckholbar sein.
CREATE TABLE IF NOT EXISTS `fzMailVorlageVersion` (
  `versionID`  int(11)      NOT NULL AUTO_INCREMENT,
  `schluessel` varchar(50)  NOT NULL,
  `betreff`    varchar(255) NOT NULL,
  `text`       mediumtext   NOT NULL,
  `ts`         timestamp    NOT NULL DEFAULT current_timestamp(),
  `user_id`    int(11)      NOT NULL DEFAULT 0 COMMENT 'users.user_id',
  `anmerkung`  varchar(200) NOT NULL DEFAULT '',
  PRIMARY KEY (`versionID`),
  KEY `schluessel` (`schluessel`, `versionID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Monatsliste an den EC-Kreis
INSERT IGNORE INTO `fzMailVorlage`
  (`schluessel`, `name`, `beschreibung`, `empfaenger`, `platzhalter`, `betreff`, `text`)
  VALUES ('kreisliste', 'Monatsliste an den EC-Kreis', 'Die Übersicht aller Führungszeugnisse des Kreises, als Excel im Anhang. Geht an die Sammeladresse des Kreises, sobald sich etwas geändert hat, mindestens aber am Monatsanfang.',
          'kreis', 'kreis,fz_verantwortlicher', '[FZ] FZ Liste {{kreis}}',
          '<p>Hallo <strong>{{fz_verantwortlicher}}</strong>,  </p>
<p>hier erhältst du deine <strong>aktuelle Übersicht aller erweiterten Führungszeugnisse</strong>, die für deine Gemeinschaft/deinen EC-Kreis bei uns als eingesehen registriert sind.</p>
<p><strong>In der Tabelle sind folgende Informationen enthalten:</strong></p>
<ul>
<li>Personen mit gültigem Führungszeugnis. (Personen, deren Zeugnis in Kürze abläuft, sind gelb markiert.)</li>
<li>Personen, die ein Führungszeugnis beantragt haben, das aber noch nicht vorgelegt wurde. (Solange sie nicht rot markiert sind, dürfen sie mitarbeiten.)</li>
<li>Personen, die von der Mitarbeit definitiv ausgeschlossen sind, weil sie z.B. auch nach mehrfacher Aufforderung kein Führungszeugnis vorlegen konnten oder wollten, ebenso Personen, deren Führungszeugnis abgelaufen ist und die nicht rechtzeitig ein neues beibringen konnten oder wollten, sowie Personen, in deren Führungszeugnis Einträge vorhanden sind, die sie von einer Mitarbeit bei uns ausschließen.</li>
</ul>
<p><strong>Bitte öffne die Datei umgehend und schaue, ob es neue Personen gibt, die gelb oder rot hinterlegt sind. Bei rot markierten Personen müsst ihr sicherstellen, dass diese nicht mehr bei euch mit Kindern und Jugendlichen in Kontakt kommen.</strong></p>
<p>Entschieden für Christus grüßt<br><strong>Kirke Husberg</strong><br><em>Landesreferentin im EC-Nordbund</em></p>
<hr>
<p><em>Dir fehlt jemand auf der Liste?</em><br>Bitte sprich mit der Person, ob sie wirklich den QR-Code gescannt hat, der einen Antrag auf Ausstellung eines erweiterten Führungszeugnisses bei uns auslöst. Sollte das der Fall sein und die Person trotzdem nicht auf der Liste stehen, melde dich umgehend bei jemandem aus dem Referententeam des EC-Nordbundes. Wahrscheinlich hat nur die Ortszuweisung nicht funktioniert.</p>
<p><em>Du kennst Personen nicht, die auf deiner Liste stehen?</em><br>Bitte melde dich umgehend bei jemandem aus dem Referententeam des EC-Nordbundes, damit wir klären können, ob mit der Ortszuweisung der Person etwas schiefgelaufen ist.</p>');

-- Ausschluss von der Mitarbeit — an die Person
INSERT IGNORE INTO `fzMailVorlage`
  (`schluessel`, `name`, `beschreibung`, `empfaenger`, `platzhalter`, `betreff`, `text`)
  VALUES ('ausschluss.person', 'Ausschluss von der Mitarbeit — an die Person', 'Acht Wochen nach dem ersten Antrag liegt noch kein Zeugnis vor: Die Person darf nicht mehr mitarbeiten.',
          'person', 'vorname,nachname', 'Deine Mitarbeit im EC',
          '<p>Hallo <strong>{{vorname}} {{nachname}}</strong>,  </p>
<p>Wir haben trotz mehrfacher Erinnerung kein aktuelles erweitertes Führungszeugnis von dir einsehen können, sodass wir jetzt davon ausgehen müssen, dass du uns aus „gutem Grund“ keine Einsicht gewährst. <strong>Du wirst sicherlich Verständnis dafür haben, dass damit aber leider auch keine Mitarbeit möglich ist.</strong>
Solltest du inzwischen ein erweitertes Führungszeugnis vorgelegt haben und nur bei der Registrierung etwas schief gegangen sein, dann kontaktiere bitte umgehend jemanden aus dem Referententeam des EC-Nordbundes. So etwas wird sich sicherlich aufklären lassen. Aber bis es so weit ist, müssen wir dich leider von der Mitarbeit bei uns entbinden.
Sobald ein aktuelles erweitertes Führungszeugnis ohne einschränkenden Eintrag eingesehen wurde, darfst du auch sofort wieder eingesetzt werden.  </p>
<p><em>Sollte es bei dir so sein, dass du aufgrund eines Eintrags in deinem erweiterten Führungszeugnis nicht mehr mitarbeiten darfst, kannst du dich gerne melden, sobald dein Eintrag gelöscht wurde oder „verfallen“ ist. Wir können uns dann um ein neues aktuelles erweitertes Führungszeugnis von dir bemühen und deine Mitarbeit neu bewerten.</em>  </p>
<p>Danke für allen Einsatz, den du bisher bei uns gebracht hast und von dem wir profitieren durften. Wir würden uns freuen, wenn du uns verbunden bleiben würdest.</p>
<p>Entschieden für Christus grüßt<br><strong>Kirke Husberg</strong><br><em>Landesreferentin im EC-Nordbund</em></p>');

-- Ausschluss von der Mitarbeit — an den EC-Kreis
INSERT IGNORE INTO `fzMailVorlage`
  (`schluessel`, `name`, `beschreibung`, `empfaenger`, `platzhalter`, `betreff`, `text`)
  VALUES ('ausschluss.kreis', 'Ausschluss von der Mitarbeit — an den EC-Kreis', 'Dieselbe Nachricht an die oder den FZ-Verantwortlichen, damit vor Ort sichergestellt wird, dass die Person nicht mehr eingesetzt wird.',
          'kreis', 'vorname,nachname,fz_verantwortlicher', '[FZ - WICHTIG] Mitarbeiter von Mitarbeit im EC ausgeschlossen!',
          '<p>Hallo <strong>{{fz_verantwortlicher}}</strong>, </p>
<p>bei euch in der Kinder- und Jugendarbeit gibt es eine Person, die zukünftig nicht mehr mitarbeiten darf.  </p>
<p><strong>{{vorname}} {{nachname}}</strong></p>
<p>Wir haben trotz mehrfacher Erinnerung kein aktuelles erweitertes Führungszeugnis einsehen können, sodass wir jetzt davon ausgehen müssen, dass aus „gutem Grund“ keine Einsicht gewährt wird. </p>
<p><strong>Damit ist aber auch keine Mitarbeit möglich. Dass es auch zu keiner Mitarbeit vor Ort kommt, musst du sicherstellen.</strong> </p>
<p>Sollte es dabei Probleme geben, bitten wir dich, umgehend mit jemandem aus dem Referententeam des EC-Nordbundes Kontakt aufzunehmen.
Sobald ein aktuelles erweitertes Führungszeugnis vorliegt, erscheint die Person bei dir auf der aktuellen Liste wieder wie gewöhnlich als registrierte Person und darf auch wieder eingesetzt werden.</p>
<p><em>Theoretisch ist es auch möglich, dass die Person einen Eintrag im erweiterten Führungszeugnis hat, der von einer Mitarbeit bei uns ausschließt. Auch für den Fall, müsstest du vor Ort sicherstellen, dass es zu keinem Kontakt mit Kindern und Jugendlichen bei euch in der Gemeinschaft oder im EC-Kreis kommt.</em></p>
<p>Wir haben auch {{vorname}} {{nachname}} darüber informiert, dass zukünftig keine Mitarbeit bei uns erfolgen kann, darf und soll, bis von uns ein aktuelles erweitertes Führungszeugnis ohne einschränkenden Eintrag eingesehen werden konnte. </p>
<p>Entschieden für Christus grüßt<br><strong>Kirke Husberg</strong><br><em>Landesreferentin im EC-Nordbund</em></p>');

-- Zeugnis läuft in acht Wochen ab
INSERT IGNORE INTO `fzMailVorlage`
  (`schluessel`, `name`, `beschreibung`, `empfaenger`, `platzhalter`, `betreff`, `text`)
  VALUES ('laeuft_ab.8w', 'Zeugnis läuft in acht Wochen ab', 'Erste Erinnerung an die Person, acht Wochen vor Ablauf des vorhandenen Zeugnisses.',
          'person', 'vorname,nachname,fz_bis', 'Dein Führungszeugnis läuft in acht Wochen ab',
          '<p>Hallo <strong>{{vorname}} {{nachname}}</strong>,  </p>
<p>danke, dass du mit deiner Mitarbeit den EC-Nordbund überregional oder in der Kinder- und Jugendarbeit deiner Gemeinschaft vor Ort unterstützt.
Wir sind vom Gesetzgeber, wie du weißt, verpflichtet erweiterte Führungszeugnisse der Mitarbeitenden einzusehen. Das ist ein entscheidender Baustein des Kinder- und Jugendschutzes.
Alle fünf Jahre muss ein neues aktuelles erweitertes Führungszeugnis eingesehen werden. Dein letztes von uns eingesehene Führungszeugnis ist nur noch bis zum {{fz_bis}} gültig. Das heißt, dass es in acht Wochen ausläuft.
Ab diesem Tag dürftest du bei uns nicht mehr mitarbeiten, bis wir ein neues Führungszeugnis von dir gesehen haben.  </p>
<p><strong>Deshalb bitten wir dich schon heute, dich um ein neues erweitertes Führungszeugnis zu bemühen und es uns rechtzeitig vorzulegen.</strong> Um einen entsprechenden Antrag zu erhalten scanne den QR Code den der Führungszeugnis-Verantwortliche deiner Ortsgemeinde hat.</p>
<p>Solltest du inzwischen deine Mitarbeit bei uns beendet haben, brauchst du natürlich auch kein neues Führungszeugnis beantragen. In diesem Fall bitten wir dich, uns kurz zu informieren, dass du keine weiteren Mails mehr als Erinnerung erhalten möchtest. Wir streichen dich dann aus unserer Mitarbeiterliste (zumindest bis du deine Mitarbeit neu aufnimmst und ein neues Führungszeugnis beantragst).</p>
<p>Entschieden für Christus grüßt<br><strong>Kirke Husberg</strong><br><em>Landesreferentin im EC-Nordbund</em></p>');

-- Zeugnis läuft in vier Wochen ab
INSERT IGNORE INTO `fzMailVorlage`
  (`schluessel`, `name`, `beschreibung`, `empfaenger`, `platzhalter`, `betreff`, `text`)
  VALUES ('laeuft_ab.4w', 'Zeugnis läuft in vier Wochen ab', 'Zweite Erinnerung, vier Wochen vor Ablauf.',
          'person', 'vorname,nachname,fz_bis', 'Erinnerung dein Führungszeugnis läuft ab',
          '<p>Hallo <strong>{{vorname}} {{nachname}}</strong>,</p>
<p>danke, dass du mit deiner Mitarbeit den EC-Nordbund überregional oder in der Kinder- und Jugendarbeit deiner Gemeinschaft vor Ort unterstützt.
Vor vier Wochen hatten wir dich bereits darüber informiert, dass dein bei uns vorgezeigtes erweitertes Führungszeugnis demnächst seine Gültigkeit verliert und wir ein neues von dir benötigen. Bisher konnten wir noch kein neues Zeugnis von dir einsehen. Das ist nicht weiter dramatisch, weil uns ja noch vier Wochen bleiben, die dein bisheriges Zeugnis gültig ist. Aber bevor du einfach nur vergessen hast, ein neues zu beantragen, kommt hier eine schnelle Erinnerung.
Es erleichtert uns die Übergänge erheblich, wenn du möglichst zeitnah (auf jeden Fall noch vor dem {{fz_bis}}) dein neues Zeugnis bei uns vorzeigen kannst.
Ab diesem Tag dürftest du bei uns nicht mehr mitarbeiten, bis wir ein neues Führungszeugnis von dir gesehen haben.  </p>
<p><strong>Deshalb erinnern wir dich heute nochmal, dich um ein neues erweitertes Führungszeugnis zu bemühen und es uns rechtzeitig vorzulegen.</strong> Um einen entsprechenden Antrag zu erhalten scanne den QR Code den der Führungszeugnis-Verantwortliche deiner Ortsgemeinde hat.  </p>
<p>Solltest du inzwischen deine Mitarbeit bei uns beendet haben, brauchst du natürlich auch kein neues Führungszeugnis beantragen. In diesem Fall bitten wir dich, uns kurz zu informieren, dass du keine weiteren Mails mehr als Erinnerung erhalten möchtest. Wir streichen dich dann aus unserer Mitarbeiterliste (zumindest bis du deine Mitarbeit neu aufnimmst und ein neues Führungszeugnis beantragst).</p>
<p>Entschieden für Christus grüßt<br><strong>Kirke Husberg</strong><br><em>Landesreferentin im EC-Nordbund</em></p>');

-- Zeugnis läuft in zwei Wochen ab
INSERT IGNORE INTO `fzMailVorlage`
  (`schluessel`, `name`, `beschreibung`, `empfaenger`, `platzhalter`, `betreff`, `text`)
  VALUES ('laeuft_ab.2w', 'Zeugnis läuft in zwei Wochen ab', 'Letzte Erinnerung vor Ablauf. Ab dem genannten Tag ist keine Mitarbeit mehr möglich.',
          'person', 'vorname,nachname,fz_bis', 'Erinnerung dein Führungszeugnis läuft ab',
          '<p>Hallo <strong>{{vorname}} {{nachname}}</strong>,</p>
<p>danke, dass du mit deiner Mitarbeit den EC-Nordbund überregional oder in der Kinder- und Jugendarbeit deiner Gemeinschaft vor Ort unterstützt.
Langsam wird es knapp… Vor sechs und vor zwei Wochen hatten wir dich bereits darüber informiert, dass dein bei uns vorgezeigtes erweitertes Führungszeugnis demnächst seine Gültigkeit verliert und wir ein neues von dir benötigen. Bisher konnten wir noch kein neues Zeugnis von dir einsehen.
Es erleichtert uns die Übergänge erheblich, wenn du möglichst zeitnah (auf jeden Fall noch vor dem {{fz_bis}}) dein neues Zeugnis bei uns vorzeigen kannst.  </p>
<p>Innerhalb der nächsten zwei Wochen müssten wir die Einsicht bei uns dokumentieren, damit du ohne Probleme weiter bei uns tätig sein kannst. Ab dem {{fz_bis}} dürfen wir dich sonst nicht mehr als Mitarbeiter einsetzen, bis du ein aktuelles erweitertes Führungszeugnis ohne einschränkenden Eintrag vorgelegt hast. Es wäre sehr ungünstig, wenn hier kein nahtloser Übergang gelingen könnte.<br>Sollte es Gründe geben, die nicht in deinem Verantwortungsbereich liegen, die es dir unmöglich machen, bis in zwei Wochen ein erweitertes Führungszeugnis vorzulegen, melde dich bitte möglichst rechtzeitig bei jemandem aus dem Referententeam des EC-Nordbundes.
Auch wenn es selbstverantwortete Probleme gibt, lass uns reden, bevor diese Frist abgelaufen ist. Wir finden dann hoffentlich eine Lösung.  </p>
<p>Solltest du inzwischen deine Mitarbeit bei uns beendet haben, brauchst du natürlich auch kein neues Führungszeugnis beantragen. In diesem Fall bitten wir dich, uns kurz zu informieren, dass du keine weiteren Mails mehr als Erinnerung erhalten möchtest. Wir streichen dich dann aus unserer Mitarbeiterliste (zumindest bis du deine Mitarbeit neu aufnimmst und ein neues Führungszeugnis beantragst).</p>
<p>Entschieden für Christus grüßt<br><strong>Kirke Husberg</strong><br><em>Landesreferentin im EC-Nordbund</em></p>');

-- Antrag läuft — Nachfrage nach vier Wochen
INSERT IGNORE INTO `fzMailVorlage`
  (`schluessel`, `name`, `beschreibung`, `empfaenger`, `platzhalter`, `betreff`, `text`)
  VALUES ('antrag.4w', 'Antrag läuft — Nachfrage nach vier Wochen', 'Die Person hat einen Antrag bekommen, aber nach vier Wochen noch kein Zeugnis vorgelegt.',
          'person', 'vorname,nachname', 'Erinnerung Führungszeugnis',
          '<p>Hallo <strong>{{vorname}} {{nachname}}</strong>,</p>
<p>du hast vor vier Wochen für deine Mitarbeit bei euch in der Kinder- und Jugendarbeit vor Ort und/oder im EC-Nordbund einen Antrag zur Ausstellung eines erweiterten Führungszeugnisses erhalten. Bisher konnten wir noch kein Zeugnis von dir einsehen. Da die Ausstellung immer etwas Zeit benötigt, ist es nicht ungewöhnlich, dass nach vier Wochen noch nichts vorliegt. Aber bevor die Mail bei dir untergegangen ist, oder der Alltag dich bisher davon abgehalten hat, das erweiterte Führungszeugnis auch zu beantragen, fragen wir mal vorsichtig nach.</p>
<p>Spätestens jetzt solltest du keine Zeit mehr verlieren, damit es bei deiner weiteren Mitarbeit nicht zu Irritationen und Komplikationen kommt. Wir freuen uns daran, dass du dich gerne und leidenschaftlich bei uns investierst, aber der Gesetzgeber verlangt von jedem Mitarbeiter die Einsicht in ein erweitertes Führungszeugnis. Kann diese dauerhaft nicht erfolgen, müssen wir auf die entsprechende Mitarbeit im Sinne des Kinder- und Jugendschutzes verzichten. Das soll uns bei dir nicht passieren…  </p>
<p>Wir wissen, den Aufwand zu schätzen, den die Einholung eines erweiterten Führungszeugnisses für dich bedeutet und danken dir für dein Verständnis, dass wir trotzdem darauf angewiesen sind…</p>
<p>Entschieden für Christus grüßt<br><strong>Kirke Husberg</strong><br><em>Landesreferentin im EC-Nordbund</em></p>');

-- Antrag läuft — noch zwei Wochen
INSERT IGNORE INTO `fzMailVorlage`
  (`schluessel`, `name`, `beschreibung`, `empfaenger`, `platzhalter`, `betreff`, `text`)
  VALUES ('antrag.2w', 'Antrag läuft — noch zwei Wochen', 'Sechs Wochen nach dem Antrag, zwei Wochen vor dem Ausschluss. ACHTUNG: wird zurzeit nicht verschickt — die Zustandslogik in cron.php erzeugt den Sechs-Wochen-Fall nicht.',
          'person', 'vorname,nachname,antrag_ende', 'Erinnerung Führungszeugnis',
          '<p>Hallo <strong>{{vorname}} {{nachname}}</strong>,</p>
<p>du hast vor sechs Wochen für deine Mitarbeit bei euch in der Kinder- und Jugendarbeit vor Ort und/oder im EC-Nordbund einen Antrag zur Ausstellung eines erweiterten Führungszeugnisses erhalten. Bisher konnten wir noch kein Zeugnis von dir einsehen.
Innerhalb der nächsten zwei Wochen müssten wir die Einsicht bei uns dokumentieren, damit du ohne Probleme weiter bei uns tätig sein kannst. Ab dem {{antrag_ende}} dürfen wir dich sonst nicht mehr als Mitarbeiter einsetzen, bis du ein aktuelles erweitertes Führungszeugnis ohne einschränkenden Eintrag vorgelegt hast. Es wäre sehr ungünstig, wenn hier kein nahtloser Übergang gelingen könnte.</p>
<p>Sollte es Gründe geben, die nicht in deinem Verantwortungsbereich liegen, die es dir unmöglich machen, bis in zwei Wochen ein erweitertes Führungszeugnis vorzulegen, melde dich bitte möglichst rechtzeitig bei jemandem aus dem Referententeam des EC-Nordbundes.
Auch wenn es selbstverantwortete Probleme gibt, lass uns reden, bevor diese Frist abgelaufen ist. Wir finden dann hoffentlich eine Lösung.</p>
<p>Entschieden für Christus grüßt<br><strong>Kirke Husberg</strong><br><em>Landesreferentin im EC-Nordbund</em></p>');

-- Zeugnis eingesehen — erstes Mal
INSERT IGNORE INTO `fzMailVorlage`
  (`schluessel`, `name`, `beschreibung`, `empfaenger`, `platzhalter`, `betreff`, `text`)
  VALUES ('eingesehen.erstes', 'Zeugnis eingesehen — erstes Mal', 'Begrüßung, wenn für diese Person zum ersten Mal überhaupt ein Zeugnis eingetragen wurde.',
          'person', 'vorname,nachname', 'Führungszeugnis eingesehen',
          '<p>Herzlich willkommen <strong>{{vorname}} {{nachname}}</strong>,<br>wir haben eben die Einsicht in dein erweitertes Führungszeugnis dokumentiert. Da es erwartungsgemäß keinen einschränkenden Eintrag gab, dürfen wir dich mit Freude in dem großen Pool unserer Ehrenamtlichen begrüßen.
Danke, dass du dich mit Leidenschaft und Hingabe in junge Menschen investierst. Wir wissen das zu schätzen und sind uns im Klaren, dass wir das große Engagement niemals angemessen bezahlen könnten. Deshalb versuchen wir es auch gar nicht erst. Das macht das Ehrenamt aus: Man wird dadurch nicht reich. Zumindest nicht materiell. Aber wir wünschen dir trotzdem die Erfahrung, die so viele von uns machen dürfen: <strong>Geiz ist kein göttliches Prinzip.</strong> Und wir erbeten uns für dich, dass du erleben wirst, dass dir die Zeit, die du in Gottes Reich investierst, nicht an anderer Stelle fehlen wird.
Willkommen im Team.</p>
<p>Entschieden für Christus grüßt<br><strong>Kirke Husberg</strong><br><em>Landesreferentin im EC-Nordbund</em></p>');

-- Zeugnis eingesehen — Folgezeugnis
INSERT IGNORE INTO `fzMailVorlage`
  (`schluessel`, `name`, `beschreibung`, `empfaenger`, `platzhalter`, `betreff`, `text`)
  VALUES ('eingesehen.weiteres', 'Zeugnis eingesehen — Folgezeugnis', 'Bestätigung, wenn ein weiteres Zeugnis eingetragen wurde.',
          'person', 'vorname,nachname', 'Führungszeugnis eingesehen',
          '<p>Hallo <strong>{{vorname}} {{nachname}}</strong>,</p>
<p>wir haben eben die Einsicht in dein erweitertes Führungszeugnis dokumentiert. Wir werden frühestens erst in fünf Jahren wieder erneut nach einem fragen…
Danke, dass du dich mit Leidenschaft und Hingabe in junge Menschen investierst. Wir wissen das zu schätzen und sind uns im Klaren, dass wir das große Engagement niemals angemessen bezahlen könnten. Deshalb versuchen wir es auch gar nicht erst. Das macht das Ehrenamt aus: Man wird dadurch nicht reich. Zumindest nicht materiell. Aber wir wünschen dir trotzdem die Erfahrung, die so viele von uns machen dürfen: <strong>Geiz ist kein göttliches Prinzip.</strong> Und wir erbeten uns für dich, dass du erleben wirst, dass dir die Zeit, die du in Gottes Reich investierst, nicht an anderer Stelle fehlen wird.
Willkommen im Team.</p>
<p>Entschieden für Christus grüßt<br><strong>Kirke Husberg</strong><br><em>Landesreferentin im EC-Nordbund</em></p>');

-- Beschreibungen und erlaubte Platzhalter nachziehen, ohne die Texte
-- anzufassen: die gehoeren ab jetzt der Verwaltung.
UPDATE `fzMailVorlage` SET `name` = 'Monatsliste an den EC-Kreis', `beschreibung` = 'Die Übersicht aller Führungszeugnisse des Kreises, als Excel im Anhang. Geht an die Sammeladresse des Kreises, sobald sich etwas geändert hat, mindestens aber am Monatsanfang.', `empfaenger` = 'kreis', `platzhalter` = 'kreis,fz_verantwortlicher' WHERE `schluessel` = 'kreisliste';
UPDATE `fzMailVorlage` SET `name` = 'Ausschluss von der Mitarbeit — an die Person', `beschreibung` = 'Acht Wochen nach dem ersten Antrag liegt noch kein Zeugnis vor: Die Person darf nicht mehr mitarbeiten.', `empfaenger` = 'person', `platzhalter` = 'vorname,nachname' WHERE `schluessel` = 'ausschluss.person';
UPDATE `fzMailVorlage` SET `name` = 'Ausschluss von der Mitarbeit — an den EC-Kreis', `beschreibung` = 'Dieselbe Nachricht an die oder den FZ-Verantwortlichen, damit vor Ort sichergestellt wird, dass die Person nicht mehr eingesetzt wird.', `empfaenger` = 'kreis', `platzhalter` = 'vorname,nachname,fz_verantwortlicher' WHERE `schluessel` = 'ausschluss.kreis';
UPDATE `fzMailVorlage` SET `name` = 'Zeugnis läuft in acht Wochen ab', `beschreibung` = 'Erste Erinnerung an die Person, acht Wochen vor Ablauf des vorhandenen Zeugnisses.', `empfaenger` = 'person', `platzhalter` = 'vorname,nachname,fz_bis' WHERE `schluessel` = 'laeuft_ab.8w';
UPDATE `fzMailVorlage` SET `name` = 'Zeugnis läuft in vier Wochen ab', `beschreibung` = 'Zweite Erinnerung, vier Wochen vor Ablauf.', `empfaenger` = 'person', `platzhalter` = 'vorname,nachname,fz_bis' WHERE `schluessel` = 'laeuft_ab.4w';
UPDATE `fzMailVorlage` SET `name` = 'Zeugnis läuft in zwei Wochen ab', `beschreibung` = 'Letzte Erinnerung vor Ablauf. Ab dem genannten Tag ist keine Mitarbeit mehr möglich.', `empfaenger` = 'person', `platzhalter` = 'vorname,nachname,fz_bis' WHERE `schluessel` = 'laeuft_ab.2w';
UPDATE `fzMailVorlage` SET `name` = 'Antrag läuft — Nachfrage nach vier Wochen', `beschreibung` = 'Die Person hat einen Antrag bekommen, aber nach vier Wochen noch kein Zeugnis vorgelegt.', `empfaenger` = 'person', `platzhalter` = 'vorname,nachname' WHERE `schluessel` = 'antrag.4w';
UPDATE `fzMailVorlage` SET `name` = 'Antrag läuft — noch zwei Wochen', `beschreibung` = 'Sechs Wochen nach dem Antrag, zwei Wochen vor dem Ausschluss. ACHTUNG: wird zurzeit nicht verschickt — die Zustandslogik in cron.php erzeugt den Sechs-Wochen-Fall nicht.', `empfaenger` = 'person', `platzhalter` = 'vorname,nachname,antrag_ende' WHERE `schluessel` = 'antrag.2w';
UPDATE `fzMailVorlage` SET `name` = 'Zeugnis eingesehen — erstes Mal', `beschreibung` = 'Begrüßung, wenn für diese Person zum ersten Mal überhaupt ein Zeugnis eingetragen wurde.', `empfaenger` = 'person', `platzhalter` = 'vorname,nachname' WHERE `schluessel` = 'eingesehen.erstes';
UPDATE `fzMailVorlage` SET `name` = 'Zeugnis eingesehen — Folgezeugnis', `beschreibung` = 'Bestätigung, wenn ein weiteres Zeugnis eingetragen wurde.', `empfaenger` = 'person', `platzhalter` = 'vorname,nachname' WHERE `schluessel` = 'eingesehen.weiteres';

-- Kontrolle
SELECT `schluessel`, `name`, LENGTH(`text`) AS zeichen, `geaendert_am` FROM `fzMailVorlage` ORDER BY `schluessel`;
