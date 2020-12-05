import { authKey } from './authKey';
import { user } from './user';
import { userGroup } from './userGroup';
import sendMail from '../schema/mail';
import { query } from '../schema/mysql';
import { sha3_512 } from 'js-sha3';

function hash(pwd: string, salt: string): string {
  return sha3_512(salt + pwd)
}

export function login(username: string, password: string): string {
  const tmpDate = new Date()
  const getUsers = users
    .filter(v => v.userName === username)
    .filter(user => {
      return tmpDate <= new Date(user.ablaufDatum)
    })
  if (getUsers.length !== 1) {
    throw 'Username und Password passen nicht zusammen'
  } else {
    let ckUser = getUsers[0]
    let h = hash(password, ckUser.salt)
    if (h === ckUser.pwdHash) {
      let authToken = new authKey(ckUser)
      authKeys.push(authToken)
      return authToken.authToken
    } else {
      throw 'Username und Password passen nicht zusammen'
    }
  }
}

export function logout(authToken: string): boolean {
  authKeys = authKeys.filter(v => v.authToken !== authToken)
  return true
}

export function extend(authToken: string): boolean {
  const tmpDate = new Date()
  let keys = authKeys
    .filter(v => v.authToken === authToken)
    .filter(v => {
      return v.ablaufTime > tmpDate
    })
  if (keys.length !== 1) {
    return false
  } else {
    keys[0].extend()
    return true
  }
}

export function getUser(authToken: string): user {
  const tmpDate = new Date()
  const auth = authKeys
    .filter(v => v.authToken === authToken)
    .filter(v => {
      return v.ablaufTime > tmpDate
    })[0]
  if (auth === undefined) {
    throw 'User not Found'
  }
  auth.extend()
  return auth.user
}

export function userReactivation(authToken: string, pin: string) {
  const auth = authKeys
    .filter(v => v.authToken === authToken)[0]
  if (auth === undefined) {
    throw 'User not Found'
  }
  auth.reactivate(pin)
  return auth.user
}

export let users: Array<user> = []
export let userGroups: Array<userGroup> = []
export let authKeys: Array<authKey> = []

async function load() {
  let saveObj = JSON.parse(await query(`SELECT * FROM save`).then(res => res[0].save));
  console.log(saveObj)

  saveObj.userGroups.map(JSON.parse).forEach(v => {
    userGroups.push(new userGroup(v.userGroupID, v.bezeichnung, v.mutationRechte, v.fieldAccess))
  })

  saveObj.users.map(JSON.parse).forEach(v => {
    users.push(new user(v.userID, v.personID, v.userName, v.pwdHash, v.salt, v.ablaufDatum, v.userGroupID, v.pin))
  })
}

async function save() {
  const saveObj = {
    users: users.map(user => user.toSave()),
    userGroups: userGroups.map(group => group.toSave()),
  }

  query(`UPDATE save SET save = '${JSON.stringify(saveObj).split('\\').join('\\\\\\')}'`);

  const saveObj2 = {
    users: users.map(user => JSON.parse(user.toSave(true))),
    userGroups: userGroups.map(group => group.toSave()),
  }

  // Logge status to DB
  query(`INSERT INTO userLogging (JSON) VALUES ('${JSON.stringify(saveObj2)}');`).catch(console.log)
}

(async () => {
  await load()
  await save()
})();

setInterval(save, 60 * 60 * 1000)

export function deleteUser(userID: number) {
  users = users.filter(v => v.userID !== userID)
  save()
}
export function addUser(personID: number, username: string, email: string, gueltigBis: string, userGroupID: number) {
  throw 'Not implemented';
}
export function updateUser(userID: number, gueltigBis: string, userGroupID: number) {
  let u = users.filter(v => v.userID === userID)[0]
  u.ablaufDatum = gueltigBis
  u.userGroupID = userGroupID
  save()
}

export function changePWD(userID: number, oldPWD: string, newPWD: string): boolean {
  let u = users.filter(v => v.userID === userID)[0]
  let oldHash = hash(oldPWD, u.salt)
  if (oldHash === u.pwdHash) {
    const nSalt = sha3_512(`${u.pwdHash}${oldPWD}${Math.random()}${new Date().toISOString()}${newPWD}kjsfksjd`)
    const nHsh = hash(newPWD, nSalt)
    u.salt = nSalt
    u.pwdHash = nHsh
    return true
  } else {
    return false
  }
}
