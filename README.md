# Scratch & Save

A shared savings-challenge app for couples. Pick a square, scratch it off, and watch your goal fill in together. It's an installable web app: it works in any phone browser and can be added to the home screen like a regular app.

**What's in this first version (the MVP from the build brief):**

- Email sign-in with no password (a magic link plus a 6-digit code)
- Chart generator: enter any goal and timeframe; the default is the classic 100 squares from $3 to $300 ($15,150)
- One shared board per couple, live on both phones. When your partner opens a square, it pulses on your screen
- Tap a square: it lifts, then grows into a scratch card. Back out any time before the first scratch
- Real scratch-off with sound, vibration (Android), and confetti; bigger celebrations at 25/50/75/100%
- "Square scratched · Undo" for 10 minutes after each scratch
- Filter chips (Under $50, Around $100, Big ones) and Surprise me. Nothing is ever locked out
- Per-partner payday reminders (weekly, every 2 weeks, 1st & 15th, monthly) by phone notification, with an optional email backup
- Tracker only: the app never touches money

---

## Setup guide (about 45 minutes, no coding)

You'll create two free accounts:

- **Supabase** stores your accounts and charts and sends sign-in emails.
- **Vercel** puts the app on the internet.

Do the steps in order. Wherever you see `YOUR-…`, put in your own value.

> Screens in Supabase and Vercel change from time to time. If a button has a slightly different name than described here, look for the closest match.

### 1. Create your Supabase project

1. Go to [supabase.com](https://supabase.com) and sign up (signing in with GitHub is easiest).
2. Click **New project**. Name it `scratch-and-save`, create a strong database password (save it somewhere safe), and pick the region closest to you. Click **Create**.
3. Wait a minute or two for it to finish setting up.

### 2. Create the database

1. In your Supabase project, open **SQL Editor** in the left sidebar, then click **New query**.
2. Open [`supabase/schema.sql`](supabase/schema.sql) from this repo, copy **all** of it, and paste it into the editor.
3. Click **Run**. You should see "Success". It's safe to run again if you're unsure.

### 3. Set up sign-in emails

1. Go to **Authentication → Email Templates → Magic Link**.
2. Replace the message body with the text below, then save. This adds the 6-digit code people type in when the link opens in the wrong app (common on iPhone):

   ```html
   <h2>Sign in to Scratch & Save</h2>
   <p><a href="{{ .ConfirmationURL }}">Tap here to sign in</a></p>
   <p>Or enter this code in the app: <strong>{{ .Token }}</strong></p>
   ```

3. Make the same change to the **Confirm signup** template, so first-time sign-ins also show the code.

> **Important for testing with several couples:** Supabase's built-in email sender only sends a few emails per hour. Before inviting your test couples, connect a real email sender under **Authentication → Emails → SMTP Settings**. [Resend](https://resend.com) has a free tier and a Supabase guide.

### 4. Put the app online with Vercel

1. In Supabase, open **Project Settings → API Keys** (or **Data API**) and keep that tab open. You need two values:
   - **Project URL**, which looks like `https://abcdefgh.supabase.co`
   - **Publishable key** (older projects call it the **anon public** key)
2. Go to [vercel.com](https://vercel.com), sign up with GitHub, and click **Add New → Project**.
3. Pick this repository and click **Import**. Vercel detects Vite automatically.
4. Open **Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | your Project URL |
   | `VITE_SUPABASE_KEY` | your publishable (anon) key |

5. Click **Deploy**. After a minute you'll get an address like `https://scratch-and-save.vercel.app`.
6. Back in Supabase, open **Authentication → URL Configuration**:
   - **Site URL:** your Vercel address
   - **Redirect URLs:** add `https://YOUR-APP.vercel.app/**`

**Try it now.** Open your Vercel address on your phone, sign in, and build a chart. Payday reminders come next.

### 5. Install it on your phone

- **iPhone (Safari):** tap **Share**, then **Add to Home Screen**. You need to do this for notifications to work on iPhone.
- **Android (Chrome):** tap the **⋮** menu, then **Install app** (or **Add to Home screen**).

### 6. Turn on payday notifications

1. Open `https://YOUR-APP.vercel.app/setup-keys.html`. This page creates three keys in your browser and doesn't send them anywhere. **Leave the tab open** until you finish this step, because reloading makes new keys.
2. **In Vercel:** go to **Settings → Environment Variables** and add `VITE_VAPID_PUBLIC_KEY` = the public key. Then go to **Deployments**, open the **⋯** menu on the newest one, and click **Redeploy**.
3. **In Supabase, create the reminder function:**
   - Open **Edge Functions** and choose **Deploy a new function → Via Editor**.
   - Name it exactly `payday-reminders`.
   - Delete the sample code and paste in all of [`supabase/functions/payday-reminders/index.ts`](supabase/functions/payday-reminders/index.ts). Click **Deploy**.
   - Open the function's **Details/Settings** and **turn off "Enforce JWT verification"**. The function is protected by your cron secret instead.
4. **In Supabase, add secrets:** go to **Edge Functions → Secrets** and add these:

   | Name | Value |
   |---|---|
   | `VAPID_PUBLIC_KEY` | public key from the keys page |
   | `VAPID_PRIVATE_KEY` | private key from the keys page |
   | `VAPID_SUBJECT` | `mailto:` followed by your email, e.g. `mailto:you@example.com` |
   | `CRON_SECRET` | cron secret from the keys page |
   | `APP_URL` | your Vercel address |

### 7. Run the reminders every hour

1. Open [`supabase/cron.sql`](supabase/cron.sql) and replace the two **CHANGE ME** values:
   - `YOUR-PROJECT-REF` is the part of your Project URL before `.supabase.co`.
   - `YOUR-CRON-SECRET` is the cron secret from step 6.
2. Paste the file into **SQL Editor → New query** and click **Run**.

Every hour, the job checks who has a payday today and whose reminder time has arrived in their own time zone. Each person gets at most one reminder per payday.

### 8. Test a reminder

1. On your phone, open the app and go to **Settings**. Turn on **Payday notifications on this phone**, set a schedule, and tap **Save settings**.
2. In Supabase's **SQL Editor**, run this, filling in your own email, project ref, and cron secret:

   ```sql
   select net.http_post(
     url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/payday-reminders?test_user=' ||
            (select id from auth.users where email = 'you@example.com'),
     headers := jsonb_build_object('x-cron-secret', 'YOUR-CRON-SECRET', 'content-type', 'application/json'),
     body := '{}'::jsonb
   );
   ```

3. Your phone should show "Payday! Ready to scratch one?" within a few seconds. If nothing arrives, look under **Edge Functions → payday-reminders → Logs**.

### 9. Optional: email reminders as a backup

1. Create a [Resend](https://resend.com) account and verify your domain (or use their test sender while trying it out).
2. Add two Supabase secrets:
   - `RESEND_API_KEY`
   - `EMAIL_FROM`, for example `Scratch & Save <reminders@yourdomain.com>`
3. People who switch on **Also email me** in Settings will then get an email on payday too.

### 10. Invite your partner

Tap **Settings → Invite your partner** and share the link, or read them the 6-character code. They sign in with their own email and land on your chart.

---

## Good to know

- **iPhone notifications** only work after adding the app to the Home Screen (iOS 16.4 or newer). The email backup is there for anyone who misses them.
- **Vibration** works on Android. iPhone browsers don't allow websites to vibrate, so iPhones get the sound and confetti.
- **Starting a new chart** archives the old one. Old charts and squares stay in the database.
- **Your data:** each couple can only see their own chart, which is enforced inside the database (row-level security), not just in the app.

## Project layout

```
src/
  App.tsx                  sign-in → welcome → chart setup → invite → reminders → board
  screens/Board.tsx        the shared grid, filters, lift-and-expand, undo, live partner updates
  components/ScratchCard.tsx  the canvas scratch-off
  lib/useCouple.ts         loads data and keeps both phones in sync (Supabase Realtime)
  lib/payday.ts            payday rules (shared with the reminder function)
  sw.ts                    service worker: offline shell and push notifications
supabase/
  schema.sql               tables, security rules, and the actions the app calls
  cron.sql                 hourly reminder job
  functions/payday-reminders/index.ts
public/setup-keys.html     in-browser key generator for notifications
```

## Running it on your own computer (developers)

```bash
npm install
cp .env.example .env.local   # fill in your Supabase values
npm run dev
```

Push notifications only work in a production build served over HTTPS (`npm run build && npm run preview` works on localhost).
