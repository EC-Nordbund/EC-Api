
import { user } from '../types'
import { getUser } from '../../users'

import { addAuth, handleAuth } from '../sonstiges'

export default {
  getMyUserData: {
    type: user,
    args: addAuth(),
    description: 'Comming Soon...',
    resolve: handleAuth((_, args) => {
      return getUser(args.authToken)
    })
  }
}
