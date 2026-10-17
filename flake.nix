{
  description = "apktool + apktool-web (APK metadata patcher) using Nix";

  inputs = {
    # Avoid GitHub API rate limits by fetching the branch tarball directly.
    # If you want a fully pinned revision, replace this with a specific commit tarball URL.
    nixpkgs.url = "tarball+https://github.com/NixOS/nixpkgs/archive/nixos-unstable.tar.gz";
  };

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f system);
    in
    {
      nixosModules = {
        apktool-web = import ./nixos/apktool-web.nix;
        default = import ./nixos/apktool-web.nix;
      };

      packages = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          lib = pkgs.lib;

          apktoolVersion = "2.12.1";
          apktoolJar = pkgs.fetchurl {
            url = "https://github.com/iBotPeaches/Apktool/releases/download/v${apktoolVersion}/apktool_${apktoolVersion}.jar";
            hash = "sha256-Zs9FJKSkWn9WVn0Issm27CN7zdeM7mn9SlnIoCQ66vo=";
          };

          apktool = pkgs.stdenvNoCC.mkDerivation {
            pname = "apktool";
            version = apktoolVersion;
            src = null;
            dontUnpack = true;
            nativeBuildInputs = [ pkgs.makeWrapper ];
            installPhase = ''
              runHook preInstall
              mkdir -p $out/lib $out/bin
              cp ${apktoolJar} $out/lib/apktool.jar
              # Apktool needs standard Java modules (e.g. java.logging).
              makeWrapper ${pkgs.jdk21}/bin/java $out/bin/apktool \
                --add-flags "--add-modules java.logging -jar $out/lib/apktool.jar" \
                --set-default _JAVA_OPTIONS "-Xms64m -Xmx2g"
              runHook postInstall
            '';
            meta = {
              description = "Apktool (wrapper around upstream release jar)";
              homepage = "https://github.com/iBotPeaches/Apktool";
              license = lib.licenses.asl20;
              platforms = lib.platforms.linux;
            };
          };

          apktoolWeb = pkgs.buildNpmPackage {
            pname = "apktool-web";
            version = "0.1.0";
            src = ./web;

            # Filled after first build attempt (see README).
            npmDepsHash = "sha256-mAGKnVWLnnBsOXxLbrE8KVPeUbW5oWGILGTqCP0a6yM=";

            npmBuildScript = "build";

            installPhase = ''
              runHook preInstall
              mkdir -p $out/lib
              # Runtime needs node_modules for server.mjs imports.
              npm prune --omit=dev --silent
              cp -r dist $out/lib/dist
              cp server.mjs provenance.mjs $out/lib/
              cp -r node_modules $out/lib/node_modules
              runHook postInstall
            '';

            nativeBuildInputs = [ pkgs.makeWrapper ];
            postFixup = ''
              makeWrapper ${pkgs.nodejs_20}/bin/node $out/bin/apktool-web \
                --add-flags "$out/lib/server.mjs" \
                --set APKSIGNER_BIN ${pkgs.apksigner}/bin/apksigner \
                --set KEYTOOL_BIN ${pkgs.jdk21}/bin/keytool \
                --set WEB_ASSETS_DIR $out/lib/dist \
                --prefix PATH : ${lib.makeBinPath [ pkgs.apksigner pkgs.jdk21 ]}
            '';
          };
        in
        {
          apktool = apktool;
          web = apktoolWeb;
          default = apktoolWeb;
        }
      );

      apps = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        {
          default = {
            type = "app";
            program = "${self.packages.${system}.web}/bin/apktool-web";
          };
        }
      );

      devShells = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        {
          default = pkgs.mkShell {
            packages = [
              self.packages.${system}.apktool
              pkgs.apksigner
              pkgs.jdk21
              pkgs.nodejs_20
              pkgs.npm-check-updates
            ];
          };
        }
      );
    };
}
