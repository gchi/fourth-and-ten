# Fourth & Ten

A shared Thursday football clubhouse: browse live Kalshi markets, cast a personal ballot, and build one group parlay from the highest-ranked picks.

## What works

- Dark prediction-market interface with a Thursday lunch guide and an explicitly fictional $20M group-chat ambition. A compact ticket summary exposes the shared leg count and total stake directly above the markets, with Edit ticket opening the organizer controls. The board omits the large intro banner and repeated explanatory panels; extra filters, detailed odds, setup instructions and ticket exports are available on demand. Voting has no deadline and remains open until the organizer manually locks the round. Fresh rounds default to a configurable 10-pick target. Starting a new round retains the stake, resets the target to 10, and archives the previous ballots.

- Mobile layout: one-column market cards, a bottom navigation bar with a parlay shortcut, 44–48 px controls, larger readable odds, full-width search and filters, safe-area spacing, keyboard-friendly 16 px fields, and scrollable mobile dialogs. The menu supports focus management and Escape; the background is inactive while it is open.

- Kalshi's public football series catalog, including NFL, college and other football leagues. Browse winners, spreads, totals, props, futures, and all other series offered by Kalshi. The catalog is discovered dynamically rather than maintained as a fixed whitelist.
- Open-market pagination, specific series selection, league and week filters, search within loaded markets, sorting, and Yes/No asking prices. Visible quotes refresh every 30 seconds; failures and quote timestamps are shown explicitly.
- Every Yes/No choice shows its current cents price, a rounded American-odds equivalent, and an implied probability from that side’s own ask. Plain-language selection text and a favorite/underdog label stay visible on each card. Explain odds opens the odds guide; Market details contains probability bars, per-contract profit/return examples and official settlement rules. The odds guide explains −225 versus +225, spreads versus odds, fees and value, with an interactive hypothetical stake calculator.
- Shared D1 storage, ChatGPT identity, and exactly 10 upvotes plus 5 downvotes available per person per round. Each upvote tap spends one point; all ten can go on the same Yes/No outcome. The minus button removes one point. Downvotes remain one per outcome and toggle off on another tap. Switching direction refunds all votes in the previous direction on that outcome. Existing single-vote ballots continue to work without a migration. Conditional writes prevent concurrent tabs from exceeding the limits.
- Live shared scores, personal ballots, member participation, and a ranked group slip. Each ticket pick has an expandable Who voted list with saved account names (email fallback), stacked upvote counts, and downvotes. Attribution is returned only by the authenticated ticket endpoint; copied market lists omit voter identities. Only positive net scores qualify. Ties use number of upvotes, then ticker/outcome order. Opposite sides of one contract and duplicate game-winner legs are skipped.
- Organizer controls for club name, total parlay stake ($1–$1,000), top N (2–20), manual locking, and starting a new round. Defaults: $10 and 10 suggested legs (editable through Edit ticket above the board). There is no automatic voting cutoff. Votes remain archived in storage when a new round starts.
- Market details and rules, a copyable draft/final slip, and links to review/place selections on Kalshi. No fabricated market data or combined payout estimates. Every member can use the final-ticket handoff: copy/download an exact selection list, request Kalshi-verified per-leg Yes/No links, and sign in and submit on Kalshi in their own account. With the shared Kalshi connection configured, Prepare our parlay creates/resolves one exact combo and returns its verified buy link. Copy/download includes a matching, unexpired whole-combo link when available. Individual links remain an inspection fallback.

## Deliberate boundary

This version does **not** place real-money orders or collect credentials in the browser. A server-only organizer key can create a public combo market; users review and purchase that combo on Kalshi in their own accounts. A parlay uses one total stake; it does not divide the stake among its legs. Kalshi determines actual combo eligibility, the price, fees and fill availability. Individual asking prices are not a combo quote. The website does not claim every combination is supported.

The handoff is not an account connection. `/api/parlay` recomputes the agreed selections from server-side ballots. A fingerprint binds the round, stake, target count, lock state, and exact ticker/side list. `/api/parlay/link` rejects draft, stale, and unselected legs, obtains a public read-only `get_market_links` result from Kalshi, validates the exact HTTPS destination/selection, and rechecks the ticket before returning. No order, account-authorization, or order-status endpoint is called by this per-leg route. A ticket reference is never represented as a Kalshi receipt.

## Enable the whole-combo handoff

Live combo creation requires two production runtime values configured through Sites (never in source, a client bundle, or `.openai/hosting.json`):

- `KALSHI_API_KEY_ID`: the production key ID.
- `KALSHI_PRIVATE_KEY_PEM`: its Ed25519 PKCS#8 or RSA PKCS#1/PKCS#8 private key. Actual PEM newlines and literal `\n` separators are supported. Encrypted PEM files are not supported.

Create a key in [Kalshi Profile → API Keys](https://kalshi.com/account/profile) with `write::trade` permission, the scope required for combo market creation. That scope also permits trading in Kalshi’s API, but this application only signs the fixed combo-creation endpoint. It contains no order, RFQ, quote acceptance, or transfer integration. Store these as private runtime values using the native Sites environment configuration and redeploy to apply the environment revision. Do not paste private keys into chat. An existing local key file can be supplied by path for secure setup. To revoke the connection, revoke the key on Kalshi, remove the runtime values, and redeploy.

One organizer connection creates/resolves the shared public combo; individual league members do not give this website their account credentials. Their purchase is made separately on Kalshi. The supported handoff is **lock voting → Prepare our parlay → Open our parlay on Kalshi → enter the stake and review/submit there**. The buy link selects YES on the combined market, which represents all original selected sides, including NO legs. Quantity, stake and price are not prefilled. Pricing/fill availability is determined on Kalshi, not by multiplying leg probabilities.

`GET /api/parlay/connection` is authenticated and returns only missing/invalid/configured status, never credentials. Configured means the key parses; Kalshi authenticates it during preparation. `POST /api/parlay/combo` accepts only a current ticket version, requires a signed-in Site user and finalized server-derived selections, checks request origin, discovers eligible collections with bounded pagination, and signs the exact ticker/event/side list. The API creates or reuses the existing market idempotently. The app verifies the complete market from the authenticated creation response, checking active status, closing time, binary type, and the exact leg multiset before obtaining the official YES buy link. This avoids a transient 404 from Kalshi’s cached single-market lookup immediately after creation. If the optional payload is absent, it retries only that public lookup up to four times; an invalid supplied payload is rejected, never bypassed. All returned market/side query parameters must agree. The ticket is checked again before creation, before linking and after linking; stale results are withheld. Kalshi’s public link service can also return an HTTP 404 inside an MCP tool error for a newly created combo. Link lookup retries only that specific availability error, with bounded backoff and cancellation; wrong-side or malformed links are never retried or substituted. The UI automatically retries explicit availability delays for the same ticket up to three attempts and displays a waiting state. Requests never accept arbitrary client-selected legs, URLs, or trading parameters.

The UI hides links on refresh failure and discards them when the ticket changes or after the two-minute verification window (earlier if the market closes). It shows explicit setup, ineligible-combination, connection-rejected, throttled and retry states. Before preparation, recognized overlapping threshold picks and full-game moneyline/winning-spread combinations are listed by name. The server blocks those conflicts before using the Kalshi key; uncertain correlations are left to Kalshi. No picks are silently removed or replaced. The organizer can reopen the same round to correct picks while retaining all ballots, stake, and leg target; voting stays open until the organizer locks it again. Historical deadline values are ignored; the legacy storage column is retained without a migration. Stale-round and non-owner requests are rejected. It does not infer a purchase from opening a link. Identical concurrent requests in one Worker isolate share preparation; Kalshi itself deduplicates the same legs across isolates/retries. No database migration is needed.

## Future personal-account checkout

Verified against Kalshi documentation on 2026-11-13. The desired next-stage flow is **connect my account → review the frozen group ticket → obtain a fresh combo quote → explicitly confirm my purchase → reconcile my actual order/fills**. Each member owns their own connection and purchase; a group vote or organizer action must never authorize other members’ spending.

Kalshi’s [hosted MCP OAuth connection](https://docs.kalshi.com/getting_started/mcp) supports portfolio reads and alerts. It explicitly does not place/cancel orders or save trade drafts. It supports CIMD or a previously registered OAuth client, not automatic dynamic registration. Its read token must not be treated as a trading credential. A private Site’s metadata URL may not be reachable by an external authorization server; confirm app registration and callback/metadata reachability before offering a connection button.

Direct in-site trading requires a separate supported authorization arrangement. The public [Trading API key flow](https://docs.kalshi.com/getting_started/api_keys) supports Ed25519 and RSA-PSS keys. Do not ask users for Kalshi passwords or reuse their browser sessions. Before enabling a multi-user credential flow, implement encrypted per-user credentials scoped by verified Site user ID, runtime-managed encryption keys, revocation, redacted logs, and an isolated demo mode. Never put credentials in browser storage, source, or plaintext database columns. OAuth-based trading would require a confirmed Kalshi-supported trading grant; that grant is not established by the documented MCP scopes.

For checkout, create or resolve an eligible MVE combo from the exact frozen legs, request an RFQ with the agreed maximum total debit including fees, show an expiring account-specific quote and payout, and require the account owner’s confirmation of that exact quote. Reject changed/stale tickets and duplicate attempts. Keep quote/order ownership tied to the user; reconcile execution and fills after timeouts before allowing any retry. Only verified fills can produce an order receipt. See [RFQ lifecycle](https://docs.kalshi.com/getting_started/rfqs) and [combo creation](https://docs.kalshi.com/api-reference/multivariate/create-market-in-multivariate-event-collection). No live order should be sent as part of development verification.

## Local development

Node >=22.13 is required. Run `npm ci`, `npm run db:generate` only when changing the schema, then `npm run build` to generate local Cloudflare configuration. Apply the existing migration once:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_shallow_blazing_skull.sql
npm run dev -- --host 127.0.0.1
```

Open the printed localhost URL and use Sign in for the starter's development identity. The production bundle excludes mock sign-in. Sites supplies verified identity headers in production; do not expose this Worker directly behind a proxy that permits callers to forge those headers.

For a new hosted copy, create a separate Sites project with its own D1 binding
and runtime secrets. Initialize it privately: the first authenticated visitor
becomes organizer. Then use Sites sharing controls to admit your group.
Anonymous visitors can browse public markets; each member signs in with a
distinct account to vote and view ticket attribution. The public source includes
no production Site identity, credentials, accounts, or ballots.

GitHub pull requests do not deploy the live Site automatically. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow and
[SECURITY.md](SECURITY.md) for authentication and credential boundaries.

## Checks

```sh
npm run typecheck
npm test
npm run test:runtime # workerd regression; mocked network, temporary test key
npm run build
npm run check:public # public GitHub checkout only
# With local development server running (writes local test ballots only):
npm run test:api
node tests/api-handoff.mjs # fresh local round only; no real orders
node tests/api-combo.mjs # unconfigured local connection only; never calls live creation
```

Combo tests cover cryptographic signature verification for both key types, missing/invalid credentials, eligibility, exact Yes/No leg preservation, stale-ticket races, sanitized API failures, returned-link validation and copy/export expiry. The Cloudflare-runtime regression runs the production combo and link code against intercepted responses, checks Ed25519 signatures, and ensures redirects cannot forward credentials. A separate local D1 regression executes the group route and verifies reopening preserves ballots, budget and leg target, rejects non-owner/cross-origin/stale-round requests, and verifies that historical deadlines cannot close voting or block edits. Real ballot writes remain guarded by the manual lock, including a lock racing with a vote. Workers requires manual redirect mode with explicit rejection of 3xx responses. Safe failure logs contain only the preparation stage, error code, upstream HTTP status when available, and exception kind. All authenticated creation tests use a mock exchange and temporary in-memory test keys; no live creation or purchase is part of the test suite. Browser/mobile ticket navigation still needs manual verification when a browser is available.

Domain tests cover vote budgets, undo/switching, ranking, conflicts, deterministic ties, and stacked voting limits. API smoke tests cover public feeds, identity, persistence, hard limits, concurrent submissions, settings validation, locking and fresh rounds. Local test data lives in ignored `.wrangler/`; it is never packaged for production.

## Source map

- `app/page.tsx`, `app/globals.css`, `app/mobile.css`, `app/market-theme.css`: responsive dashboard, ballot, settings, market explorer and review slip.
- `app/api/`: public-data proxy and authorized group/ballot routes.
- `lib/domain.ts`: voting, rankings and selection rules.
- `lib/kalshi.ts`: server-only market discovery and normalization.
- `lib/kalshi-combo.ts`, `app/api/parlay/combo/route.ts`, `components/markets/combo-handoff.tsx`: authenticated combo preparation, Ed25519/RSA signing, exact-leg verification and whole-combo handoff.
- `lib/parlay-handoff.ts`, `lib/parlay-server.ts`, `components/markets/kalshi-handoff.tsx`: authenticated ticket snapshots, official read-only market links, and personal-account handoff UI.
- `lib/group.ts`, `db/schema.ts`, `drizzle/`: identity, shared records and schema migrations.
- `.openai/hosting.json`: D1 binding `DB`; a private deployment checkout adds its own Sites project identity. Audience is managed through Sites access controls.

## Kalshi references

- [Public market data](https://docs.kalshi.com/getting_started/quick_start_market_data)
- [Markets and pagination](https://docs.kalshi.com/api-reference/market/get-markets)
- [Multivariate events](https://docs.kalshi.com/api-reference/events/get-multivariate-events)
- [RFQ creation](https://docs.kalshi.com/api-reference/communications/create-rfq)

Kalshi's public API is the source of current titles, contract rules, availability and prices. The market title is the Yes proposition; choosing No votes against that proposition.


## License

MIT; see [LICENSE](LICENSE). Retained third-party notices are in `vendor/` and
`scripts/vite/`.
