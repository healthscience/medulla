# medulla — `@conduction/medulla`

Host-agnostic conduction core: identity, P2P pairing, authenticated ingress, and an
append-only `hyperbee` ledger, built on HOP modules (`corestore`, `hyperbee`,
`hyperswarm`, `b4a`, `sodium-native`, `bare`).

**medulla is a library, not an app.** It contains no React Native, no Expo, and
no host-only sensor code. Camera, GPS, gyroscope, temp and BLE live in the
`radia` / `cale` host apps, which emit telemetry as ingress envelopes into medulla.

## What medulla provides

- **Persistent instrument identity** — Ed25519 keypair stored in a dedicated
  `medulla-identity` hyperbee, surviving restarts. The private key never leaves
  the worklet.
- **Append-only conduction ledger** — telemetry committed under
  `conduction/<device>/<timestamp>` in `medulla-conduction-index`.
- **Authenticated RPC envelopes** — host↔worklet IPC uses request-correlated
  envelopes (`id`, `v`, `from`, `device`, `action`, `payload`, `ts`, `nonce`,
  optional `sig`). The worklet enforces ACL, anti-replay nonce checks, and
  attaches/verifies signatures.
- **Device coupling** — registers a BentoBoxDS HOP prime account against the
  instrument public key (scanned from a QR shown in the host app).
- **Self-verification** — signs a challenge with the instrument private key so
  the host can prove coupling to BentoBoxDS on return. Topic-time verification
  records are produced by the account side from the signed response.

## Authorization & coupling flow

1. **Instrument identity** — on first boot, medulla generates a persistent
   keypair and emits `MEDULLA_READY { publicKey }`.
2. **QR coupling (host UI)** — the host app (e.g. radia) renders a QR containing
   `{ publicKey, nonce, accountId }`. The peer scans it in BentoBoxDS HOP, which
   registers `account ← instrument-public-key`.
3. **Couple (worklet)** — host sends `COUPLE { accountId, publicKey }` over IPC;
   medulla stores the coupling record.
4. **Self-verification on return** — host sends `VERIFY { challenge }`; medulla
   signs it with its private key and returns `{ publicKey, signature, challenge }`.
   The host forwards this to BentoBoxDS to verify against the registered key and
   record a topic-time verification of the conduction-linked device.
5. **Authorized ingress** — host sends `INGRESS_TELEMETRY` envelopes
   `{ id, from, device, action, payload, ts, nonce }`. Medulla checks ACL
   (`from` must own `device` for first-party writes), rejects replayed nonces,
   attaches an instrument signature, commits to `conduction/<device>/<ts>`, and
   replies `INGRESS_COMMITTED { id, key, device }`.

## IPC actions

| Action | Direction | Purpose |
|---|---|---|
| `MEDULLA_READY` | worklet → host | Ready + storage path + instrument `publicKey` |
| `INGRESS_TELEMETRY` | host → worklet | Append telemetry envelope to ledger |
| `INGRESS_COMMITTED` | worklet → host | Commit ack correlated by `id` |
| `EGRESS_TELEMETRY` | host → worklet | Read ledger records for a device |
| `COUPLE` | host → worklet | Register BentoBoxDS account coupling |
| `COUPLED` | worklet → host | Coupling record ack |
| `VERIFY` | host → worklet | Sign a challenge (private key stays in worklet) |
| `VERIFIED` | worklet → host | `{ publicKey, signature, challenge }` |
| `MEDULLA_ERROR` | worklet → host | Error, correlated by `id` when possible |

## Layout
```
medulla/
├── medulla.mjs            bare worklet entry (imports src/medulla-core.mjs)
├── src/
│   ├── index.mjs          public entry point
│   ├── index.d.ts         TypeScript surface
│   ├── medulla-core.mjs   identity + ledger + coupling + verify + ingest/query
│   └── ingress.mjs        protocol/envelope helpers (sign/verify/nonce/build)
├── examples/
│   └── host-shell/App.js  reference React Native host shell (copy/adapt in radia/cale)
├── scripts/prepack.mjs    builds medulla.bundle via bare-pack
├── tests/medulla.test.js  vitest suite
└── docs/
    ├── agents/            module specs
    └── radia-medulla-integration.md  handoff for radia coding agent
```

## Install
```bash
npm install @conduction/medulla
```

## Use (Node / tests)
```javascript
import { Medulla, buildEnvelope, INGRESS_TELEMETRY } from '@conduction/medulla'

const medulla = new Medulla('/path/to/storage')
await medulla.ready()
console.log(medulla.publicKeyHex) // persistent identity

// legacy
await medulla.ingest('radia', { cranialAngle: 11.2 }, 'heli-phase-active')

// envelope (recommended)
const env = buildEnvelope({
  from: 'radia',
  device: 'radia',
  action: INGRESS_TELEMETRY,
  payload: { cranialAngle: 11.2 }
})
const ack = await medulla.ingest(env) // { id, type, key, device, status }

const records = await medulla.query('radia')

// coupling + self-verification
await medulla.couple('bentobox-account-id', medulla.publicKeyHex)
const signed = await medulla.signChallenge('challenge-from-bentoboxds')
Medulla.verifyChallenge(signed.challenge, signed.signature, signed.publicKey) // true
```

## Host apps (separate repos)
- **`radia`** — body posture vectors: camera + gyroscope. Shows QR for coupling.
- **`cale`** — environment telemetry: phone temp/humidity + BLE air-quality devices.

Both are separate repos that `npm install @conduction/medulla` and layer their
sensor/UI logic on top. Updates to medulla flow through **semver bumps**, never
git cloning. `examples/host-shell/App.js` is a reference shell (React Native)
to copy/adapt — medulla itself contains no RN/Expo app code. See
`docs/radia-medulla-integration.md` for the radia handoff.

## Build the worklet bundle
```bash
npm run prepack   # npx bare-pack --preset --out medulla.bundle medulla.mjs
```

## Test
```bash
npm test
```
