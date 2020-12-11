import { user } from './user';
import { userGroup } from './userGroup';
import sendMail from '../schema/mail';
import { query } from '../schema/mysql';
import { sha3_512 } from 'js-sha3';
import { checkToken, createToken } from './jwt';

function hash(pwd: string, salt: string): string {
  return sha3_512(salt + pwd)
}

export async function login(username: string, password: string) {
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
      return await createToken({ userID: ckUser.userID })
    } else {
      throw 'Username und Password passen nicht zusammen'
    }
  }
}


export async function getUser(authToken: string): Promise<user> {
  const data = await checkToken<{ userID: number }>(authToken)
  const usersFound = users.filter(v => v.userID === data.userID)

  if(usersFound.length !== 1) {
    throw 'User not Found'
  }
  return usersFound[0]
}


export let users: Array<user> = []
export let userGroups: Array<userGroup> = []
// export let authKeys: Array<authKey> = []

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
