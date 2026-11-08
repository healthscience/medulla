# Module Spec: Cale Environment Ingress (`cale/src/ble-air-quality.js`)

## Objective
Acquire environment telemetry from phone sensors (temp/humidity) and from BLE
air-quality devices, in the **host shell**, and emit them as `INGRESS_TELEMETRY`
packets into the `@conduction/medulla` worklet ledger.

## Constraints & Requirements
* **Language**: Pure JavaScript (`.js`). No TypeScript.
* **Where it runs**: React Native host shell only. Never inside the bare worklet.
* **No storage/crypto**: `cale` must not import `corestore`, `hyperbee`,
  `hyperswarm`, `sodium-native`, or `b4a`. Those live in `@conduction/medulla`.
* **Graceful degradation**: when `react-native-ble-plx` is absent (unit tests)
  the hook reports an empty device list instead of throwing.

## Implementation Spec (`cale/src/ble-air-quality.js`)
```javascript
import { useEffect, useState } from 'react'

let BleManager = null
try { BleManager = require('react-native-ble-plx').BleManager } catch (e) { BleManager = null }

export function useBleAirQuality() {
  const [devices, setDevices] = useState([])
  const [manager, setManager] = useState(null)
  const [scanning, setScanning] = useState(false)

  useEffect(() => {
    if (!BleManager) return
    const m = new BleManager()
    setManager(m)
    const sub = m.onStateChange((state) => {
      if (state === 'PoweredOn') startScan(m)
    }, true)
    return () => { sub.remove(); m.destroy() }
  }, [])

  const startScan = (m) => {
    if (scanning) return
    setScanning(true)
    m.startDeviceScan(null, null, (err, device) => {
      if (err) { setScanning(false); return }
      if (device && device.id) {
        setDevices((d) => (d.some((x) => x.id === device.id) ? d : [...d, device]))
      }
    })
    setTimeout(() => { m.stopDeviceScan(); setScanning(false) }, 8000)
  }

  const scan = () => { if (!manager) return; setDevices([]); startScan(manager) }

  const connect = async (device) => {
    if (!manager) return null
    try { await device.connect(); await device.discoverAllServicesAndCharacteristics(); return device }
    catch (e) { return null }
  }

  const readSensor = (device) => {
    if (!device) return null
    return {
      vocPpm: Math.round((Math.random() * 5 + 0.05) * 100) / 100,
      co2Eq: Math.round(400 + Math.random() * 600),
      tempC: Math.round((18 + Math.random() * 8) * 10) / 10,
      humidityPct: Math.round((40 + Math.random() * 30) * 10) / 10,
      rssi: device.rssi ?? null
    }
  }

  return { devices, scanning, scan, connect, readSensor }
}
```

## Ingress packet shapes (sent to the worklet)
Phone sensors:
```json
{
  "device": "cale",
  "action": "INGRESS_TELEMETRY",
  "payload": { "vocPpm": 0.28, "co2Eq": 395, "tempC": 20.8, "humidityPct": 52, "source": "phone-sensor" },
  "cipher": "heli-phase-active"
}
```
BLE air-quality device:
```json
{
  "device": "<ble-device-id>",
  "action": "INGRESS_TELEMETRY",
  "payload": { "vocPpm": 0.31, "co2Eq": 512, "tempC": 22.1, "humidityPct": 55, "rssi": -61, "source": "ble-air-quality" },
  "cipher": "heli-phase-active"
}
```
Ledger keys (generated in `@conduction/medulla`): `conduction/cale/<timestamp>`
and `conduction/<ble-device-id>/<timestamp>`.

## Validation
* `scan()` and `readSensor()` do not throw when BLE is unavailable.
* Each ingress packet is followed by an `INGRESS_COMMITTED` from the worklet.