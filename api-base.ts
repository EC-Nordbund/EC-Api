// @ts-expect-error no dep
import { get as idb_get, set as idb_set } from 'idb-keyval'
// @ts-expect-error no dep
import Vue from 'vue'
// @ts-expect-error no dep
import { fileSave } from 'browser-nativefs'

export class Base {
  constructor(protected url: string) {}

  protected getSecretKey(): string {
    // TODO: cache + make api request
    return this.getAuthToken()
  }

  protected getAuthToken(): string {
    return Vue.prototype.$authToken
  }

  protected async errorHandler(res: Response): Promise<any> {
    if (res.status !== 200) throw await res.text()
    return res.json()
  }

  protected saveFile(
    extension: string,
    fileName: string
  ): (res: Response) => Promise<any> {
    return (res: Response) => {
      const blob = res.blob()
      return fileSave(blob, {
        fileName,
        extensions: [extension],
        description: 'Generierte Datei speichern.'
      })
    }
  }

  protected getHeaders(withAuth: boolean): Record<string, string> {
    if (withAuth) {
      return {
        'content-type': 'application/json',
        authorization: this.getAuthToken()
      }
    } else {
      return {
        'content-type': 'application/json'
      }
    }
  }

  protected async handleCache(
    network: Promise<any>,
    key: string
  ): Promise<any> {
    return new Promise((res, rej) => {
      const cached_val_promise = idb_get(key)

      let finished = false

      cached_val_promise.then((cached) => {
        if (!finished) {
          finished = true
          if (
            cached === undefined ||
            cached.valid_until - new Date().getTime() < 0
          ) {
            // Not valid cache
            if (!navigator.onLine) {
              // When offline use this cache even it is old.
              res(cached.value)
            } else {
              fail = 'Keine Daten Lokal gespeichert'
              res(network)
            }
          } else {
            res(cached.value)
          }
        }
      })

      network.then((net) => {
        if (!finished) {
          finished = true
          res(net)
        }
      })

      network.then((net) => {
        idb_set(key, {
          valid_until: new Date().getTime() + 30 * 24 * 60 * 60 * 1000,
          value: net
        })
      })

      let fail = ''

      network.catch((v) => {
        if (fail) {
          rej(fail + '\\n' + v)
        }
        fail = v
      })

      cached_val_promise.catch((v) => {
        if (fail) {
          rej(v + '\\n' + fail)
        }
        fail = v
      })
    })
  }

  private encrypt(data: any): string {
    // TODO: encrypt
    return data as any
  }

  private decrypt(data?: string): any {
    if (!data) {
      return data
    }

    // TODO: decrypt
    return data as any
  }

  protected async handleSecureCache(
    network: Promise<any>,
    key: string
  ): Promise<any> {
    return new Promise((res, rej) => {
      const cached_val_promise = idb_get(key).then(this.decrypt)

      let finished = false

      cached_val_promise.then((cached) => {
        if (!finished) {
          finished = true
          if (
            cached === undefined ||
            cached.valid_until - new Date().getTime() < 0
          ) {
            // Not valid cache
            if (!navigator.onLine) {
              // When offline use this cache even it is old.
              res(cached.value)
            } else {
              fail = 'Keine Daten Lokal gespeichert'
              res(network)
            }
          } else {
            res(cached.value)
          }
        }
      })

      network.then((net) => {
        if (!finished) {
          finished = true
          res(net)
        }
      })

      network.then((net) => {
        idb_set(
          key,
          this.encrypt({
            valid_until: new Date().getTime() + 14 * 24 * 60 * 60 * 1000,
            value: net
          })
        )
      })

      let fail = ''

      network.catch((v) => {
        if (fail) {
          rej(fail + '\\n' + v)
        }
        fail = v
      })

      cached_val_promise.catch((v) => {
        if (fail) {
          rej(v + '\\n' + fail)
        }
        fail = v
      })
    })
  }
}
