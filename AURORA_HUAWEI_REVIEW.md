# Aurora Store Huawei review — 17 Oct 2026

## Conclusion

The supplied [Google Drive APK](https://drive.google.com/file/d/1CV2KskSZthGGBmOnIZiICoVHaHzLQegT/view) is byte-for-byte identical to [F-Droid Aurora Store 4.8.4 (76)](https://f-droid.org/repo/com.aurora.store_76.apk). It contains no additional Huawei modification relative to that reference. All 1,079 ZIP entries match, and the complete file SHA-256 matches.

The separate official Huawei build adds an AppGallery-assisted installer. This can improve installation on supported Huawei Android environments. The reviewed code provides no demonstrated way to escape or replace DroiTong. No device execution or comparative installation test was performed.

## Artifacts and signatures

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| Drive / F-Droid 4.8.4 | 9,360,088 | `fd9c75d90d0f4a7c132b9b4a5a2cf1992a45e03b8d8ff988b7dcfbc0db2c4d11` |
| Official vanilla 4.8.4 | 9,362,660 | `8a1ed9aa09631290da91cb793e0517b0f20dc70239ac94ae6682cd94f91a4bad` |
| Official Huawei 4.8.4 | 9,759,751 | `9fe9c3c6a64998da7550de6cb1a4ef9c0f60d4142eaf33448c58d68e7b6e6863` |

All pass Android apksigner verification. F-Droid verifies v1/v2/v3; official builds verify v1/v2. Signer certificate SHA-256:

- F-Droid: `5c83c7672b929955dc0a1db89a5e6ae4389e2eae7ec939956041694e5815f532`.
- Both Aurora publisher builds: `4c626157ad02bda3401a7263555f68a79663fc3e13a4d4369a12570941aa280f`.

These distributions have different signing identities. Re-signing loses the original publisher identity and can break updates or signature-dependent integration. Verification logs include META-INF JAR coverage warnings; artifact identity here rests on complete-file equality, not embedded revision text.

Official references: [vanilla APK](https://auroraoss.com/downloads/AuroraStore/Release/AuroraStore-4.8.4.apk), [Huawei APK](https://auroraoss.com/downloads/AuroraStore/Release/huawei/AuroraStore-hw-4.8.4.apk), [4.8.4 source](https://gitlab.com/AuroraOSS/AuroraStore/-/tree/4.8.4).

## Actual Huawei changes

The 4.8.4 source flavor files and APK inspection establish:

- The Huawei flavor uses version suffix `-hw`, disables anonymous login, and adds Huawei HMS core-service integration. Vanilla enables anonymous login and supplies its dispenser URL; Huawei has no default dispenser.
- Huawei declares `INSTALL_PACKAGES` and `DELETE_PACKAGES`. A manifest declaration does not grant privileged installation rights.
- Huawei `InstallerStatusReceiver` checks installed `com.huawei.appmarket` metadata `appgallery_support_function`, bit 5. When supported, it connects a Huawei `ApiClient` with home country `CN` and submits the PackageInstaller session ID in a `SilentInstallRequest`.
- Failed connection, missing support, or unsuccessful responses lead to the normal user-confirmation installer flow.
- Huawei can prompt for microG when Huawei/AppGallery conditions apply. This does not itself install or grant Google privileged services.
- Package identity remains `com.aurora.store`. Self-update support differs by flavor and signer; the shared helper excludes F-Droid-signed builds and limits supported flavors.

The official Huawei-versus-vanilla archive comparison has 41 added entries, 2 removed entries, 214 changed entries, and 863 unchanged entries. These counts include build resources and signatures and are not counts of behavioral changes.

An Android AppGallery service must be reachable from the app's execution environment for this integration to work. The code does not establish that native HarmonyOS AppGallery exports that Android service into DroiTong. Better DroiTong avoidance therefore remains unproven. Generic manifest renaming cannot reproduce this service integration.

## Malware assessment

No additional malicious modification was found in the supplied APK: it is the exact independently downloaded F-Droid artifact. This is a strong provenance result, not a complete malware certification.

REA/JADX inspected packages, installer classes, and the Huawei receiver methods `a`, `b`, and `c`; Apktool decoded the Drive APK. A targeted scan of Aurora-owned smali found no matches for DroiTong/EasyAbroad, `DexClassLoader`, `Runtime.exec`, or `ProcessBuilder`. This scan does not exclude reflection, library behavior, or other execution paths.

All four native libraries, one `libandroidx.graphics.path.so` for each ABI, match across all four APKs. Scanning every archive entry for ELF magic found no additional hidden native library. Ghidra headless analysis of arm64 and REA native analysis completed successfully. The decompilation registers AndroidX path iteration and conic conversion methods. Native imports and strings showed no network, shell-execution, or dynamic-payload-loader indicators.

[F-Droid's package page](https://f-droid.org/packages/com.aurora.store/) documents dependence on the Google Play network service and privacy concerns about app-list/system information sent to Google servers. Expected store traffic should not be confused with a third-party malware addition. No runtime traffic capture, sandbox execution, account test, or exhaustive Java/library audit was performed.

## Applied to apktool

- Web uploads now default to preserving the original APK bytes. Re-signing is an explicit operation.
- Source SHA-256, signature verification diagnostics, certificate SHA-256, and output identity are recorded separately from malware assessment. A successful signature check never displays a malware clearance.
- `scripts/compare-apks.py CANDIDATE REFERENCE --apksigner /path/to/apksigner` produces a full-file and ZIP-entry comparison plus signature diagnostics. It never extracts or executes the APK. Duplicate ZIP names and excessive uncompressed size are rejected.
- The Nix web package includes the new provenance runtime module.
- Repacking policy now prioritizes preserving verified vendor builds where signing or AppGallery integration matters.

Python comparison tests, web API preservation/error tests, TypeScript checking, the Vite production build, and `nix build .#web --no-link` passed. No live service deployment or device validation is claimed.

## Retained evidence

Local evidence is under `work/aurora-huawei-review/`: all four APKs, reference source archive, package/class/method REA JSON, decoded Drive smali, signature and entry comparisons, and `native-audit/REPORT.md` with Ghidra decompilation, ELF inventories, and logs. APKs and raw analysis remain untracked.

Long analyses and checks ran through nom-tmux. Local dashboard records are available; public dashboard requests returned HTTP 403 during review, so public visibility was not verified.
