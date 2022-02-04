import { sign, verify } from "jsonwebtoken";

const secret_token = process.env.JWT_SECRET!;

export function createToken(payload: any) {
  return new Promise<string>((res, rej) => {
    sign(
      payload,
      secret_token,
      { expiresIn: "100d", issuer: "ec-nordbund" },
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

