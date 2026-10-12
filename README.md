# Stax

A shared savings-challenge app for couples. Pick a square, scratch it off, and watch your goal fill in together. Stax is a progressive web app: it runs in any phone browser and can be added to the home screen like a regular app.

Everything runs on **Netlify**. There are no other services to sign up for, and no keys or settings to copy around.

**What's in this version:**

- Accounts with email and password, including "forgot password" (Netlify Identity)
- Chart generator: enter any goal and timeframe. Every chart has 100 squares, priced so they add up to exactly your goal (change it any time from the board or Settings; squares already scratched keep their amounts)
- One shared board per couple. Your partner's scratches show up on your phone within a few seconds, and so does the square they have open (it pulses)
- Tap a square: it lifts, then grows into a scratch card. Back out any time before the first scratch
- Real scratch-off with sound, vibration (Android), and confetti; bigger celebrations at 25/50/75/100%
- "Square scratched · Undo" for 10 minutes after each scratch
- If you both try to scratch the same square, only the first one counts
- Small, Medium and Large filters (each exactly a third of the squares) and Surprise me. Nothing is ever locked out. New charts mix small, medium and large squares evenly across the board
- Per-partner payday reminders (weekly, every 2 weeks, 1st & 15th, monthly) as phone notifications
- Tracker only: Stax never touches money

---

## Setup guide (about 10 minutes)

### 1. Deploy to Netlify

1. Log in to [app.netlify.com](https://app.netlify.com).
2. Click **Add new project → Import an existing project → GitHub**, then pick the **Stax** repository.
3. Leave the build settings as they are; they're read from `netlify.toml`. Click **Deploy**.
4. Wait a minute or two. When it finishes, you get an address like `https://your-name.netlify.app`.

### 2. Turn on accounts (Netlify Identity)

**Accounts won't work until you do this step.** Without it, creating an account shows "Sign-in isn't turned on for this site yet."

1. In your Netlify project, open **Project configuration → Identity**. On older screens it may be **Site configuration → Identity** or an **Identity** tab.
2. Click **Enable Identity**.
3. Under **Registration**, leave it **Open** so new people can sign up.
4. Optional: customize the confirmation and password-reset emails under **Identity → Emails** (for example, with the Stax name).

New accounts get a confirmation email by default. People tap the link, return to Stax, and log in. If you'd rather skip that step, look for an autoconfirm option in your Identity settings; the app handles either setting.

### 3. Try it

Open your Netlify address on your phone, create an account, and build a chart.

### 4. Install it on your phone

- **iPhone (Safari):** tap **Share**, then **Add to Home Screen**. You need to do this for notifications to work on iPhone.
- **Android (Chrome):** tap the **⋮** menu, then **Install app** (or **Add to Home screen**).

### 5. Turn on payday notifications

1. Open Stax from your home screen and tap the **⚙ Settings** button.
2. Set your pay schedule and reminder time, then switch on **Payday notifications on this phone**.
3. Tap **Send a test notification** to check it works.
4. Tap **Save settings**.

Payday reminders run automatically every hour. No setup is needed: the notification keys are created the first time someone turns notifications on, and the hourly check is a Netlify Scheduled Function that ships with the code. Each person gets at most one reminder per payday, at their chosen time in their own time zone.

### 6. Invite your partner

Tap **Settings → Invite your partner** and share the link, or read them the 6-character code. They create their own account and land on your chart.

### 7. Turn on your admin dashboard (just for you)

1. In Netlify, open **Project configuration → Environment variables** and click **Add a variable**.
2. Set the key to `ADMIN_EMAILS` and the value to the email you sign in to Stax with. To add more than one admin, separate the emails with commas.
3. Optional: add `ADMIN_TIMEZONE` (for example `America/Chicago`, the default) to choose which time zone the dashboard uses to count days.
4. Go to **Deploys** and click **Trigger deploy → Deploy project** so the setting takes effect.
5. In Stax, open **Settings**. You'll see an **Admin dashboard** button. Nobody else sees it, and the server refuses the data to anyone not on the list.

The dashboard shows:

- **Totals:** how many people have signed up, how many couples are paired, squares scratched, dollars tracked, and how many people have notifications on.
- **Activity:** who's active today, this week, and this month, plus daily charts of active people and squares scratched (tap a bar, or switch to the table view).
- **What people use:** each feature with how many times it was used and by how many people over the last 30 days. Features include scratching, filters, Surprise me, Undo, backing out of a card, sharing the invite, settings, and notifications.
- **People:** each person's last visit, days active, opens, scratches, partner, device, whether they installed the app, and whether reminders led to a scratch.
- **Couples:** each couple's progress, and whether both partners were active this week. That's the key question from the validation plan.
- **Payday reminders:** how often a reminder was followed by a scratch within 24 hours.
- **Recent activity:** a live feed of the last things people did.

Usage is recorded on your own Netlify account, alongside the charts. Let your testers know their activity in the app is tracked to improve it.

---

## Good to know

- **iPhone notifications** only work after adding Stax to the Home Screen (iOS 16.4 or newer).
- **Vibration** works on Android. iPhone browsers don't allow websites to vibrate, so iPhones get the sound and confetti.
- **Updates between phones** arrive within about 3 seconds while the app is open. The app only checks for updates while it's on screen, which keeps usage low.
- **Starting a new chart** archives the old one.
- **Your data** lives in Netlify Blobs on your Netlify account. Each person can only see the chart they belong to; the server checks this on every request.
- **Usage:** each open phone makes about one small request every few seconds, plus one hourly reminder check. For a handful of test couples that's a tiny share of a paid Netlify plan.

## Project layout

```
src/                         the app
  App.tsx                    sign-in → welcome → chart setup → invite → reminders → board
  screens/Admin.tsx          the admin dashboard (admins only)
  screens/Board.tsx          the shared grid, filters, lift-and-expand, undo, partner updates
  components/ScratchCard.tsx the canvas scratch-off
  lib/useCouple.ts           loads data and keeps both phones in step
  lib/payday.ts              payday rules (shared with the reminder function)
  sw.ts                      service worker: offline shell and notifications
netlify/
  functions/api.mts          the backend (/api/*)
  functions/payday-reminders.mts   hourly payday check
  lib/app.ts                 all the backend logic
  lib/auth.ts                checks the signed-in user with Netlify Identity
  lib/kv.ts                  storage (Netlify Blobs)
  lib/analytics.ts           usage recording + the admin dashboard data
netlify.toml                 build settings
```

## Running it on your own computer (developers)

```bash
npm install
npm install -g netlify-cli
netlify link        # connect to your Netlify project (needed for Identity)
netlify dev         # runs the app and the functions together
```

Push notifications need HTTPS, so test them on the deployed site.
