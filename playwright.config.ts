import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * ストーリーテスト（ユーザー操作を通しで実行するテスト）用の設定。
 * PC とスマートフォンの両方で遊べることが本プロジェクトの必須要件なので、
 * デスクトップとモバイル相当の2プロジェクトで同じストーリーを流す。
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // 不安定さをリトライで隠さない。落ちたら原因を直す。
  retries: 0,
  // 各テストは実時間で動く WebGL ゲームを操作する。並列数を上げすぎると
  // GPU/CPU の奪い合いでフレーム供給が遅れ、ゲーム進行の待ち合わせが
  // 時間切れになるため、意図的に少数に固定している。
  workers: 2,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : undefined,
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],
  // dev サーバーはルート初回アクセス時にコンパイルが走り待ち時間が読めないため、
  // ストーリーテストは本番ビルドに対して実行する（実際に配信されるものを検証する）。
  webServer: {
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
