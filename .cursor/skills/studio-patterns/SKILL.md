---
name: studio-patterns
description: Keeps video-gen changes on the existing server and catalog path. Use when adding a model, a generate call, a query, or a studio control.
---

# Studio patterns

Follow the code that is already here.

- A generate call goes through `src/generation` and a server action. The browser does not call OpenRouter.
- A new model is a catalog entry under `src/generation/catalog/`. The studio reads that entry. Do not add a second model list in a component.
- MySQL stays in the server modules that already query it. Do not query from `src/openhiggsfield` client components.
- Do not add a comment that explains a workaround. Change the code so the workaround is unnecessary.
- Prove the studio with `pnpm verify:studio` from the `verify-studio` skill. Do not claim the page works without that command.

`tsc --noEmit` (`pnpm typecheck`) is the mechanical gate. This skill covers the choices the compiler cannot see.
