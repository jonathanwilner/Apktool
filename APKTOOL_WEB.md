# apktool-web (local)

This repo now includes a small local web app that resigns an uploaded APK for re-installability, then serves it for download.

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

- The output APK is signed with an auto-generated debug keystore stored at `~/.local/state/apktool-web/keystore/debug.keystore`.
- This runs locally on your machine; treat uploaded APKs as untrusted inputs anyway.
