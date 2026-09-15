/**
 * Empfaenger der Benachrichtigungen rund um Abmeldungen.
 *
 * Stand bisher als Literal in der GraphQL-Mutation `abmelden`. Ruecknahme und
 * Loeschung muessen an denselben Kreis gehen -- wer ueber die Abmeldung
 * informiert wurde, muss auch erfahren, dass sie zurueckgenommen oder die
 * Anmeldung ganz entfernt wurde. Deshalb einmal hier statt dreimal im Code.
 */
export const ABMELDE_VERTEILER =
  'app@ec-nordbund.de;dortje.gaertner@ec-nordbund.de;tobias.krahe@ec-nordbund.de;kirke.husberg@ec-nordbund.de;BirgitHerbert@t-online.de'
