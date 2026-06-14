# Testability Standard

Status: adopted (2026-06-14, wave-t1)
Scope: all KDS code — backend (`backend/`, NestJS) and frontend (`frontend/`, React).

This is the project standard for writing **testable** code. "Testable" means a
unit of behaviour can be exercised in isolation, deterministically, and asserted
on with real (non-vacuous) expectations. Untestable code is a defect: if you
cannot pin a unit's inputs, you cannot prove its output, and you cannot refactor
it safely.

The non-negotiable rule: **every language / runtime in the repo has a test
harness, and every behavioural change ships with a real test.**

---

## 1. Inject collaborators (Dependency Injection)

A unit's collaborators — services, repositories, ports, HTTP adapters, the clock,
the randomness source — must be **passed in**, never reached for via a module-level
singleton or a `new` inside the method.

- Backend: use Nest constructor injection. Bind interfaces by a `Symbol` token
  (interfaces are erased at runtime). Mark genuinely-optional collaborators
  `@Optional()` and self-construct a real default in the constructor body so
  legacy/bare construction sites keep compiling and keep their runtime behaviour.
- A unit test then constructs the service with stub/mock collaborators (or uses
  Nest's `Test.createTestingModule(...).overrideProvider(TOKEN)`).

```ts
// Bad: collaborator is hard-wired, untestable.
class Foo {
  do() { return new HttpClient().get(...); }
}

// Good: collaborator is injected, substitutable under test.
class Foo {
  constructor(private readonly http: HttpPort) {}
  do() { return this.http.get(...); }
}
```

## 2. Clock and IdGenerator for time and randomness

`Date.now()`, `new Date()`, `Math.random()`, `crypto.randomBytes()`,
`crypto.randomUUID()` are **ambient, non-deterministic collaborators**. Code that
calls them inline produces a different value every run and cannot be asserted on
byte-for-byte.

Use the injectable primitives:

- `Clock` (`backend/src/common/time/clock.ts`) — `now(): Date`, `nowMs(): number`.
  Token `CLOCK`. Default `SystemClock` delegates to the real platform clock.
- `IdGenerator` (`backend/src/common/ids/id-generator.ts`) — `uuid(): string`,
  `randomHex(bytes): string`. Token `ID_GENERATOR`. Default `SystemIdGenerator`
  delegates to `crypto`.

Both are registered (and exported) by the global `CommonModule`, so any feature
module can inject them with `@Inject(CLOCK)` / `@Inject(ID_GENERATOR)` without an
explicit import. The defaults are **byte-identical** to the inline calls they
replace (`SystemClock.nowMs() === Date.now()`,
`SystemIdGenerator.randomHex(3) === randomBytes(3).toString("hex")`), so adopting
them is behaviour-preserving.

Worked example — subscription `merchantOid` generation
(`backend/src/modules/payments/payments.service.ts`): it used to fold in
`Date.now()` + `randomBytes(3)`, so its spec could only assert *shape*. After
injecting a fixed `Clock` + a stub `IdGenerator`, the spec asserts the exact OID
string (`SUB111111112222loyw3v28abc123`) and proves no hidden randomness remains.

### Accepted techniques

These are all acceptable and encouraged — pick the lightest one that makes the
unit deterministic:

- **Inject `Clock` / `IdGenerator`** — preferred for first-party code we own and
  can refactor; gives the cleanest, fastest, most explicit tests.
- **`jest.useFakeTimers()` / `jest.setSystemTime(...)`** — fine for pinning time in
  code that still uses real `Date`/timers (e.g. `date-fns`, `setTimeout`), and for
  testing the `SystemClock` default itself.
- **`jest.mock('axios')` / `jest.mock('crypto')`** — acceptable for replacing a
  whole *module import* at the boundary (third-party HTTP clients, node builtins)
  when DI would be disproportionate. Prefer mocking at the seam closest to the
  external dependency.

## 3. Extract pure logic into exported modules

Pull pure, side-effect-free logic (formatting, hashing inputs, math, mapping,
validation, OID assembly) out of large stateful services into **exported**
functions/modules, and re-import them at the original call site so runtime
behaviour is byte-identical. A pure function is the cheapest thing to test: no
mocks, no setup, just `input → output`. When you extract, move the logic
**verbatim** and add a focused unit spec with real assertions.

## 4. Frontend testability

- Keep components **presentational**: props in, JSX out, no data-fetching or
  business logic inline. Test them with React Testing Library on rendered output.
- Extract side-effecting and stateful logic into **custom hooks**, and pure
  transforms into **plain exported functions**. Unit-test the pure functions
  directly; test hooks with `@testing-library/react`'s `renderHook`.
- Same time/randomness rule applies: thread time/ids in via props/args or a hook
  seam so a test can pin them; use vitest fake timers where appropriate.

## 5. Real assertions, every language

- Assertions must be **load-bearing** — assert the actual value/shape/effect, not
  `expect(fn).not.toThrow()` or `expect(true).toBe(true)`.
- Backend: `cd backend && npx jest <path>` and `npx tsc --noEmit`.
- Frontend: `cd frontend && npx vitest run <path>` and `npx tsc --noEmit`.
- Every language / runtime added to the repo must arrive with a working test
  harness and at least one real test; "no harness yet" is not an acceptable state
  for code that ships behaviour.

## 6. Behaviour preservation

Refactors for testability must be **behaviour-preserving**. When you extract or
inject, the production path must remain byte-identical (verified by the default
implementations delegating to the original primitives). If a change would alter
observable behaviour, it is no longer a testability refactor — stop, and treat it
as a behavioural change with its own review.
