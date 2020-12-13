import { sign, verify } from "jsonwebtoken";

const secret_token = process.env.JWT_SECRET || "dsfsöldfjjöldsf";

export function createToken(payload: any) {
  return new Promise<string>((res, rej) => {
    sign(
      payload,
      secret_token,
      { expiresIn: "13h", issuer: "ec-nordbund" },
      (err: Error | null, encoded: string | undefined) => {
        if (err) {
          rej(err);
          return;
        }

        if (!encoded) {
          rej("No Token generated");
          return;
        }

        res(encoded);
      }
    );
  });
}

export function createToken2(payload: any, token: string, time = "100d") {
  return new Promise<string>((res, rej) => {
    sign(
      payload,
      token,
      { expiresIn: time, issuer: "ec-nordbund" },
      (err: Error | null, encoded: string | undefined) => {
        if (err) {
          rej(err);
          return;
        }

        if (!encoded) {
          rej("No Token generated");
          return;
        }

        res(encoded);
      }
    );
  });
}

export function checkToken<T = any>(token: string) {
  return new Promise<T>((res, rej) => {
    verify(
      token,
      secret_token,
      (err: Error | null, decoded: object | undefined) => {
        if (err) {
          rej(err);
          return;
        }

        if (!decoded) {
          rej("No Data provided");
          return;
        }

        res((decoded as any) as T);
      }
    );
  });
}

export async function checkAuth(authToken: string): Promise<boolean> {
  return !! await checkToken(authToken)
}

export async function checkAuthThrow(authToken: string) {
  if (!await checkAuth(authToken)) {
    throw 'Not allowed'
  }
}