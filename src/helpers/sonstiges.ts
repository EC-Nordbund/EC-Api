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

export function handleAuth(
  cb: GraphQLFieldResolver<any, any>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _?: string
): GraphQLFieldResolver<any, any> {
  return async function (
    parent: any,
    args: any,
    context: any,
    info: GraphQLResolveInfo
  ) {
    if (await checkToken(args.authToken)) {
      return cb(parent, args, context, info)
    }
    throw 'Not allowed'
  }
}
