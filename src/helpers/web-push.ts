import sql from 'sql-escape-tag'
import { sendNotification, setVapidDetails } from 'web-push'
import { query } from './mysql'

type subscription = any
type payload = {
  title: string
  body: string
}

setVapidDetails(
  'mailto:app@ec-nordbund.de',
  process.env.VAPID_PUBLIC!,
  process.env.VAPID_PRIVATE!
)

async function createNotification(
  subscription: subscription,
  payload: payload
): Promise<void> {
  await sendNotification(subscription, JSON.stringify(payload))
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export async function sendNotificationToAll(payload: payload): Promise<void> {
  const subs = await query(sql`SELECT * from web_push`)
  await Promise.all(
    subs.map((s) => createNotification(JSON.parse(s.subscription), payload))
  )
}

export async function sendNotificationToUser(
  user_id: number,
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  payload: payload
): Promise<void> {
  const subs = await query(
    sql`SELECT * from web_push WHERE user_id = ${user_id}`
  )
  await Promise.all(
    subs.map((s) => createNotification(JSON.parse(s.subscription), payload))
  )
}

export async function saveSubscription(
  subscription: subscription,
  user_id: number
): Promise<void> {
  console.log(subscription)

  await query(
    sql`INSERT INTO web_push (user_id, subscription) VALUES (${user_id}, ${JSON.stringify(
      subscription
    )})`
  )
}
