# Ideation Challenge App

A structured ideation platform for research sessions with individual and group phases, optional AI assistance, and post-session surveys.

---

## Stack

- **Frontend:** React + Vite, deployed to GitHub Pages
- **Backend:** Firebase (Firestore + Auth + Cloud Functions)
- **AI:** Anthropic Claude API (via Cloud Functions only)

---

## One-time Setup

### 1. Firebase Project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project**, name it `ideation-app`
3. Disable Google Analytics (not needed), create project

**Enable Authentication:**
- Sidebar: Build → Authentication → Get started
- Sign-in method tab → Enable **Email/Password**

**Enable Firestore:**
- Sidebar: Build → Firestore Database → Create database
- Choose **Production mode**
- Select region: `europe-west1` (closest to Dublin)

**Enable Cloud Functions:**
- Sidebar: Build → Functions → Get started
- This requires upgrading to the **Blaze (pay-as-you-go)** plan
- Cost is minimal for research use (well within free tier limits)

**Get your Firebase config:**
- Project Settings (gear icon) → General tab → Your apps → Add app → Web
- Register app, copy the `firebaseConfig` object

### 2. Configure the Frontend

Open `src/firebase.js` and replace the placeholder values with your actual Firebase config:

```js
const firebaseConfig = {
  apiKey: "AIzaSyAPaJwdXmJhn8WVQDxwFZx5N5kX2loL5zY",
  authDomain: "ideasearchlab.firebaseapp.com",
  projectId: "ideasearchlab",
  storageBucket: "ideasearchlab.firebasestorage.app",
  messagingSenderId: "368057681732",
  appId: "1:368057681732:web:35d8aba8d387abc364f911",
}
```

### 3. Set the Vite Base Path

Open `vite.config.js`. The `base` field must match your GitHub repo name:

```js
base: '/ideasearchlab/',   // must match your GitHub repo name exactly
```

And in `src/main.jsx`:

```jsx
<BrowserRouter basename="/ideasearchlab">
```

### 4. Set the Anthropic API Key in Firebase

```bash
npm install -g firebase-tools
firebase login
firebase use --add   # select your project

firebase functions:config:set anthropic.key="sk-ant-YOUR_KEY_HERE"
```

### 5. Deploy Firestore Rules and Indexes

```bash
firebase deploy --only firestore
```

### 6. Deploy Cloud Functions

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

### 7. GitHub Repo Setup

1. Create a new repo at github.com named `ideation-app` (or your chosen name)
2. Push this code:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/konstantinosStouras/ideasearchlab.git
git push -u origin main
```

3. In the repo on GitHub:
   - Settings → Pages → Source: **GitHub Actions**
   - The workflow at `.github/workflows/deploy.yml` will run automatically on every push to `main`

4. After the first successful workflow run, your app will be live at:
   `https://konstantinosStouras.github.io/ideasearchlab/`

---

## Development (Local)

```bash
npm install
npm run dev
```

To run with Firebase emulators (local backend):

```bash
firebase emulators:start
```

---

## Instructor Flow

1. Go to `/admin` and sign in
2. Click **+ New Session** to configure and create a session
3. Share the 6-character session code with participants
4. Monitor participants in the live session control panel
5. Use the **Advance** button to move through phases manually (or let timers run)
6. Use **Handle Stragglers** if any participants are stuck in `waiting_for_group`

## Participant Flow

1. Go to the app URL and register/sign in
2. Enter the session code on the Join page
3. Wait in the lobby until the instructor starts the session
4. Complete each phase as it opens
5. Complete the survey to finish

---

## Adding a New AI Parameter

1. Add it with a default value in `functions/ai.js` → `DEFAULTS` object
2. Add it to `resolveAIConfig()` in the same file
3. Optionally expose it in the Admin session creation form (`src/pages/Admin.jsx`)
4. Deploy functions: `firebase deploy --only functions`

No other files need to change.

---

## Project Structure

```
ideation-app/
├── src/
│   ├── pages/          # One file per screen
│   ├── components/     # SplitLayout, AIChat, PhaseTimer, ProtectedRoute
│   ├── context/        # AuthContext, SessionContext
│   ├── data/           # surveyQuestions.js
│   ├── utils/          # phaseSequence.js
│   └── styles/         # globals.css
├── functions/          # Firebase Cloud Functions (Node.js)
│   ├── index.js        # Exports all functions
│   ├── session.js      # joinSession, advancePhase
│   ├── grouping.js     # autoGroupParticipants, handleStragglers
│   ├── ai.js           # sendAIMessage (all LLM logic)
│   └── voting.js       # submitVote
├── firebase.json
├── firestore.rules
├── firestore.indexes.json
└── .github/workflows/deploy.yml
```
