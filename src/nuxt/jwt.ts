import { sign, verify, SignOptions } from 'jsonwebtoken'

const secret_token = process.env.NUXT_SECRET_TOKEN!

export function createToken(
  payload: any,
  expiresIn: SignOptions['expiresIn'] = '100d'
) {
  return new Promise<string>((res, rej) => {
    sign(
      payload,
      secret_token,
      { expiresIn, issuer: 'ec-nordbund' },
      (err: Error | null, encoded: string | undefined) => {
        if (err) {
          rej(err)
          return
        }

        if (!encoded) {
          rej('No Token generated')
          return
        }

        res(encoded)
      }
    )
  })
}

export function checkToken<T = any>(token: string) {
  return new Promise<T>((res, rej) => {
    verify(token, secret_token, (err: Error | null, decoded: any) => {
      if (err) {
        rej(err)
        return
      }

      if (!decoded) {
        rej('No Data provided')
        return
      }

      res(decoded as any as T)
    })
  })
}
