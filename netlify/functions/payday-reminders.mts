import type { Config } from '@netlify/functions'
import { runReminders } from '../lib/app'
import { blobsKV } from '../lib/kv'

// Every hour: anyone whose payday is today and whose reminder time has
// arrived (in their own time zone) gets one notification per payday.
export default async () => {
  const report = await runReminders(blobsKV(), process.env.URL ?? '')
  console.log('payday reminders', JSON.stringify(report))
}

export const config: Config = { schedule: '@hourly' }
