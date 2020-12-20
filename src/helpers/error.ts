import { Response } from 'express'

export class ecError extends Error {
  constructor(message: string, public code = 500) {
    super(message)
    this.name = 'EC-Fehler'
  }
}

export function errorHandler(err: unknown, res: Response): void {
  res.contentType('text/plain')
  if (err instanceof ecError) {
    res.status(err.code).end(err.message)
  } else if (err instanceof Error) {
    res.status(500).end(err.message)
  } else if (typeof err === 'string') {
    res.status(500).end(err)
  } else {
    res.status(500)
    res.end(
      `Ein unerwarteter (komischer) Fehler ist aufgetreten. (Bitte melde ihn.)\nFehler: ${String(
        err
      )}`
    )
  }
}
