import { getUser } from '../users';
import {
  GraphQLFieldConfigArgumentMap,
  GraphQLFieldResolver,
  GraphQLNonNull,
  GraphQLResolveInfo,
  GraphQLString
} from 'graphql';
import { checkToken } from "../users/jwt";

export function addAuth(args: GraphQLFieldConfigArgumentMap = {}): GraphQLFieldConfigArgumentMap {
  args.authToken = {
    type: new GraphQLNonNull(GraphQLString),
    description: 'Authentifizierungs-Token',
  }
  return args
}

export function handleAuth(cb: GraphQLFieldResolver<any, any>): GraphQLFieldResolver<any, any> {
  return async function (parent: any, args: any, context: any, info: GraphQLResolveInfo) {
    context.user = await getUser(args.authToken)
    return cb(parent, args, context, info)
  }
}

export function handleAllowed(cb: GraphQLFieldResolver<any, any>, queryName: string): GraphQLFieldResolver<any, any> {
  return async function (parent: any, args: any, context: any, info: GraphQLResolveInfo) {
    if (await checkToken(args.authToken)) {
      return cb(parent, args, context, info)
    }
    throw 'Not allowed'
  }
}

export async function checkAuth(authToken: string): Promise<boolean> {
  return !! await checkToken(authToken)
}
