# backend

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.2.22. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

Run unit tests without Docker or live API connections:

```bash
bun run test:unit
```

The full `bun run test` suite requires Docker for PostgreSQL and Redis test containers.
