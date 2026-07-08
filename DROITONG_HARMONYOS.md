# Droitong / HarmonyOS APK Repack Workflow

This is the default workflow for APKs that need to install through Droitong or HarmonyOS compatibility layers.

## Default Policy

For ordinary third-party apps, publish a standalone merged APK as the primary artifact.

Do not make `.apks`, `.apkm`, `.xapk`, or SAI flows the first recommendation for HarmonyOS/Droitong. HarmonyOS browser downloads can hand SAI a `content://ohos/docs/...` URI that SAI cannot open, and installing only `base.apk` from a split bundle causes invalid or incomplete package errors.

The durable path is:

1. Download the source bundle.
2. Extract the base APK and selected device splits.
3. Decode the base APK and relevant splits.
4. Apply the Droitong-safe package/name changes.
5. Patch runtime identity strings that still point at the original package.
6. Merge the selected split contents into the decoded base tree.
7. Rebuild one APK.
8. Zipalign and sign it.
9. Validate and publish the single `.apk` as the main link.

Keep split bundles only as an advanced fallback.

## Exception

Do not repack official Google/GMS target packages when the user needs full GMS or an app checks the official target signature. In that case, preserve the official package and signature, and rename or repack only the installer/helper identity.

## Split Merge Rules

Merge only the splits needed by the target device:

- ABI: usually `split_config.arm64_v8a.apk` for current Huawei/HarmonyOS devices.
- Language: include the desired language splits, commonly `en` and `zh`.
- Density: include the density splits present in the bundle unless you know the target density.

When merging decoded split directories:

- Copy `lib/<abi>/*.so` from ABI splits into the decoded base.
- Copy resource files from split `res/` directories into the base `res/`.
- Skip split `res/values/public.xml`; it is split-resource bookkeeping.
- Merge `res/values*.xml` files by adding missing entries and rejecting conflicting duplicate resource names.
- Do not overwrite a base file unless the duplicate bytes are identical.
- Remove stale original signature material such as `unknown/META-INF` before rebuild.

The helper script in the Codex skill `droitong-apk-repack` automates this decoded-tree merge step.

## Runtime Identity Strings

After changing the manifest package, scan decoded smali and assets for old runtime package identity strings. Patch these to the new package:

- Exact package constants such as `"com.autonavi.minimap"`.
- Process constants such as `"com.autonavi.minimap:locationservice"`.
- Package-owned permission constants such as `"com.autonavi.minimap.permission.RECV_MESSAGE"`.
- JSON config package fields such as `"package": "com.autonavi.minimap"` and `"package_name": "com.autonavi.minimap"`.

Do not rewrite Java class names or smali descriptors such as `Lcom/autonavi/minimap/...`; those are implementation classes and must remain unchanged. Also be careful with intent action strings unless the manifest/action pair is patched together.

## Validation

Before publishing, verify the final standalone APK:

```bash
zipalign -c -p -v 4 app.apk
apksigner verify --verbose --print-certs app.apk
aapt2 dump badging app.apk | rg "package:|application-label|native-code"
sha256sum app.apk
```

The final `aapt2 dump badging` output should show:

- The renamed package expected by the Droitong workaround.
- The visible label expected by the user.
- `native-code: 'arm64-v8a'` when native arm64 libraries were merged.

## Publishing

Publish the standalone APK under `/var/lib/remote-code/apks` and make it the main card/link in `/var/lib/remote-code/apks/index.html`.

Regenerate checksums after copying:

```bash
cd /var/lib/remote-code/apks
find . -maxdepth 1 -type f ! -name SHA256SUMS -printf '%f\0' | sort -z | xargs -0 sha256sum > SHA256SUMS.tmp
mv SHA256SUMS.tmp SHA256SUMS
```

Then verify the public URL:

```bash
curl -fsSIL https://remote.thewilners.com/apks/<artifact>.apk
curl -fsSL https://remote.thewilners.com/apks/SHA256SUMS | rg "<artifact>.apk"
```

## Current Example

AMap Global `16.19.11.2007` was converted from an APKMirror split bundle into:

```text
amapx-droitong-16.19.11.2007-com.thewilners.amapx-single.apk
```

Package: `com.thewilners.amapx`
Label: `AMap X`

That single APK replaced the split bundle as the primary install link because SAI failed on HarmonyOS before it could read the `.apks` archive. A later compat build also patched runtime package/process/permission constants after the app opened, accepted terms, and crashed with the first standalone build.
