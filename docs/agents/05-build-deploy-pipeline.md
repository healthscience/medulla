# Module Spec: Build, Test & Deployment Pipeline

## Objective
Compile the medulla worklet with `bare-pack`, publish `@conduction/medulla` to the
package channel, and have `radia`/`cale` consume it as a declared dependency.

## Execution Steps for Coding Agents

### Step 1: Bundle the Medulla Worklet
Compile `medulla.mjs` into an immutable target asset:
```bash
npm run prepack
# equivalent: npx bare-pack --preset --out medulla.bundle medulla.mjs
```
The bundle is shipped inside the package (`files: ["medulla.bundle"]`) and loaded
by host apps via `Worklet.start('/medulla.bundle', bundle, [storagePath])`.

### Step 2: Publish
```bash
npm publish --access restricted   # or: npm publish --registry <verdaccio>
```
Prefer a **private verdaccio** (or npm org) — prebuilt native bundles are better
gated than public npm.

### Step 3: Host apps consume the package
```bash
cd ../cale && npm install @conduction/medulla@^0.1.0
cd ../radia && npm install @conduction/medulla@^0.1.0
```
Host apps import only the public surface (`@conduction/medulla`) and their own
sensor modules. They never import `corestore`/`hyperbee`/`hyperswarm` directly.

### Step 4: Update medulla across apps
When medulla changes, bump its version, publish, then in each app:
```bash
npm install @conduction/medulla@<new-version>
```
**Never** `git clone` medulla into an app — that nests a second git repo and
breaks updates. Use the published package.

### Step 5: Validate
```bash
cd medulla && npm test        # vitest: identity, ingest, query, persistence
cd cale   && npm test
cd radia  && npm test
```

### Step 6: Prebuild & deploy (Android first)
```bash
npx expo prebuild
npx expo run:android
```
Human real-device test (Android):
1. Enable Developer options + USB debugging; confirm `adb devices` lists the
   device as authorized.
2. Run `npx expo run:android` and select the device.
3. Launch the app; verify status reads "Medulla Active (Corestore Mounted)".
4. Tap ingress buttons; verify commit text updates with keys.
5. Restart the app; verify prior commit keys still load from the POSIX storage
   path.
6. Inspect `adb logcat` for Bare/worklet or Corestore errors.
7. Confirm no mock layers or network dependencies were used.