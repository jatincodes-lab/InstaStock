# Local checks

Run `npm run verify` from the repository root before sharing a code change. It runs the API tests and then the frontend TypeScript/Vite production build. CI runs the same command on pushes and pull requests.

API tests use Node's built-in test runner and do not require database credentials. Add or update a test with every behavior change; cover authorization, validation, retries, and transaction/concurrency behavior as those features are implemented. Add browser end-to-end tests when the first persisted user journey is introduced.

To make CI a merge gate, configure the repository's branch protection/ruleset to require the `verify` check. A green CI run is necessary for merging; production releases also require the staging, migration, and recovery checks in [PRODUCTION_READINESS_PLAN.md](PRODUCTION_READINESS_PLAN.md).

The current API suite checks the database health response, hides database errors from that response, and returns JSON for unknown routes. This is foundation coverage only; it does not establish inventory, authentication, or tenant-isolation correctness.
