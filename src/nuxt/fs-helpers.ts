import * as fs from 'fs'
import * as path from 'path'
import { sha3_224 as sha } from 'js-sha3'

const ANMELDUNG_SAVE_DIR = './confirm'

function isToken(token: string) {
  return /[A-Za-z0-9]+/.test(token)
}

export function cleanup() {
  fs.readdirSync(path.join(__dirname, ANMELDUNG_SAVE_DIR)).forEach((file) => {
    if (file.split('.')[1] !== 'json') {
      return
    }

    try {
      const exp = JSON.parse(
        fs.readFileSync(path.join(__dirname, ANMELDUNG_SAVE_DIR, file), 'utf-8')
      ).__internals.expires
      if (expired(exp)) {
        fs.unlinkSync(path.join(__dirname, ANMELDUNG_SAVE_DIR, file))
      }
    } catch (ex) {}
  })
}
export function saveForConfirm(data: any, type: number): string {
  if (!data.__internals) {
    data.__internals = {
      time: new Date(),
      expires: new Date(
        new Date().getTime() + 24 * 60 * 60 * 1000
      ).toISOString(),
      type
    }
  }

  if (typeof data.__internals.expires !== 'string') {
    data.__internals.expires = data.__internals.expires.toISOString()
  }

  const json = JSON.stringify(data)
  const token = sha(json + new Date() + Math.random())
  const filename = path.join(__dirname, ANMELDUNG_SAVE_DIR, token + '.json')
  if (fs.existsSync(filename)) {
    return saveForConfirm(data, type)
  }
  fs.writeFileSync(filename, json)
  return token
}
export function validateToken(token: string): any {
  if (!isToken(token)) throw 'Token not valid'
  const filename = path.join(__dirname, ANMELDUNG_SAVE_DIR, token + '.json')
  // console.log(filename)
  if (!fs.existsSync(filename)) {
    throw 'Bestätigungscode nicht gefunden.'
  }
  const data = JSON.parse(fs.readFileSync(filename, 'utf-8'))

  if (data.finished) {
    throw 'Anmeldung bereits bestätigt.'
  }

  const nData = JSON.stringify({
    __internals: data.__internals,
    finished: true,
    __old: data
  })
  fs.writeFileSync(filename, nData)
  return data
}

function expired(time: string) {
  if (time === 'NEVER') {
    return false
  }
  return new Date().toUTCString() > time
}
