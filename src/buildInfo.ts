// 修正ごとに BUILD_NUMBER をインクリメントする運用。
export const APP_NAME = "Discord Codex Agent";
export const APP_VERSION = "0.1.0";
export const BUILD_NUMBER = 30;

export function getBuildLabel(): string {
  return `v${APP_VERSION} build.${BUILD_NUMBER}`;
}
