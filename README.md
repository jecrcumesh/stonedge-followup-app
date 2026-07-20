# Stonedge Followup Tracker — web app

A browser-only app that replaces the day-to-day use of `Stonedge_Customer_Followup_Tracker.xlsx`.
It reads and writes the customer list straight from a **private** GitHub repo using a
personal access token you paste in at login — there is no server, and no one without a
valid token can see the data.

- **Dashboard** — same key metrics, status breakdown and Top 5 as the Excel Dashboard tab.
- **Followup Tracker** — one editable row per customer. Due Date, Days Overdue, Ageing
  Bucket and Priority are calculated live, exactly like the Excel formulas (see `js/calc.js`).
- **Export to Excel** — rebuilds a `.xlsx` in the same two-sheet layout, any time.
- Multiple teammates can use it; each person signs in with their own token.

## Why two repos

GitHub Pages (the free static hosting used here) can only publish a **public** repo unless
you're on a paid GitHub plan. Your customer names, phone numbers and outstanding amounts
shouldn't sit in a public repo, so the data is kept separate:

| Repo | Visibility | Contents |
|---|---|---|
| `stonedge-followup-app` (this one) | Public | Only the app's code — no customer data |
| `stonedge-followup-data` | **Private** | `tracker.json` — the actual customer data |

The app fetches/saves `tracker.json` at runtime via the GitHub API, using the token each
person enters. The code itself never contains any customer data.

## Setup

**1. Create the private data repo**
- On GitHub, create a new repo named `stonedge-followup-data`, set to **Private**.
- Upload the `tracker.json` file from the `stonedge-followup-data` folder you were given
  (it's pre-filled with your current 70 customers, converted from the Excel).

**2. Create the app repo and enable Pages**
- Create a new repo named `stonedge-followup-app`, set to **Public**.
- Upload everything in this folder (`index.html`, `style.css`, `js/`).
- Go to Settings → Pages → Deploy from branch → `main` / `(root)` → Save.
- Your app will be live at `https://<your-github-username>.github.io/stonedge-followup-app/`.

**3. Point the app at your data repo**
- Edit `js/config.js` (either locally before uploading, or directly in GitHub's web editor):
  ```js
  dataOwner: "your-github-username",
  dataRepo: "stonedge-followup-data",
  ```

**4. Create a token for each person who'll use it**
- GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
- Resource owner: your account. Repository access: **Only select repositories** → `stonedge-followup-data`.
- Permissions: **Contents → Read and write** (Metadata read-only is added automatically).
- Set an expiry you're comfortable with (e.g. 90 days or 1 year) — tokens can be regenerated any time.
- Copy the token now; GitHub won't show it again. Share it with that teammate directly
  (WhatsApp/GitHub isn't the ideal channel for this — a password manager or in person is safer).

Each teammate pastes their own token + their name into the login screen. "Keep me signed
in on this device" stores the token in that browser's local storage; leaving it unchecked
clears it as soon as the tab is closed.

## Notes

- If two people save at the same time, the second save will warn that the data changed
  since it was loaded, so no one's edits get silently overwritten.
- The Excel export is a snapshot (calculated values, not live formulas) — reopen the app
  for current figures.
- To revoke someone's access, just delete their token from GitHub Settings → Developer
  settings → Personal access tokens.
