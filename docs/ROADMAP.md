# TicketOps — Feature Roadmap to World-Class

> Written 2026-07-03, after the performance overhaul (slim bootstrap, Drive photo
> storage, cache-first login). Grounded in the live system audit
> ([SYSTEM-MAP.md](SYSTEM-MAP.md)) and what restaurant-maintenance operations
> actually need. Ordered by impact-per-effort, not by shininess.

---

## Tier 0 — Foundations that everything else depends on

### 0.1 Real authentication (signed tokens)
The single biggest gap. Today identity = a forgeable header, and
`/api/auth/demo-users` lists every user ID publicly. Before any real business
data lives here:
- Issue a short-lived signed token (HMAC in Apps Script is enough) at login;
  verify it server-side on every request.
- Lock `/api/auth/demo-users` behind admin.
- Add rate-limiting on login attempts (Script Properties counter).
**Effort: ~2 days. Blocks: customer-facing anything.**

### 0.2 CSS rewrite from the navy layer
23,189 lines with 3,982 `!important` — every future UI feature pays a tax on
this. Rebuild from the 406-line navy layer + design tokens (~2k lines total).
Fixes remaining mobile/scroll quirks permanently and makes every feature below
5× faster to build.
**Effort: ~3-4 days. Unlocks: all UI work.**

### 0.3 Asset diet + dead-code purge
734 KB logo → <30 KB WebP; delete `customer.*`, browser-fallback mock,
ghost views, unused deps (`express`, `pdfkit`, `@supabase/*`, `cors`,
`dotenv`). Page weight 1.8 MB → ~400 KB; first load under 1s on 4G.
**Effort: 1 day.**

---

## Tier 1 — Operations features with immediate daily payoff

### 1.1 Push notifications (the #1 missing feature for a dispatch app)
Nobody should have to open the app to learn a P1 ticket exists.
- Web Push via the existing service worker (free, works on Android PWA +
  desktop; iOS 16.4+ supports it for installed PWAs).
- Notify: technician on assignment, manager on resolution-for-approval, admin
  on new P1, everyone on SLA breach.
- WhatsApp Business API as a second channel — in India this is the channel
  technicians actually read.

### 1.2 SLA engine with escalation
Priorities exist (P1–P4) but nothing enforces time. Add per-priority SLA
clocks (e.g. P1 = respond 30 min / resolve 4 h), visible countdown chips on
every ticket, and auto-escalation (notify admin + bump priority) on breach.
Trivially computed from `createdAt`/`updatedAt` already in the data.

### 1.3 Offline-first technician mode
Technicians work in basements and kitchens with dead spots. The PWA + SW are
already there; add an outbox queue: status updates and photos taken offline
are queued in IndexedDB and synced when back online. The bootstrap cache
already gives read-offline nearly for free.

### 1.4 QR codes on assets
Print a QR per asset (asset id already exists). Scanning opens "create ticket
for this asset" pre-filled, or the asset's history. Kills the "which AC is
it?" back-and-forth. ~1 day with a QR lib + print sheet.

### 1.5 Ticket comments / activity thread
Right now a ticket has one `latestDetail` string — history is lost. Add an
append-only `history[]` per ticket (who, when, what, optional photo). The
asset detail view already tries to render `ticket.history` — the field just
never gets written.

---

## Tier 2 — Management intelligence

### 2.1 Cost & vendor tracking
`closePrice` exists but is a bare number. Add: parts vs labour split, vendor
master (external contractors), invoice photo attachment, and monthly cost
per outlet / per asset / per category. This turns TicketOps from a task app
into the maintenance P&L for the business.
**Zoho hook:** expenses can sync straight into Zoho Books (MCP integration
already available in this workspace) — maintenance spend lands in real
accounting without retyping.

### 2.2 Asset lifecycle intelligence
Every asset already accumulates tickets. Surface: repair count + total spend
per asset, "repair vs replace" flag when spend exceeds X% of replacement
cost, warranty expiry dates with reminders, and mean-time-between-failures.
This is the feature that pays for the whole system.

### 2.3 Technician scorecards
Data already exists (tasks done, tickets closed, reopen rate, time-to-accept).
Render it: weekly scorecard per technician, fastest/slowest categories,
attendance overlay. Feeds fair dispatch and reviews.

### 2.4 Preventive-maintenance compliance report
The scheduler generates tasks; nobody sees the misses. Monthly compliance %
per outlet (done / generated), streaks, and a "worst 5 recurring misses"
list — the report a franchise ops head actually wants.

### 2.5 Real dashboards export
The PDF export exists (Batch 8); extend to scheduled email/WhatsApp digests:
daily 8am summary to admins (open P1s, SLA breaches, yesterday's closures,
spend this month).

---

## Tier 3 — Scale & polish

### 3.1 Optimistic UI + partial re-render
Every action currently re-fetches the whole bootstrap (~30 call sites).
Apply the mutation to local state immediately, sync in background, roll back
on failure. With the slim bootstrap this is now easy — payloads are small.

### 3.2 Photo pipeline upgrades
Now that photos live in Drive: client-side compression is already there;
add thumbnails (`=w200` variants of the same lh3 URLs — free), multi-photo
capture flow, and annotation (draw an arrow on the photo before sending).

### 3.3 Multi-language (Gujarati/Hindi)
The team writes tickets in romanized Gujarati already ("vara ghadi sound ma
khar-khar aavaj aave"). A simple string-table i18n layer + language toggle
per user makes technician adoption dramatically better.

### 3.4 Customer-facing status page
`customer.html` is a dead stub — revive it as a QR-linked "report an issue in
this washroom" public form (no login, rate-limited) that creates a ticket
tagged to the outlet+area, and shows "we're on it" status. Guest-visible
maintenance turns complaints into tickets.

### 3.5 AI features (cheap, high-leverage, all via one API)
- **Auto-triage:** classify note+photo → suggested category/priority
  (the note text is often misspelled/mixed-language — LLMs handle that well).
- **Smart dispatch explanation:** the dispatch scorer exists; add "why this
  technician" natural-language reasoning.
- **Monthly ops summary in plain language** for owners.
- **Photo QC:** flag evidence photos that are blurry/dark/not-of-equipment.

### 3.6 Backend growth path
Google Sheets as DB is now fast (post-Drive-migration ~0.5 MB) and fine up to
roughly: ~2k tickets, ~10k tasks, ~10 concurrent users. Beyond that, the
clean escape hatch is Supabase/Postgres behind the same envelope API — the
frontend never needs to know. Trigger: bootstrap >2 MB again, or >3s server
time sustained, or the day you need true concurrent writes (two admins saving
simultaneously can lose one write today — Sheets has no row locking).

---

## Explicitly NOT recommended (for now)

- **Rewriting in React/Next** — the vanilla SPA works and is now fast; a
  framework rewrite burns a month for zero user-visible gain. Revisit only
  if a second frontend (customer portal) grows big.
- **Microservices / separate API server** — one Apps Script file serving an
  envelope API is operationally free and debuggable. Don't add servers before
  the Sheets ceiling is actually hit.
- **Native app rewrite** — Capacitor wrapper + PWA push covers 95% of native
  value at 5% of the cost.

## Suggested order of attack

1. **0.1 auth** + **1.1 push notifications** (one sprint — security + the
   feature everyone feels)
2. **0.2 CSS rewrite** + **0.3 asset diet** (one sprint — foundation + speed)
3. **1.2 SLA** + **1.5 ticket threads** + **1.4 QR** (one sprint — ops depth)
4. **2.1 cost/vendor** + **2.2 asset intelligence** (one sprint — the money
   features)
5. Then Tier 3 by taste.
