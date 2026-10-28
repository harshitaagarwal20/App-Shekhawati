# The assistant (Dashboard › Ask)

A chat screen inside the ERP. You ask a question in plain words, such as *"How
many pieces did we stitch yesterday?"* or *"What does the tech pack say about the
zip on TB-DEMO-001?"*. Claude answers using **only** what it finds in the ERP's
reports and in the documents you upload. Under every answer it lists the
sources it used: the report rows, or the page and passage of a document.

If the answer isn't there, it says so instead of guessing.

---

## 1. How it works, in plain language

This is called **RAG**, short for *Retrieval-Augmented Generation*:

- **Retrieval** means looking things up first.
- **Generation** means writing the answer from what was found.

```
  You ask:  "What is the order book worth?"
      │
      ▼
  ┌────────────────────────── ERP server (Node) ──────────────────────────┐
  │                                                                        │
  │  1. Sends your question to Claude, with a list of TOOLS it may use:    │
  │       run_report · daily_summary · cost_sheets · find_records ·        │
  │       search_documents                                                 │
  │     The list is built from YOUR permissions. Tools for screens you     │
  │     can't open are not offered.                                        │
  │                                                                        │
  │  2. Claude replies "run the order-book report, please".                │
  │     The server runs it the same way the Reports screen does, under     │
  │     your login, and sends back the rows as numbered passages.          │
  │                                                                        │
  │  3. Steps 1-2 repeat (up to 6 rounds) until Claude has what it needs.  │
  │                                                                        │
  │  4. Claude writes the answer and marks which passages each sentence    │
  │     came from. Those marks become the [1] [2] and the Sources list.   │
  └────────────────────────────────────────────────────────────────────────┘
```

### Two kinds of information, two ways of finding it

| What you ask about | Where it lives | How it is found |
|---|---|---|
| **Figures**: stock, orders, output, QC, POs, costing | PostgreSQL tables | The ERP's own **reports**, run under your permissions. A sum or a filter has to come from a real query, never from a guess. |
| **Text**: specs, measurements, procedures, buyer requirements | Uploaded **PDF / TXT** files | **Meaning search**, explained below. |

### How meaning search works on your documents

When you upload a document, four things happen:

1. **Read.** The text is pulled out of every page of the PDF.
2. **Cut.** The text is split into small, **overlapping** chunks of a few
   sentences each (about 500 characters). They overlap so a fact that falls
   across a cut is still whole in one chunk. A chunk never crosses a page
   break, so the page shown under an answer is the right page.
3. **Embed.** Each chunk is turned into 384 numbers by the model
   **all-MiniLM-L6-v2**. These numbers capture what the text *means*, so "zip
   specification" finds "YKK #5 metal zip" even though the words differ. The
   model runs **inside the ERP server**; your documents are not sent anywhere to
   be embedded.
4. **Store.** The file, its chunks and their numbers are saved in
   **PostgreSQL**, so they are still there after a restart.

When you ask a question, it is turned into numbers the same way. The chunks
whose numbers are closest are sent to Claude as passages it may quote.

> **Why PostgreSQL and not ChromaDB?** The ERP already runs PostgreSQL, which is
> backed up and deployed on Azure. A few hundred documents are a few thousand
> chunks, which a simple loop compares in about 10 milliseconds. A separate
> vector database would be one more thing to install, back up and secure, for no
> speed you would notice. The `pgvector` extension would need compiling from
> source on Windows.

---

## 2. Who can use it, and what Claude gets to see

| Permission | Lets you | Given to |
|---|---|---|
| `ASSISTANT.VIEW` | Open **Ask** and ask questions | Director, Admin |
| `ASSISTANT.CREATE` | Upload documents | Director, Admin |
| `ASSISTANT.DELETE` | Remove documents | Admin |

Other roles can be given these in **Administration › Roles**.

**The assistant never shows anyone more than their own screens do.** Each
tool is built from the asking user's permissions:

- A **QC user** is offered only the QC reports. There is no tool in their set
  that returns a price, because none of their screens shows one.
- **Prices and buyer names** reach Claude only when the person asking can see
  them on screen.
- A **document** can be limited when uploaded ("Who may read it"). For example,
  a costing sheet marked *Only those who see costing* is never searched for
  anybody without `COST_SHEET.VIEW`.

What is sent to Anthropic's API is:

- the question,
- the earlier turns of the same conversation (the last 12), and
- what the tools returned.

Nothing else is sent. Every tool only reads; nothing writes to the database.

---

## 3. What was added (code map)

| File | What it does |
|---|---|
| `server/src/services/assistant.service.js` | The question → tools → answer loop; turns Claude's citations into numbered sources |
| `server/src/services/assistantTools.js` | The five tools, each built from the caller's permissions |
| `server/src/services/assistantDocuments.service.js` | Upload, list, open, remove, and meaning search over documents |
| `server/src/services/embedding.service.js` | Runs all-MiniLM-L6-v2 locally to turn text into vectors |
| `server/src/domain/chunking.js` | Splits text into overlapping, page-bounded chunks |
| `server/src/routes/assistant.routes.js` (+ controller, validator) | `GET /api/assistant`, `POST /api/assistant/ask`, `/api/assistant/documents...` |
| `server/prisma/migrations/20261026000300_assistant_documents/` | Tables `assistant_documents`, `assistant_chunks`, and the `ASSISTANT.*` permissions |
| `client/src/pages/assistant/AssistantPage.jsx` | The chat screen and the documents panel |
| `server/test/assistant.rules.test.js` | Tests for chunking, permissions, and how answers map to sources |

### Packages

The ERP is a Node.js app, so there is no `requirements.txt`. Packages are listed
in `server/package.json` and installed by `npm install`:

| Package | Why |
|---|---|
| `@anthropic-ai/sdk` | Talks to Claude (already used by the daily summary) |
| `@huggingface/transformers` | Runs the all-MiniLM-L6-v2 embedding model inside Node |
| `unpdf` | Reads the text out of PDFs |

The model is **claude-sonnet-5-5**, set by `ASSISTANT_MODEL`. If Claude declines
a question, Anthropic's recommended fallback model is tried automatically.

---

## 4. Set it up on your computer

You need the ERP already running locally (see the README): Node 20+ and
PostgreSQL.

**Step 1 — Install the new packages.** From the project folder:

```powershell
npm install
```

**Step 2 — Create the new tables.** This applies any migrations your database
doesn't have yet:

```powershell
npm --workspace server run db:deploy
```

If you see `EPERM: operation not permitted, rename ... query_engine-windows.dll.node`,
stop `npm run dev` first (it holds that file open), run the command again, then
start it again.

**Step 3 — Get an API key.** Sign in at <https://console.anthropic.com>, open
**API Keys**, and create a key. It starts with `sk-ant-`. Treat it like a
password.

**Step 4 — Put the key in `server/.env`.** Never put it in code or in git.
`server/.env` is already git-ignored.

```ini
ANTHROPIC_API_KEY=sk-ant-...your key...
ASSISTANT_MODEL=claude-sonnet-5-5
```

**Step 5 — Start the app.**

```powershell
npm run dev
```

**Step 6 — Try it.** Sign in as the Director or Admin, open **Dashboard › Ask**,
upload a tech pack in the right-hand panel, and ask about it.

> The **first** upload or question after a start waits a few seconds while the
> search model loads. The **very first** one on a machine also downloads the
> model (about 90 MB) from Hugging Face. After that it is cached.

---

## 5. Set it up on Azure

Follow `docs/AZURE-DEPLOYMENT.md`. Then do three extra things.

**1. Store the key in Key Vault** (Step 6 of that guide):

```bash
az keyvault secret set --vault-name kv-shekhawati-erp-prod \
  --name ANTHROPIC-API-KEY --value 'sk-ant-...'
```

**2. Add the app settings** (Step 8):

```bash
az webapp config appsettings set \
  --name app-shekhawati-erp-api-prod \
  --resource-group rg-shekhawati-erp-prod \
  --settings \
    ANTHROPIC_API_KEY='@Microsoft.KeyVault(SecretUri=https://kv-shekhawati-erp-prod.vault.azure.net/secrets/ANTHROPIC-API-KEY/)' \
    ASSISTANT_MODEL=claude-sonnet-5-5 \
    ASSISTANT_MODEL_CACHE=/home/assistant-model
```

`ASSISTANT_MODEL_CACHE` matters. The app runs from a **read-only** package
(`WEBSITE_RUN_FROM_PACKAGE=1`), so the model must be downloaded somewhere
writable. `/home` is writable and survives restarts.

**3. Deploy as usual.** The pipeline's `db:deploy` step creates the tables and
grants the permissions.

The App Service needs outbound internet access to reach `api.anthropic.com`
(every question) and `huggingface.co` (once, for the model download). The
search model adds roughly 300 MB of memory, which fits on a B1 plan or above.

---

## 6. Using it

- **Ask in plain words.** Mention order numbers, style numbers, buyers or
  dates when you know them, e.g. *"Ironing balance for SO-00150"*.
- **Read the sources.** Each `[1]` in the answer links to a source below it.
  The source shows the exact report row or document passage used. **Open
  report** or **Open file** takes you to the original.
- **"No source cited"** means the answer rests on nothing it found. Treat it as
  unverified.
- **"How this was looked up"** lists every report and search it ran.
- **Follow-up questions** work ("and last week?"). Each question looks its
  figures up again, so answers are never from a stale copy.
- **New conversation** clears the chat. The conversation is kept only in that
  browser tab.

### Limits

| Limit | Value | Why |
|---|---|---|
| Questions per person | 30 per 15 minutes | Each question is a paid API call; this stops a stuck script running up a bill |
| File size | 10 MB, PDF or TXT | Same as other attachments |
| Passages per document | 3,000 | Larger documents should be split into parts |
| Report rows shown to Claude | 100 per run | Totals always cover every row; narrow with filters for detail |
| Lookup rounds per question | 6 | Then it answers with what it has |

---

## 7. Common errors and how to fix them

| What you see | Why | Fix |
|---|---|---|
| The message box says *"The assistant is switched off"* | `ANTHROPIC_API_KEY` is empty on the server | Set it in `server/.env` (local) or the app settings (Azure), then restart |
| *"The assistant's API key was refused"* | Wrong, revoked, or mistyped key | Create a new key in the Anthropic Console; check for spaces or quotes around it |
| *"The Anthropic account is out of credits"* | The API account's prepaid balance is used up or expired. A claude.ai or Claude Code subscription does **not** pay for API calls. | Add credits at console.anthropic.com › Settings › Billing, in the same account the key belongs to |
| *"The assistant is busy. Try again in a minute."* | Anthropic rate limit, or your 30-per-15-minutes limit | Wait a minute |
| *"The assistant could not be reached"* | No internet from the server, or a firewall blocking `api.anthropic.com` | Check the connection; on Azure, check outbound rules |
| *"No text could be read from that PDF"* | It is a **scanned** PDF (pictures of pages, no text layer) | Run it through OCR (Adobe Acrobat → *Scan & OCR*, or any OCR tool), or paste the text into a `.txt` |
| *"That PDF could not be opened"* | Damaged or password-protected | Remove the password and save a fresh copy |
| *"Only .pdf and .txt files..."* | Word, Excel or image file | Save as PDF first |
| *"That document is too long..."* | Over 3,000 passages | Split the PDF into parts |
| First upload hangs for a minute, or fails offline | The search model is downloading (once) | Wait; make sure the server has internet the first time |
| Upload or question fails on Azure with `EACCES` / `read-only file system` | `ASSISTANT_MODEL_CACHE` not set | Set it to `/home/assistant-model` |
| `EPERM ... query_engine-windows.dll.node` during `prisma generate` | The running dev server holds the file | Stop `npm run dev`, run the command, start again |
| `relation "assistant_documents" does not exist` | Migration not applied | `npm --workspace server run db:deploy` |
| **Ask** missing from the sidebar | Your role lacks `ASSISTANT.VIEW` | Grant it in Administration › Roles, then sign out and in |
| Answer says it is *not in the data*, but you know it is | You lack permission for that register, or the document wasn't uploaded, or it is a figure no report covers | Check your role; upload the document; name the order or style in the question |
| *"The answer ran too long and was cut off"* | Very broad question | Ask something narrower ("for October", "for buyer X") |

---

## 8. For developers

- **Tests:** `npm --workspace server run test:rules` includes
  `assistant.rules.test.js`. It covers chunk sizes and overlap, page
  boundaries, which tools each role is given, refusals, row formatting, and how
  citations map to numbered sources. No database or API key is needed.
- **Adding a tool:** add it in `assistantTools.js` inside `toolsFor(has)`,
  behind the same permission its screen uses. Return facts as `search_result`
  blocks (so they can be cited) and push one entry to `sources` for each block.
- **Adding a report** to the Reports registry makes it available to the
  assistant automatically, under its own permission.
- **Changing the embedding model** means every stored vector must be rebuilt.
  Delete and re-upload the documents.
- **Logs:** each question writes one line, such as
  `[assistant] <user id>: 2 lookup(s), 5123 in / 210 out (cache read 4096) on the last call`.
