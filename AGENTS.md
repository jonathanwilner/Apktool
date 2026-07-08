# Agent Instructions

## Droitong / HarmonyOS APK Repack Default

When working in this checkout on Droitong, HarmonyOS, EasyAbroad, or Huawei compatibility APK install problems, prefer a standalone merged APK for ordinary third-party split-bundle apps.

If the source is `.apkm`, `.apks`, `.xapk`, or an APKMirror page marked as a bundle:

1. Extract and decode the base APK plus relevant device splits.
2. Apply the requested package/name changes.
3. Patch runtime identity strings that still point at the old package, especially exact package strings, process names, package-owned permissions, and JSON config package fields.
4. Merge selected split `lib/` and `res/` content into the decoded base tree.
5. Rebuild one APK, zipalign, sign, validate, and publish the single `.apk` as the primary install link.
6. Keep `.apks` or SAI artifacts only as advanced fallbacks.

When patching runtime identity strings, do not rewrite Java class names or smali descriptors such as `Lcom/autonavi/minimap/...`; those are implementation classes and must remain loadable.

Do not make SAI the primary path for HarmonyOS/Droitong unless the user explicitly asks. HarmonyOS can hand SAI a `content://ohos/docs/...` URI that fails before archive parsing, and partial split installs can show invalid or incomplete package errors.

Exception: for official Google/GMS packages where the target package and signature must stay official, preserve the official APKs and change only the installer/helper identity.

See [DROITONG_HARMONYOS.md](DROITONG_HARMONYOS.md) and the Codex skill `droitong-apk-repack`.
