export type UpdateMode = "install" | "notify" | "dev";
export type NotifyReason = "unsigned-mac" | "portable" | "unsupported";
export type UpdatePhase = "disabled" | "idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "installing" | "error";

export interface UpdateState {
  mode: UpdateMode;
  arch: string | null;
  notifyReason: NotifyReason | null;
  phase: UpdatePhase;
  currentVersion: string;
  availableVersion: string | null;
  percent: number | null;
  message: string;
  checkedAt: number | null;
  blocked: boolean;
}

export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export const RELEASES_URL: string;
export const HOST_LIVE_MESSAGE: string;
export const CHECK_INTERVAL_MS: number;
export const STARTUP_DELAY_MS: number;
export const DOWNLOAD_STALL_MS: number;
export function updateMode(options: { platform: string; isPackaged: boolean; portable: boolean }): UpdateMode;
export function notifyReasonFor(options: { platform: string; portable: boolean }): NotifyReason;
export function describeUpdateError(error: unknown): { noRelease: boolean; message: string };
export function createUpdateController(deps: {
  getUpdater: () => UpdaterLike;
  mode: UpdateMode;
  notifyReason?: NotifyReason | null;
  arch?: string | null;
  currentVersion: string;
  hostIsLive: () => boolean;
  emit: (state: UpdateState) => void;
  openExternal: (url: string) => void;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
}): {
  status(): UpdateState;
  check(): Promise<UpdateState>;
  install(): { ok: boolean; blocked?: boolean; message?: string };
  openDownloadPage(): boolean;
};
