import {
  GraphQLFieldConfigArgumentMap,
  GraphQLFieldResolver,
  GraphQLNonNull,
  GraphQLResolveInfo,
  GraphQLString
} from 'graphql'
import { checkToken } from './jwt'

export function addAuth(
  args: GraphQLFieldConfigArgumentMap = {}
): GraphQLFieldConfigArgumentMap {
  args.authToken = {
    type: new GraphQLNonNull(GraphQLString),
    description: 'Authentifizierungs-Token'
  }
  return args
}

/**
 * Das gepruefte Token-Payload wird dem Resolver als `context.auth`
 * durchgereicht. Vorher verfiel es ungenutzt -- damit war in keiner Mutation
 * feststellbar, wer sie ausgeloest hat, und protokollieren liess sich nichts.
 * Resolver, die das nicht brauchen, merken von der Erweiterung nichts.
 */
export function handleAuth(
  cb: GraphQLFieldResolver<any, any>
  // // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // _?: string
): GraphQLFieldResolver<any, any> {
  return async function (
    parent: any,
    args: any,
    context: any,
    info: GraphQLResolveInfo
  ) {
    const auth = await checkToken(args.authToken)
    if (auth) {
      return cb(parent, args, { ...context, auth }, info)
    }
    throw 'Not allowed'
  }
}
