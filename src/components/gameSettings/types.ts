/** The locally installed version Game Settings works on. */
export type SettingsInstalledGame = {
  gameId: number;
  gameTitle: string;
  gameType?: string;
  versionId: number;
  versionName: string;
  installationDirectory: string;
  versionDirectory: string;
};
