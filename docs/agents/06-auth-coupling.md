# Module Spec: Auth, Coupling & Verification (`medulla` ↔ BentoBoxDS HOP)

## Objective
Enable a peer with an existing BentoBoxDS HOP key set to couple a conduction instrument (radia/cale) via QR, self-verify the instrument on return (topic-time), and authorize signed telemetry ingress that can sync back to the peer's HOP prime account.

## Constraints
* **Pure JavaScript** (`.mjs` core, `.js` host). No TypeScript.
* **Private key never leaves worklet.** Host requests signatures via IPC.
* **QR contains public data only** (instrument public key, nonce, account/context).
* **Replay protection** via single-use nonces (TTL).
* **ACL**: first-party writes require `from === device`; external devices require coupled key + valid signature.

## Instrument identity
* Each instrument has a persistent Ed25519 keypair in `medulla-identity` hyperbee.
* `MEDULLA_READY` emits `publicKey`. Secret key is retained only in worklet memory/store.

## Flow
1. **First-time coupling**
   - Worklet boots → emits `MEDULLA_READY { publicKey }`.
   - Radia/cale host renders QR `{ type:'conduction-couple', publicKey, nonce, accountId }`.
   - Peer scans in BentoBoxDS HOP → account registers `account ← instrument-public-key`.
   - Host sends `COUPLE { accountId, publicKey }` → worklet stores coupling (`medulla-couplings`).
2. **Self-verification on return (topic-time)**
   - Host/account issues challenge.
   - Host sends `VERIFY { challenge }` → worklet signs with instrument private key.
   - Worklet returns `VERIFIED { publicKey, signature, challenge }`.
   - Host forwards to BentoBoxDS; account verifies signature and records topic-time verification of the conduction-linked device.
3. **Authorized ingress**
   - Host builds envelope with `id/from/device/action/payload/ts/nonce` (`buildEnvelope`).
   - Host sends `INGRESS_TELEMETRY` envelope over IPC.
   - Worklet checks ACL + nonce freshness, attaches/verifies signature as appropriate, commits to `conduction/<device>/<ts>`, returns `INGRESS_COMMITTED { id, key }`.
   - Signed committed records provide auditable attribution for sync back to HOP prime account.

## Worklet IPC actions
`INGRESS_TELEMETRY`, `EGRESS_TELEMETRY`, `COUPLE`, `VERIFY` with correlated responses `INGRESS_COMMITTED`, `EGRESS_TELEMETRY`, `COUPLED`, `VERIFIED`, `MEDULLA_ERROR`.

## Data stores
* `medulla-identity` — instrument keypair.
* `medulla-conduction-index` — append-only telemetry ledger.
* `medulla-couplings` — account/device coupling records.
* `medulla-nonces` — replay protection cache (TTL, best-effort purge).

## Future: external BLE/wearables
BLE devices are not trusted by bundle alone. Each device must couple its own public key and sign ingress packets; worklet verifies signatures against the coupled key before commit (Model B challenge/response, to be wired with hyperswarm/secret-stream pairing).
