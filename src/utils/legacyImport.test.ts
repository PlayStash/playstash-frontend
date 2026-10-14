import { describe, expect, it } from "vitest";
import {
  LEGACY_SETTING_TARGETS,
  mapLegacySettings,
  mapLegacyTheme,
  parseLegacyHeaders,
} from "./legacyImport";
import {
  buildAdoptedConfig,
  pickLegacyVersion,
  sanitizeFolderName,
  type LegacyInstallation,
} from "./legacyInstalls";

/** Rust `LEGACY_KEYS` (legacy_import.rs) minus the installation keys. */
const RUST_PROFILE_AND_GLOBAL_KEYS = [
  "LoginRememberMe",
  "LastUserProfile",
  "AdditionalRequestHeaders",
  "ApplicationLanguage",
  "ServerUrl",
  "Username",
  "IsLoggedInWithSSO",
  "UserID",
  "SessionToken",
  "ExtractionPassword",
  "Theme",
  "RootDirectories",
  "AutoExtract",
  "AutoInstallPortable",
  "AutoDeletePortable",
  "DownloadLimit",
  "BackgroundStart",
  "ShowMappedTitle",
  "FullscreenLibrary",
  "StartupSound",
  "ChatNotifications",
  "ActivityNotifications",
  "CommunityPresence",
  "SyncSteamShortcuts",
  "SyncDiscordPresence",
  "DiscordApplicationId",
  "CloudSaves",
  "UsePrimaryCloudSaveManifest",
  "CustomCloudSaveManifests",
  "MountIso",
  "CreateDesktopShortcut",
  "LibStartup",
  "RetainLibarySortByAndOrderBy",
  "LastLibrarySortBy",
  "LastLibraryOrderBy",
  "ArtworkSearchProviders",
  "MediaSliderVolume",
];

describe("legacy settings mapping", () => {
  it("covers exactly the keys Rust reads", () => {
    expect(Object.keys(LEGACY_SETTING_TARGETS).sort()).toEqual(
      [...RUST_PROFILE_AND_GLOBAL_KEYS].sort(),
    );
  });

  it("maps WPF values to the new keys and sections", () => {
    const mapped = mapLegacySettings({
      AutoExtract: "1",
      AutoDeletePortable: "0",
      DownloadLimit: "2500",
      MountIso: "1",
      LastLibrarySortBy: "metadata.rating",
      LastLibraryOrderBy: "DESC",
      SyncDiscordPresence: "1",
      DiscordApplicationId: "123456789",
      CustomCloudSaveManifests: "https://a/manifest.yaml; C:\\m.yaml;",
      ArtworkSearchProviders: '[{"Name":"SGDB","Url":"https://x/$GAME"}]',
      MediaSliderVolume: "0,5",
    });
    expect(mapped.local).toMatchObject({
      tauri_auto_extract: "1",
      tauri_auto_delete_source: "0",
      download_speed_limit_kb: "2500",
      tauri_mount_iso: "1",
      app_library_sort: "metadata.rating",
      app_library_order: "desc",
      playstash_media_volume: "0.5",
    });
    expect(mapped.sections.integrations).toEqual({
      syncDiscordPresence: true,
      discordApplicationId: "123456789",
    });
    expect(mapped.sections.cloudsaves).toEqual({
      customManifests: ["https://a/manifest.yaml", "C:\\m.yaml"],
      usePrimaryManifest: true,
    });
    expect(
      JSON.parse(mapped.profileLocal.playstash_artwork_search_providers),
    ).toEqual([{ name: "SGDB", url: "https://x/$GAME" }]);
  });

  it("uses the WPF defaults for missing keys", () => {
    const mapped = mapLegacySettings({});
    // AutoInstallPortable, ShowMappedTitle and LibStartup default to on.
    expect(mapped.local).toEqual({
      tauri_auto_install: "1",
      playstash_show_mapped_title: "1",
      playstash_library_autoload: "1",
    });
    expect(mapped.sections).toEqual({
      cloudsaves: { usePrimaryManifest: true },
    });
  });

  it("parses request headers and themes", () => {
    expect(
      parseLegacyHeaders(
        '[{"Name":"CF-Access-Client-Id","Value":"a"},{"Name":"","Value":"b"}]',
      ),
    ).toEqual([{ name: "CF-Access-Client-Id", value: "a" }]);
    expect(parseLegacyHeaders("garbage")).toEqual([]);
    expect(
      JSON.parse(
        mapLegacyTheme(
          '{"DisplayName":"Mine","Path":"C:\\\\x\\\\themes\\\\Mine.xaml"}',
          "C:\\app\\profiles\\p1\\themes",
        )!,
      ),
    ).toEqual({
      source: "file",
      path: "C:\\app\\profiles\\p1\\themes\\Mine.xaml",
      displayName: "Mine",
    });
    expect(
      JSON.parse(
        mapLegacyTheme('{"DisplayName":"Default Dark","Path":""}', null)!,
      ),
    ).toEqual({
      source: "builtin",
      id: "Default Dark",
      displayName: "Default Dark",
    });
  });
});

describe("legacy installations", () => {
  const installation: LegacyInstallation = {
    root: "D:\\Games",
    path: "D:\\Games\\PlayStash\\Installations\\(7)Doom",
    gameId: 7,
    title: "Doom",
    executableRelative: "bin/doom.exe",
    executable: "D:\\Games\\PlayStash\\Installations\\(7)Doom\\bin\\doom.exe",
    launchParameter: "-fast",
    installedGameVersion: "1.9",
    forcedGameType: "WINDOWS_PORTABLE",
    installationId: "guid-1",
  };

  it("picks the installed version, else the newest", () => {
    const versions = [
      { id: 1, version: "1.9", indexed_at: "2020-01-01" },
      { id: 2, version: "2.0", indexed_at: "2024-01-01" },
    ];
    expect(pickLegacyVersion(versions, "1.9")?.id).toBe(1);
    expect(pickLegacyVersion(versions, "0.1")?.id).toBe(2);
    expect(pickLegacyVersion(versions, "")?.id).toBe(2);
    expect(pickLegacyVersion([], "1.9")).toBeNull();
  });

  it("builds the version config with the cloud-save identity", () => {
    expect(
      buildAdoptedConfig(
        installation,
        { id: 7, type: "WINDOWS_SETUP" },
        { id: 1, version: "1.9" },
      ),
    ).toEqual({
      versionid: 1,
      downloadfinished: true,
      extractionfinished: true,
      installationfinished: true,
      downloadprogress: "",
      gametype: "WINDOWS_SETUP",
      launchexecutable: "bin/doom.exe",
      launchparameters: "-fast",
      forcedgametype: "WINDOWS_PORTABLE",
      installationid: "guid-1",
    });
  });

  it("names folders like the download pipeline", () => {
    expect(sanitizeFolderName('Half-Life: "Source"?')).toBe(
      "Half-Life - _Source__",
    );
  });
});
