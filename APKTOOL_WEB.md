# apktool-web (local)

The local web app records the uploaded APK SHA-256 and runs `apksigner verify --verbose --print-certs` before processing. The default operation preserves the exact original bytes and signature. Select resign explicitly to replace the signature with the local debug key.

## Run

```bash
cd /home/jonathan/src/apktool
nix run .#web
```

Then open:

```text
http://127.0.0.1:8787
```

## NixOS Service (Permanent)

This flake provides a NixOS module at `nixosModules.apktool-web` that installs a permanent systemd service.

Example (flake-based NixOS config):

```nix
{
  inputs.apktool.url = "path:/home/jonathan/src/apktool";

  outputs = { self, nixpkgs, apktool, ... }: {
    nixosConfigurations.yourHost = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        apktool.nixosModules.apktool-web
        ({ pkgs, ... }: {
          services.apktool-web = {
            enable = true;
            package = apktool.packages.${pkgs.system}.web;
            requireCfAccess = true;
            allowedEmails = [ "you@example.com" ];
          };
        })
      ];
    };
  };
}
```

## Output locations

- Job workspace + logs: `${APKTOOL_WEB_STATE_DIR:-~/.local/state/apktool-web}/jobs/<jobId>/`
- Output APK is copied to: `${APKTOOL_WEB_DOWNLOADS_DIR:-~/mini/Downloads}/`
  - The log is copied alongside as: `*.apk.log.txt`

## Droitong / HarmonyOS split bundles

For Droitong or HarmonyOS compatibility installs, prefer a standalone merged APK over a split bundle. If the source is an APKMirror `.apkm`, `.apks`, or `.xapk`, decode the base and selected splits, patch the package/name plus runtime identity strings, merge the ABI/resources/language splits into the base tree, rebuild one APK, zipalign/sign it, and publish that single `.apk` as the primary link.

Do not make SAI or `.apks` the first path for these devices. HarmonyOS can hand SAI a `content://ohos/docs/...` URI that fails before SAI reads the archive. See [DROITONG_HARMONYOS.md](DROITONG_HARMONYOS.md) for the durable workflow.

## Notes

- Only explicitly resigned output is signed with an auto-generated debug keystore stored at `~/.local/state/apktool-web/keystore/debug.keystore`.
- This runs locally on your machine; treat uploaded APKs as untrusted inputs anyway.

## Source provenance and operation selection

`POST /api/upload` defaults to `operation=preserve`. Use `/api/upload?operation=resign` to request signing with the local debug key. The retry endpoint retains the original selection. Download links become available only when processing completes.

Job metadata includes `source.sha256`, `source.signature.status`, signer certificate SHA-256 digests when available, verification diagnostics, and `outputSha256`. Signature status is `verified`, `failed` for verifier rejection, or `error` when verification cannot run or times out. Preserve mode also returns invalid or unverifiable inputs unchanged for inspection; inspect the signature result before installing.

A verified signature proves cryptographic integrity. Establish publisher identity by comparing with a trusted distribution reference. Malware assessment remains `not-performed`. Neither signature verification nor resigning establishes Huawei or Droitong compatibility. Resigning can break updates and signature-dependent functions.

Run API and provenance tests with `npm -C web test`. Tests use a controlled verifier fixture and exercise original-byte downloads and verifier failure reporting.
