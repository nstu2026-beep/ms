# Study Mission

A premium, installable study planner (PWA) that generates your daily study
target automatically, tracks progress and streaks, and keeps everything in
sync across every device through Firebase.

No frameworks — plain HTML5, CSS3, and vanilla JavaScript (ES modules).

## Features

- Email/password + Google sign-in, password reset, "remember me"
- Private, per-user data in Firestore, synced in real time
- Automatic daily target generation (prioritizes subjects with the most
  remaining classes, carries unfinished classes into the next day)
- Editable subjects, schedule, and daily class target
- Progress tracking (classes, hours, daily/weekly/monthly/overall %)
- Streaks: current, longest, missed days
- Interactive calendar (green/blue/yellow/red day states) with day detail
- Revision checklist (Revision, MCQ Practice, Notes, Weak Topics)
- Dashboard with an orbit-style progress ring, stats, and a daily quote
- Analytics charts (weekly, monthly, subject completion, streak growth)
- Browser notifications (study, revision, goal, streak, daily summary)
- Achievement badges with a confetti celebration on unlock
- Dark/light theme + accent colour picker
- Offline support: Firestore's offline cache queues writes locally and
  syncs automatically when the connection returns — no manual export/import
- Installable PWA with a service worker for offline app-shell loading

## Folder structure

```
study-mission/
├─ index.html          # App shell: auth screen + all views
├─ manifest.json        # PWA manifest
├─ service-worker.js     # App-shell caching for offline loading
├─ firestore.rules        # Security rules — locks data to its owner
├─ css/
│  └─ style.css            # Full design system (dark/light, glassmorphism)
├─ js/
│  ├─ config.js              # Firebase config + app defaults (edit this)
│  ├─ auth.js                  # Firebase Authentication
│  ├─ firestore.js              # Firestore data layer + offline persistence
│  ├─ planner.js                  # Daily target, streaks, achievements logic
│  ├─ charts.js                     # Canvas chart rendering (no dependency)
│  ├─ notifications.js                # Browser Notifications wrapper
│  ├─ confetti.js                       # Achievement-unlock animation
│  └─ app.js                              # Wires everything together
└─ icons/
   ├─ icon-192.png
   └─ icon-512.png
```

## Firebase setup

1. Go to the [Firebase console](https://console.firebase.google.com) and
   create a new project.
2. **Add a web app**: Project settings → General → "Your apps" → add a Web
   app. Copy the `firebaseConfig` object it gives you.
3. Paste those values into `js/config.js`, replacing the placeholders.
4. **Enable Authentication**: Build → Authentication → Sign-in method →
   enable **Email/Password** and **Google**.
5. **Enable Firestore**: Build → Firestore Database → Create database
   (start in production mode — the included rules lock it down).
6. **Deploy the security rules**: install the Firebase CLI
   (`npm install -g firebase-tools`), then from this folder:
   ```bash
   firebase login
   firebase init firestore    # point it at this project, keep firestore.rules
   firebase deploy --only firestore:rules
   ```
7. **Authorized domains**: if you deploy to GitHub Pages or another host,
   add that domain under Authentication → Settings → Authorized domains,
   or Google sign-in will be blocked.

## Running locally

Any static file server works, e.g.:

```bash
npx serve .
# or
python3 -m http.server 8080
```

Then open the printed URL in your browser. (Opening `index.html` directly
via `file://` will not work — ES modules and service workers both require
an http(s) origin.)

## Deploying

**Firebase Hosting**
```bash
firebase init hosting   # public directory: this folder
firebase deploy
```

**GitHub Pages**
Push this folder to a repository and enable Pages on the `main` branch
(root or `/docs`, depending on your setup). Remember to add the resulting
`https://<user>.github.io` domain to Firebase's authorized domains list.

## Notes on the offline model

Firestore's SDK is configured with `enableIndexedDbPersistence` in
`js/firestore.js`. That gives the app a local cache: reads work offline,
and writes made offline are queued and replayed automatically once the
connection returns, with Firestore's own conflict resolution preventing
duplicate writes. The `offline-banner` in the UI simply reflects
`navigator.onLine` so the user knows what's happening — no custom sync
queue was needed.

## Accessibility

- All interactive elements are keyboard reachable with a visible focus ring
- Colour is never the only signal (calendar days also carry text/labels)
- `prefers-reduced-motion` is respected — transitions collapse to instant
- Semantic form labels throughout the auth screen and settings

## Customizing defaults

Default subjects, schedule, daily target, and class duration all live in
`APP_DEFAULTS` inside `js/config.js` — edit them there before a user's
first sign-in (they're only used once, to seed a brand-new account).
