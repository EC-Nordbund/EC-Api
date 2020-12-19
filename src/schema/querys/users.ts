import { user } from '../types'
import { checkToken } from '../../users/jwt'
// import { getUser } from "../../users";

import { addAuth, handleAuth } from '../sonstiges'

export default {
  getMyUserData: {
    type: user,
    args: addAuth(),

    resolve(_, args) {
      return checkToken(args.authToken)
    },
  },
}
