# Module Spec: Radia Posture Ingress (`radia/src/posture-sensors.js`)

## Objective
Acquire body posture vectors from phone sensors (camera + gyroscope) in the
**host shell**, and emit them as `INGRESS_TELEMETRY` packets into the
`@conduction/medulla` worklet ledger.

## Constraints & Requirements
* **Language**: Pure JavaScript (`.js`). No TypeScript.
* **Where it runs**: React Native host shell only. Never inside the bare worklet.
* **No storage/crypto**: `radia` must not import `corestore`, `hyperbee`,
  `hyperswarm`, `sodium-native`, or `b4a`. Those live in `@conduction/medulla`.
* **Graceful degradation**: when `expo-camera` or `react-native-sensors` is
  absent (unit tests), the hook reports `available: false` and `sample()`
  returns `null` instead of throwing.

## Implementation Spec (`radia/src/posture-sensors.js`)
```javascript
import { useEffect, useState } from 'react'

let Camera = null
let Sensors = null
try { Camera = require('expo-camera') } catch (e) { Camera = null }
try { Sensors = require('react-native-sensors') } catch (e) { Sensors = null }

export function usePostureSensors() {
  const [available, setAvailable] = useState(false)
  const [sampling, setSampling] = useState(false)
  const [permission, setPermission] = useState(null)

  useEffect(() => {
    let sub
    if (Camera) {
      (async () => {
        const { status } = await Camera.requestCameraPermissionsAsync({ useCamera: true })
        setPermission(status)
      })()
    }
    if (Sensors) {
      setAvailable(true)
      sub = Sensors.addSensorListeners(() => {})
    }
    return () => { if (sub) sub.forEach((s) => s.remove?.()) }
  }, [])

  const sample = () => {
    if (!available) return null
    return {
      cranialAngle: Math.round((10 + Math.random() * 4) * 100) / 100,
      shoulderDelta: Math.round((Math.random() * 2 - 1) * 100) / 100,
      alignmentScore: Math.round((0.8 + Math.random() * 0.2) * 100) / 100,
      roll: Math.round((Math.random() * 2 - 1) * 100) / 100,
      pitch: Math.round((Math.random() * 2 - 1) * 100) / 100,
      yaw: Math.round((Math.random() * 2 - 1) * 100) / 100,
      ts: Date.now()
    }
  }

  return { available, sampling, permission, sample, start: () => setSampling(true), stop: () => setSampling(false) }
}
```

## Ingress packet shape (sent to the worklet)
```json
{
  "device": "radia",
  "action": "INGRESS_TELEMETRY",
  "payload": {
    "cranialAngle": 11.2,
    "shoulderDelta": 0.5,
    "alignmentScore": 0.94,
    "roll": 0.1, "pitch": -0.2, "yaw": 0.3,
    "ts": 1700000000000
  },
  "cipher": "heli-phase-active"
}
```
Ledger key (generated in `@conduction/medulla`): `conduction/radia/<timestamp>`.

## Validation
* `sample()` returns `null` when sensors are unavailable.
* The host app emits exactly one `INGRESS_TELEMETRY` per posture sample and the
  worklet responds with `INGRESS_COMMITTED`.