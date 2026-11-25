# Security

Report vulnerabilities through the repository's private vulnerability reporting
feature when available. Do not put keys, tokens, ballots, or personal account
information in a public issue. If a credential is exposed, revoke it with its
provider; deleting a file does not remove it from Git history.

## Boundaries

- Kalshi credentials are server-only runtime secrets. The application creates
  or resolves a combo market; it does not submit orders, accept quotes, create
  RFQs, transfer funds, or collect visitors' Kalshi credentials.
- Public visitors can browse markets. Group records, voter attribution and
  ballot writes require authenticated identity. Only the organizer can change
  settings or close, reopen, or reset rounds. Voter names/email fallbacks are
  visible to other signed-in members; ballots are not anonymous.
- Production identity comes from the trusted Sites gateway. Never expose the
  Worker directly behind a proxy that accepts caller-supplied
  `oai-authenticated-user-*` headers. The local development identity is not a
  production authentication system.
- Initialize a new deployment privately so the intended organizer claims it
  before expanding access. Any signed-in visitor admitted by the Site's access
  policy can join that Site's single group.
- Upstream Kalshi destinations, returned market tickers and sides are validated.
  Redirects cannot forward signed credentials. Logs omit upstream bodies and
  credential values.

## Repository checks

CI runs a public-source guard, Gitleaks, dependency auditing, type checking, unit tests, Worker/D1
regressions and a production build. CI has read-only repository permissions,
uses pinned actions and receives no deployment or Kalshi secrets. It does not
place bets. Keep dependency security advisories under review; scans are useful
checks, not a guarantee that all vulnerabilities have been found.
