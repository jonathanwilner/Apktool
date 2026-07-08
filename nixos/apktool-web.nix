{ lib, pkgs, config, ... }:

let
  cfg = config.services.apktool-web;
  toCsv = xs: lib.concatStringsSep "," xs;
in
{
  options.services.apktool-web = {
    enable = lib.mkEnableOption "apktool-web (APK repackager web UI)";

    package = lib.mkOption {
      type = lib.types.nullOr lib.types.package;
      default = null;
      description = "The apktool-web package to run.";
    };

    host = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Bind host.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 8787;
      description = "Bind port.";
    };

    requireCfAccess = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "If true, require Cloudflare Access headers at the origin.";
    };

    allowedEmails = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [];
      description = "Optional allowlist enforced when Cloudflare Access email header is present.";
    };

    stateDir = lib.mkOption {
      type = lib.types.path;
      default = "/var/lib/apktool-web";
      description = "Directory for job workspaces and logs.";
    };

    downloadsDir = lib.mkOption {
      type = lib.types.path;
      default = "/var/lib/apktool-web/downloads";
      description = "Directory where completed APKs and logs are copied.";
    };

    logLevel = lib.mkOption {
      type = lib.types.str;
      default = "info";
      description = "Fastify logger level.";
    };

    user = lib.mkOption {
      type = lib.types.str;
      default = "apktool-web";
      description = "User account to run the service as.";
    };

    group = lib.mkOption {
      type = lib.types.str;
      default = "apktool-web";
      description = "Group to run the service as.";
    };

    createUser = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Whether to create the system user/group if they do not exist.";
    };

    enableZipalign = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "If true, add android-tools (zipalign) to PATH for better repackaging.";
    };

    retries = lib.mkOption {
      type = lib.types.int;
      default = 2;
      description = "How many times to retry external commands.";
    };

    retryDelayMs = lib.mkOption {
      type = lib.types.int;
      default = 750;
      description = "Delay between retries.";
    };

    timeoutSignMs = lib.mkOption {
      type = lib.types.int;
      default = 5 * 60 * 1000;
      description = "Timeout for apksigner sign.";
    };

    timeoutVerifyMs = lib.mkOption {
      type = lib.types.int;
      default = 5 * 60 * 1000;
      description = "Timeout for apksigner verify.";
    };

    timeoutKeytoolMs = lib.mkOption {
      type = lib.types.int;
      default = 2 * 60 * 1000;
      description = "Timeout for keytool (keystore generation).";
    };

    timeoutZipalignMs = lib.mkOption {
      type = lib.types.int;
      default = 2 * 60 * 1000;
      description = "Timeout for zipalign.";
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.package != null;
        message = "services.apktool-web.package must be set (typically to the flake package `self.packages.${pkgs.system}.web`).";
      }
    ];

    users.groups = lib.mkIf cfg.createUser { "${cfg.group}" = { }; };
    users.users = lib.mkIf cfg.createUser {
      "${cfg.user}" = {
        isSystemUser = true;
        group = cfg.group;
        home = cfg.stateDir;
        createHome = true;
      };
    };

    systemd.tmpfiles.rules = [
      "d ${cfg.stateDir} 0750 ${cfg.user} ${cfg.group} - -"
      "d ${cfg.downloadsDir} 0750 ${cfg.user} ${cfg.group} - -"
    ];

    systemd.services.apktool-web = {
      description = "apktool-web (APK repackager)";
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      wantedBy = [ "multi-user.target" ];

      serviceConfig = {
        Type = "simple";
        User = cfg.user;
        Group = cfg.group;
        WorkingDirectory = cfg.stateDir;
        Restart = "always";
        RestartSec = 2;

        # Some APKs can be very large; avoid arbitrary small defaults.
        MemoryMax = "4G";
      };

      path =
        [ pkgs.coreutils pkgs.findutils pkgs.gnugrep pkgs.gnused ]
        ++ lib.optionals cfg.enableZipalign [ pkgs.android-tools ];

      environment = {
        HOST = cfg.host;
        PORT = toString cfg.port;
        LOG_LEVEL = cfg.logLevel;

        APKTOOL_WEB_STATE_DIR = toString cfg.stateDir;
        APKTOOL_WEB_DOWNLOADS_DIR = toString cfg.downloadsDir;

        REQUIRE_CF_ACCESS = if cfg.requireCfAccess then "1" else "0";
        ALLOWED_EMAILS = toCsv cfg.allowedEmails;

        APKTOOL_WEB_CMD_RETRIES = toString cfg.retries;
        APKTOOL_WEB_CMD_RETRY_DELAY_MS = toString cfg.retryDelayMs;
        APKTOOL_WEB_TIMEOUT_SIGN_MS = toString cfg.timeoutSignMs;
        APKTOOL_WEB_TIMEOUT_VERIFY_MS = toString cfg.timeoutVerifyMs;
        APKTOOL_WEB_TIMEOUT_KEYTOOL_MS = toString cfg.timeoutKeytoolMs;
        APKTOOL_WEB_TIMEOUT_ZIPALIGN_MS = toString cfg.timeoutZipalignMs;
      };

      # Run the flake-provided app.
      script = ''
        exec ${cfg.package}/bin/apktool-web
      '';
    };
  };
}
