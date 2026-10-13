# PlayStash API schema

`playstash.openapi.json` is exported from the sibling PlayStash backend source using the same Swagger configuration as the running server. It lets fresh installations generate the TypeScript models without a hosted demo service or a running database.

To refresh it, run this from `playstash-backend`:

```sh
pnpm export:openapi ../playstash-frontend/api-spec/playstash.openapi.json
```

Then run this from `playstash-frontend` with Java 11 or newer available:

```sh
pnpm api:generate
pnpm typecheck
pnpm test
pnpm build
```

For a different PlayStash server version, set `PLAYSTASH_API_SPEC_PATH` to an exported JSON/YAML file or `PLAYSTASH_API_SPEC_URL` to that server's `/api/docs-json` endpoint before generating. The client uses the `PlaystashGame` and `PlaystashUser` schemas and preserves the backend's snake_case JSON fields and existing HTTP endpoints. Local paths take precedence over URLs.

The generated client in `src/api` is ignored by Git and regenerated during `pnpm install`. Commit the schema snapshot when the backend API changes.
