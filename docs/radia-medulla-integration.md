# Radia ↔ Medulla Integration (Handoff)

This document tells the **radia** coding agent how to integrate with `@conduction/medulla` for authenticated posture ingress, device coupling (QR), and self-verification against a BentoBoxDS HOP prime account.

## Roles

| Component | Runs where | Responsibility |
|---|---|---|
| `radia` host app (React Native/Expo) | UI thread | Camera/gyroscope sensors, QR coupling UI, user prompts, forwards signed challenge to BentoBoxDS |
| `@conduction/medulla` bare worklet | background worklet | Instrument keypair, ledger, ACL, anti-replay, signing. **Private key never leaves worklet** |
| BentoBoxDS HOP prime account | peer/account service | Registers instrument public key, verifies challenge signature, records topic-time verification |

## Install / bundle

```bash
npm install @conduction/medulla
# medulla ships medulla.bundle; host starts it via react-native-bare-kit
```

Worklet startup (reference host-shell pattern; copy/adapt into radia):
```js
import { Worklet } from 'react-native-bare-kit'
import { documentDirectory } from 'expo-file-system'
import bundle from '@conduction/medulla/bundle' // or local copy

const worklet = new Worklet()
worklet.start('/medulla.bundle', bundle, [String(documentDirectory)])
```

## IPC contract

All IPC is JSON over `worklet.IPC`. Every request should carry a unique `id`; responses echo it for correlation.

### 1) Ready
Worklet emits on boot:
```json
{ "type": "MEDULLA_READY", "path": "<storage>", "publicKey": "<hex-ed25519-pubkey>", "protocol": "conduction/medulla/v1" }
```
Radia stores `publicKey` in state; it is the instrument identity used in the QR.

### 2) Coupling (QR → account registration → worklet record)
**QR payload (rendered in radia):**
```json
{
  "v": 1,
  "type": "conduction-couple",
  "instrument": "radia",
  "publicKey": "<instrument-pubkey-hex>",
  "nonce": "<random>",
  "accountId": "<bentoboxds-hop-prime-account-id or placeholder>"
}
```
Peer scans in BentoBoxDS HOP and registers `account ← instrument publicKey`.

**Host → worklet (record coupling locally):**
```json
{
  "id": "rpc-1",
  "action": "COUPLE",
  "payload": {
    "accountId": "bentoboxds-hop-prime-account-id",
    "publicKey": "<instrument-pubkey-hex>",
    "meta": { "instrument": "radia", "coupledVia": "qr" }
  }
}
```
**Worklet → host:**
```json
{ "id": "rpc-1", "type": "COUPLED", "accountId": "...", "publicKey": "...", "instrument": "...", "coupledAt": 1700000000000, "status": "OK" }
```

### 3) Self-verification on return (topic-time)
BentoBoxDS issues a challenge (or radia derives one agreed with the account, e.g. `couple:<accountId>:<ts>:<nonce>`).

**Host → worklet:**
```json
{ "id": "rpc-2", "action": "VERIFY", "payload": { "challenge": "couple:acct:1700000000000:nonce" } }
```
**Worklet → host (private key never leaves):**
```json
{ "id": "rpc-2", "type": "VERIFIED", "publicKey": "<hex>", "signature": "<hex>", "challenge": "...", "signedAt": 1700000000000, "status": "OK" }
```
**Radia forwards to BentoBoxDS HOP** for verification against the registered public key and stores a topic-time verification record. The account side can verify with the same algorithm (Ed25519 detached signature over UTF-8 challenge) or by importing medulla's static helper in a Node/Bare environment:
```js
import { Medulla } from '@conduction/medulla'
Medulla.verifyChallenge(challenge, signature, publicKey) // boolean
```

### 4) Authenticated posture ingress
Radia owns the `radia` device namespace (`from: 'radia'`, `device: 'radia'`). The worklet enforces ACL and replay protection; it attaches the instrument signature on commit.

**Host → worklet:**
```json
{
  "id": "rpc-3",
  "from": "radia",
  "device": "radia",
  "action": "INGRESS_TELEMETRY",
  "payload": {
    "cranialAngle": 11.2,
    "shoulderDelta": 0.5,
    "alignmentScore": 0.94,
    "roll": 0.1,
    "pitch": -0.2,
    "yaw": 0.3,
    "source": "phone-sensor"
  },
  "ts": 1700000000000,
  "nonce": "<unique-hex-nonce>",
  "cipher": "heli-phase-active"
}
```
Use `buildEnvelope` from `@conduction/medulla/ingress` to generate `id/ts/nonce` consistently:
```js
import { buildEnvelope, INGRESS_TELEMETRY } from '@conduction/medulla'
const env = buildEnvelope({
  from: 'radia',
  device: 'radia',
  action: INGRESS_TELEMETRY,
  payload: postureSample,
  cipher: 'heli-phase-active'
})
worklet.IPC.write(JSON.stringify(env))
```

**Worklet → host:**
```json
{ "id": "rpc-3", "type": "INGRESS_COMMITTED", "key": "conduction/radia/1700000000000", "device": "radia", "status": "OK", "recordedAt": 1700000000000 }
```

### 5) Egress (read back)
```json
{ "id": "rpc-4", "action": "EGRESS_TELEMETRY", "device": "radia", "payload": { "limit": 100 } }
```
Response contains `records` newest-first.

## Radia UI/components to add

1. **CouplingScreen** (first-time / uncoupled state)
   - Wait for `MEDULLA_READY` and `publicKey`.
   - Render QR from `{ v, type:'conduction-couple', instrument:'radia', publicKey, nonce, accountId }`.
   - After BentoBoxDS confirms scan/registration (deep link, callback, or manual confirm), send `COUPLE`.
   - Persist coupled state locally (AsyncStorage/MMKV) keyed by `accountId + publicKey`.

2. **Verification flow** (returning peer / topic-time check)
   - Request challenge from BentoBoxDS (or generate agreed challenge).
   - Send `VERIFY` to worklet; forward `VERIFIED` payload to BentoBoxDS.
   - Display topic-time verification status per conduction-linked device.

3. **Posture ingress loop**
   - `usePostureSensors()` samples camera+gyroscope.
   - For each sample, build envelope and `IPC.write`.
   - Correlate `INGRESS_COMMITTED` by `id`; show ledger status/errors.
   - Do not store private keys or sign in JS; medulla signs on commit.

4. **Error handling**
   - `MEDULLA_ERROR` may include `id` — reject matching pending RPC.
   - Replay/ACL/signature errors are fatal for that packet; do not auto-retry with same nonce.

## Security boundaries

- Private key never leaves medulla worklet.
- QR contains **public key only** (+ nonce/account context), never secrets.
- Host asks worklet to sign challenges; host forwards signatures.
- Nonces are single-use within TTL; always generate fresh envelopes.
- ACL: `from === device` for first-party radia/phone writes. External BLE/wearable devices must present coupled keys and signatures.

## Compatibility notes

- Legacy `medulla.ingest(device, payload, cipher, timestamp)` still works in core/tests; prefer envelope form for new host code.
- `examples/host-shell/App.js` in this package is a reference shell (React Native); radia may copy/adapt it. medulla ships no RN/Expo app code.
- P2P pairing (`hyperswarm`/`secret-stream`) is declared but not fully wired; coupling/verification here is the account-auth path needed for BentoBoxDS sync-back.
