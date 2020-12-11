import { versions } from '../../nichtErlaubteVersionen';
import {
  changePWD,
  getUser,
  login
} from '../../users';
import mail from '../mail';
import { addAuth, handleAllowed } from '../sonstiges';
import {
  GraphQLBoolean,
  GraphQLInt,
  GraphQLNonNull,
  GraphQLString
} from 'graphql';

export default {
  logIn: {
    type: new GraphQLNonNull(GraphQLString),
    description: 'Anmelden',
    args: {
      username: {
        description: 'Benutzername',
        type: new GraphQLNonNull(GraphQLString),
      },
      password: {
        description: 'Passwort',
        type: new GraphQLNonNull(GraphQLString),
      },
      version: {
        description: 'Version der APP',
        type: new GraphQLNonNull(GraphQLString),
      },
    },
    resolve(_, args) {
      if (versions.includes(args.version)) {
        throw 'Version nicht erlaubt'
      }
      return login(args.username, args.password)
    },
  },
  passwordWechseln: {
    type: GraphQLBoolean,
    description: 'Passwort wechseln',
    args: addAuth({
      oldPWD: {
        description: 'Altes Passwort',
        type: new GraphQLNonNull(GraphQLString),
      },
      newPWD: {
        description: 'Neues Passwort',
        type: new GraphQLNonNull(GraphQLString),
      },
    }),
    async resolve(_, args) {
      return changePWD((await getUser(args.authToken)).userID, args.oldPWD, args.newPWD)
    },
  },
  feedback: {
    type: GraphQLBoolean,
    description: 'Comming Soon...',
    args: {
      gesamt: {
        description: 'Comming Soon...',
        type: new GraphQLNonNull(GraphQLInt),
      },
      handhabung: {
        description: 'Comming Soon...',
        type: new GraphQLNonNull(GraphQLInt),
      },
      funktionswunsch: {
        description: 'Comming Soon...',
        type: new GraphQLNonNull(GraphQLString),
      },
      bug: {
        description: 'Comming Soon...',
        type: new GraphQLNonNull(GraphQLString),
      },
      sonstiges: {
        description: 'Comming Soon...',
        type: new GraphQLNonNull(GraphQLString),
      },
    },
    resolve(_, args) {
      return mail(
        'feedback@ec-nordbund.de',
        { to: 'app@ec-nordbund.de' },
        'Feedback',
        `Gesamtbewertung: ${args.gesamt}/5<br/>
          Handhabung: ${args.handhabung}/5<br/>
          Funktionswunsch: ${args.funktionswunsch}<br/>
          Bug: ${args.bug}<br/>
          Sonstiges: ${args.sonstiges}`,
      )
    },
  }
}
