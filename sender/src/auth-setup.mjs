import { loadConfig } from "./config.mjs";
import { DEFAULT_BROWSER_ARGS, sanitizePageUrl } from "./adapters/playwright-zoom-sender.mjs";

const SIGN_IN_URL = "https://app.zoom.us/signin";
const PROFILE_URL = "https://app.zoom.us/profile";
const AUTH_WAIT_MS = 90000;

function readSecret(name) {
  return String(process.env[name] || "").trim();
}

function readBool(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === null || value === "") return fallback;
  return /^(1|true|yes|on)$/iu.test(String(value).trim());
}

function readPositiveInt(name, fallback, { min = 1000, max = 900000 } = {}) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

async function clickVisibleButton(page, patterns) {
  for (const pattern of patterns) {
    const button = page.getByRole("button", { name: pattern }).first();
    if (await button.isVisible({ timeout: 2000 }).catch(() => false)) {
      await button.click().catch(() => null);
      return true;
    }
  }
  return false;
}

async function fillFirstVisible(page, selectors, value) {
  for (const selector of selectors) {
    const input = page.locator(selector).first();
    if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
      await input.fill(value);
      return true;
    }
  }
  return false;
}

async function hasFirstVisible(page, selectors) {
  for (const selector of selectors) {
    const input = page.locator(selector).first();
    if (await input.isVisible({ timeout: 1000 }).catch(() => false)) {
      return true;
    }
  }
  return false;
}

async function detectAuthBlocker(page) {
  const text = await page.locator("body").innerText({ timeout: 2000 }).catch(() => "");
  if (/captcha|verification code|two-factor|2fa|verify your identity|check your email|код подтверждения|подтвержд/iu.test(text)) {
    return "manual_verification_required";
  }
  return null;
}

async function isSignedIn(page) {
  const url = sanitizePageUrl(page.url());
  const title = await page.title().catch(() => "");
  const body = await page.locator("body").innerText({ timeout: 2000 }).catch(() => "");
  if (/\/signin|\/login/iu.test(url)) return false;
  return /profile|account|meetings|settings|sign out|выйти/iu.test(`${title}\n${body}`);
}

async function confirmPersistentSignIn(page) {
  await page.goto(PROFILE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  if (!await isSignedIn(page)) return false;
  await page.waitForTimeout(5000);
  return isSignedIn(page);
}

async function finishAuthSetup(page) {
  if (!await confirmPersistentSignIn(page)) return false;
  console.log("Zoom auth profile setup completed.");
  return true;
}

async function waitUntilSignedIn(page, deadline, { waitForManual }) {
  let manualNoticeLogged = false;
  while (Date.now() < deadline) {
    const blocker = await detectAuthBlocker(page);
    if (blocker) {
      if (!waitForManual) throw new Error(blocker);
      if (!manualNoticeLogged) {
        console.log("Zoom auth setup is waiting for manual verification.");
        manualNoticeLogged = true;
      }
    }
    if (await isSignedIn(page)) {
      return true;
    }
    await page.waitForTimeout(2000);
  }
  return false;
}

async function run() {
  const email = readSecret("ZOOM_AUTH_EMAIL");
  const password = readSecret("ZOOM_AUTH_PASSWORD");
  const waitForManual = readBool("ZOOM_AUTH_WAIT_FOR_MANUAL", false);
  const authViewEnabled = readBool("ZOOM_AUTH_VIEW_ENABLED", false);
  const authWaitMs = readPositiveInt("ZOOM_AUTH_WAIT_MS", AUTH_WAIT_MS);
  if (!email || !password) {
    throw new Error("Missing Zoom auth credentials: set ZOOM_AUTH_EMAIL and ZOOM_AUTH_PASSWORD in the server .env.");
  }

  const config = loadConfig();
  const { chromium } = await import("playwright");
  const browser = await chromium.launchPersistentContext(config.userDataDir || "/app/profile", {
    headless: authViewEnabled ? false : config.headless,
    viewport: { width: 1280, height: 720 },
    ignoreDefaultArgs: ["--enable-automation"],
    args: [...DEFAULT_BROWSER_ARGS, ...(config.browserArgs || [])]
  });
  const page = await browser.newPage();
  try {
    await page.goto(SIGN_IN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await fillFirstVisible(page, [
      'input[name="account"]',
      'input[type="email"]',
      'input[aria-label*="email" i]',
      'input[placeholder*="email" i]',
      'input[type="text"]'
    ], email);
    await clickVisibleButton(page, [/next/i, /continue/i, /\u0434\u0430\u043b\u0435\u0435/iu]);
    await page.waitForTimeout(1500);
    const blockerBeforePassword = await detectAuthBlocker(page);
    if (blockerBeforePassword && !waitForManual) throw new Error(blockerBeforePassword);
    const passwordSelectors = [
      'input[type="password"]',
      'input[name="password"]',
      'input[aria-label*="password" i]'
    ];
    if (!(await hasFirstVisible(page, passwordSelectors)) && waitForManual) {
      console.log("Zoom auth setup is waiting for manual verification.");
      const passwordDeadline = Date.now() + authWaitMs;
      while (Date.now() < passwordDeadline && !(await hasFirstVisible(page, passwordSelectors))) {
        if (await isSignedIn(page)) {
          if (await finishAuthSetup(page)) return;
        }
        await page.waitForTimeout(2000);
      }
    }
    const passwordFilled = await fillFirstVisible(page, passwordSelectors, password);
    if (!passwordFilled) {
      throw new Error("Zoom password field was not available. Manual verification may be required.");
    }
    await clickVisibleButton(page, [/sign in/i, /log in/i, /\u0432\u043e\u0439\u0442\u0438/iu]);
    const deadline = Date.now() + authWaitMs;
    if (await waitUntilSignedIn(page, deadline, { waitForManual }) && await finishAuthSetup(page)) return;
    throw new Error("Zoom auth did not complete before timeout.");
  } finally {
    await browser.close().catch(() => null);
  }
}

run().catch((error) => {
  console.error(`Zoom auth profile setup failed: ${error?.message || String(error)}`);
  process.exit(1);
});
