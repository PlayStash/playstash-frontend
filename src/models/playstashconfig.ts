export interface PlayStashConfig {
  gameid?: number;
  versionid?: number;
  gametype?: string;
  downloadfinished: boolean;
  extractionfinished: boolean;
  installationfinished?: boolean;
  downloadprogress: string;
  launchexecutable?: string;
  launchparameters?: string;
  launchasadmin?: boolean;
  umugameid?: string;
  umustore?: string;
  umuprotonpath?: string;
  umuwineprefix?: string;
}
