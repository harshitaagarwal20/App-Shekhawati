# UI checks

Three scripts that drive the running app in a real browser. They exist because
the C2–C9 backend work added required fields, and a screen that renders
perfectly can still post a body the API now rejects — which is the failure that
matters and the one a build and a lint both miss.

Run the app first (`npm run dev:server` and `npm run dev:client`), then:

| Script | Asks |
|---|---|
| `ui-audit.mjs` | Does every screen load without a console error, page error or failed API call? Walks 23 routes and opens the create modals. |
| `ui-contract-check.mjs` | Do the forms' **exact request bodies** still succeed? Replays what each form sends, and asserts the refusals are refused. Uses two accounts, because maker-checker cannot be proved with one. |
| `ui-fields-check.mjs` | Do the **new fields actually render**? A field that exists only in the submit handler is one the user cannot fill. |

Notes for whoever runs these next:

- The forms are **progressive disclosure**. Fields appear only once earlier
  steps are answered, so the scripts drive the steps rather than just opening
  the page. Several early "failures" were the script's own fault for not doing
  this.
- The create forms are **modals on the list page**, not `/new` routes (except
  fabric issue and cutting issue). A guessed `/orders/new` falls through to
  `/orders/:id` and 422s.
- Repeated logins trip the **rate limiter** (in-memory, per process). If the
  scripts start failing at login, restart the API server.
