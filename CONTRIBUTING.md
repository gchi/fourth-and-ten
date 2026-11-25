# Contributing

Fork the repository, create a branch, and open a pull request against `main`.
You do not need access to the live Site, its database, or its Kalshi key.

## Run locally

Use Node 22.13 or newer and npm. Follow the local setup in README.md.
The localhost sign-in uses a development identity; voting data stays in the
ignored `.wrangler/` directory. Do not use production credentials for tests.

Before opening a pull request:

```sh
npm ci
npm run typecheck
npm test
npm run test:runtime
npm run build
npm run check:public
```

Describe the behavior changed and how you verified it. For UI changes, include
mobile and desktop screenshots using fictional test names and ballots. Keep
vote budgets, stacked voting, manual locking, organizer permissions, and exact
Kalshi ticker/side validation covered when changing those behaviors.

## Credentials and deployment

Keep `.env`, `.dev.vars`, private keys, database files, personal ballots, logs,
attachments and build archives out of commits. `.env.example` contains names
only. Run Gitleaks before pushing if your changes touch configuration.

The public GitHub repository is a source collaboration workspace. Its CI does
not deploy the existing Site or hold production secrets. A maintainer reviews
and publishes accepted changes through the separate Sites deployment workflow.
Keep any private Site project ID in that deployment checkout, not in a pull
request here. For your own Site, create a new project with its own database,
identity boundary and runtime secrets.

## License and notices

Contributions are provided under the MIT license in LICENSE. Preserve the
third-party notices in `vendor/` and `scripts/vite/`. Dependencies retain their
own licenses.
