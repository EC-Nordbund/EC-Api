import { query } from './mysql'
import { createTransport } from 'nodemailer'
import { Readable } from 'stream'

/**
 * Empfänger Object
 */
interface empfaenger {
  to: string
  cc?: string
  bcc?: string
}

/**
 * SMTP-Transport
 */
const smtp = createTransport({
  host: process.env.SMTP_SERVER || '',
  port: parseInt(process.env.SMTP_PORT || '1'),
  auth: {
    user: process.env.SMTP_USERNAME || '',
    pass: process.env.SMTP_PASSWORD || ''
  }
})

/**
 * Sendet eine E-Mail mit den gegeben Parametern
 *
 * @author Sebastian
 *
 * @param from Absender E-Mail (muss mit @ec-nordbund.de enden)
 * @param e Empfänger (TO, CC, BCC)
 * @param subject Betreff
 * @param body Body
 * @param isHTML Ist Body HTML
 * @param attachments Array von Attachments
 */
export default async function sendMail(
  from: string,
  e: empfaenger,
  subject: string,
  body: string,
  isHTML = true,
  attachments: Array<{
    content: string | Readable | Buffer
    filename: string
  }> = [],
  replyTo: string = ''
): Promise<true> {
  if (!replyTo) replyTo = from

  const mailData = {
    from,
    to: e.to,
    cc: e.cc ?? '',
    bcc: e.bcc ?? '',
    subject,
    replyTo,
    ...(isHTML ? { html: body } : { text: body }),
    attachments: attachments.map((at) => ({
      ...at,
      ...(typeof at.content === 'string' ? { encoding: 'base64' } : {})
    }))
  }
  await smtp.sendMail(mailData)
  await query(
    `INSERT INTO gesendeteEmails (content) VALUES ('${JSON.stringify(
      mailData
    )}')`
  )

  return true
}
