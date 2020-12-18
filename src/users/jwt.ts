import { sign, verify } from "jsonwebtoken";

const secret_token = process.env.JWT_SECRET!;

type payload = {
  userID: number
  username: string
  personID: number
  ablaufDatum: string
}

export function createToken(payload: payload) {
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

export function checkToken(token: string) {
  return new Promise<payload>((res, rej) => {
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

        res((decoded as any) as payload);
      }
    );
  });
}