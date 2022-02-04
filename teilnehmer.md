# Bilder auf Freizeiten
Wir machen auf unseren Veranstaltungen Fotos (und manchmal Videos) auf denen auch du zu sehen sein könntest. Wir verwenden solche Bilder für Werbezwecke (insbesondere für die selbe Veranstaltung in folgenden Jahren). 

# Welche Daten wir sammeln und warum wir sie sammeln
## Identifikationsdaten und Kontaktdaten

Wir erheben Geschlecht, Vorname, Nachname, Geburtsdatum, Anschrift, Telefon und E-Mail zur Erfüllung unseres Vertrages zur Freizeitleistungserbringung, unseres Satzungszweckes, sowie aufgrund gesetzlicher Pflichten.

## Gesundheitsinformationen

Wir erheben Lebensmittelunverträglichkeiten, normale oder vegetarische Verpflegung, notwendige Medikamenteneinnahmen, Körperbehinderungen, Krankheiten sowie weitere Gesundheitsinformationen zur Erfüllung unseres Vertrages zur Freizeitleistungserbringung und zum Schutz des Lebens.

## Bemerkungen und Erlaubnisse

Wir erheben Bemerkungen und Wünsche, sowie sämtliche Erlaubnisse und Einwilligungen (ggf. von Erziehungsberechtigen) zur Erfüllung unseres Vertrages zur Freizeitleistungserbringung.


# Deine Rechte
## Auskunftsrecht
Du hast das Recht jederzeit eine Kopie deiner Daten, die bei uns gespeichert sind zu erhalten. Bitte wende dich dazu an Thomas Seeger oder an unseren Datenschutzbeauftragten. Dieses Auskunftsrecht bedeutet einen unheimlich hohen Verwaltungsaufwand für uns. Wir bitten daher darum, nicht leichtfertig von diesem Recht Gebrauch zu machen.

## Berichtigungsrecht
Müssen deine Daten in irgendeiner Form berichtigt oder ergänzt werden, ist dies ebenfalls über Thomas Seeger oder unseren Datenschutzbeauftragten möglich.

## Recht auf Löschung (Recht auf Vergessenwerden)
Da wir die Daten (insbesondere Gesundheitsdaten) zu deinem Schutz erheben und im Streitfall belegen müssen, dass wir alles Richtig gemacht haben (also z.B. eine Allergie uns nicht mitgeteilt wird etc.) und aufgrund Gesetzlicher Pflichten speichern wir die Daten bis entsprechende vergehen verjährt wären und anonymisieren danach die Daten.

## Recht auf Datenübertragbarkeit
Du hast das Recht deine Daten in einem strukturierten, gängigen und maschinenlesbaren Format hierbei verwenden wir JSON. Du erhältst eine solche Datei wenn du Auskunft über deine Daten anforderst.

# Softwarekonzept
Wir benutzen verschiedene Programme für die Verwaltung:

## Microsoft-Office
Hierbei nutzen wir insbesondere Word, Excel und Outlook.

## Verwaltungssoftware
Diese wird von Tobias Krause und Sebastian Krüger extra für unsere Zwecke entwickelt. Der Quelltext ist Open Source und kann unter github.com/EC-Nordbund eingesehen werden.

## Datenbank
Als Datenbank verwenden wir MariaDB was eine weiterentwicklung von MySQL ist.

## Sicherungskonzept
Wir sichern in regelmäßigen Abständen die gesamten Daten, die wir haben, damit bei einem Server-Crash oder ähnlichen nicht zu viele Daten verloren gehen. Sicherungen werden dabei mehrere Monate aufbewahrt.

## Sicherheitskonzept
Wir benutzen bei allen Wegen die Ihre Daten machen eine SSL verschlüsselte Verbindung. Ausnahmen stellen hierbei nur Briefe und Ausdrucke für Veranstaltungen etc. dar.

## Berechtigungskonzept
Um Zugang zu den Daten zu erhalten sind für jeden Benutzer ein Benutzername und ein sicheres Passwort einzugeben.
Wir haben unsere Mitarbeiter darüber aufgeklärt, dass sie Ihr Password regelmäßig wechseln sollten und sie keine Daten an dritte weitergeben dürfen.
Jeder Mitarbeiter hat nur so viele Rechte wie er grade eben braucht. Weiter Infos wer welche Berechtigung hat kannst du unserem Verarbeitungsverzeichnis entnehmen.

## Weitergabe an Dritte
Wir geben deine Daten so wenig wie möglich an dritte weiter. Mit jedem dritten haben wir / werden wir einen sogenannten Auftragsdatenverarbeitung-Vertrag geschlossen / schließen.

Wir geben deine Daten, wenn unbedingt nötig an z.B. das Busunternehmen, die Unterkunft, etc. weiter.

In jedem Fall werden wir Vorname, Nachname, Geburtsdatum, Geschlecht, Anschrift, Telefon an die entsprechenden Stellen weitergeben um Zuschüsse zu beantragen. Würden wir das nicht tun wären unsere Veranstaltungen deutlich teurer…

Beispielsweise unsere Freizeitbriefe schicken wir mit der Post. Dadurch erhält die Post Zugriff auf eure Anschrift durch den entsprechenden Anschrift-Aufdruck.

## Löschkonzept
Soweit möglich löschen wir keine Daten.
X Jahren nach der letzten Aktivität einer Personen werden die Daten automatisch pseudonymisiert d.h. wir haben zwar noch Daten wie Postleitzahl und auf welchen Veranstaltungen die Person war, können aber nicht mehr sagen wer diese Person ist. Dazu wird u.a. dein Vorname, Nachname, Straße, Ort, E-Mails etc. mit einer sogenannten HASH-Funktion gehascht. Dabei entstehen Hashes wie „08e2380abdd70eb705cfd4cc67c0258fccd“. Eine solche HASH-Funktion kann nicht umgekehrt werden. Dadurch entfernen wir aus deinen Daten den persönlichen Charakter. Und kommen so dem Recht nach vergessen nach.