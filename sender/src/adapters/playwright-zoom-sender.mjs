const CHAT_BUTTON_PATTERNS = [/chat/i, /\u0447\u0430\u0442/iu];
const MORE_BUTTON_PATTERNS = [/more/i, /more meeting controls/i, /\u043f\u043e\u0434\u0440\u043e\u0431\u043d\u0435\u0435/iu, /\u0435\u0449\u0435/iu];
const CHAT_UNAVAILABLE_PATTERNS = [/chat.*disabled|disabled.*chat|chat.*unavailable|host.*disabled.*chat/i, /\u0447\u0430\u0442.*\u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f/iu, /\u0447\u0430\u0442.*\u043e\u0442\u043a\u043b\u044e\u0447/iu];
const COOKIE_BUTTON_PATTERNS = [/decline cookies/i, /accept cookies/i, /\u043e\u0442\u043a\u043b\u043e\u043d\u0438\u0442\u044c/iu, /\u043f\u0440\u0438\u043d\u044f\u0442\u044c/iu];
const JOIN_FROM_BROWSER_PATTERNS = [/join from browser/i, /\u0432\u043e\u0439\u0442\u0438.*\u0431\u0440\u0430\u0443\u0437\u0435\u0440/iu];
const CONTINUE_WITHOUT_MEDIA_PATTERNS = [/continue without microphone and camera/i, /\u043f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c.*\u043c\u0438\u043a\u0440\u043e\u0444\u043e\u043d/iu];
const JOIN_MEETING_PATTERNS = [/join/i, /join meeting/i, /\u0432\u043e\u0439\u0442\u0438/iu, /\u043f\u0440\u0438\u0441\u043e\u0435\u0434\u0438\u043d/iu];
const MUTE_MICROPHONE_PATTERNS = [/mute my microphone/i, /^mute$/i, /\u0432\u044b\u043a\u043b\u044e\u0447\u0438\u0442\u044c.*\u043c\u0438\u043a\u0440\u043e\u0444\u043e\u043d/iu];
const STOP_VIDEO_PATTERNS = [/stop my video/i, /^stop video$/i, /\u0432\u044b\u043a\u043b\u044e\u0447\u0438\u0442\u044c.*\u0432\u0438\u0434\u0435\u043e/iu, /\u043e\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u044c.*\u0432\u0438\u0434\u0435\u043e/iu];
const DIAGNOSTIC_TEXT_LIMIT = 12000;
const DIAGNOSTIC_BODY_TEXT_LIMIT = 2000;
const DIAGNOSTIC_HTML_LIMIT = 5000;
const CHAT_DIAGNOSTIC_TEXT_LIMIT = 1200;
const CHAT_DIAGNOSTIC_DOM_LIMIT = 2500;
const DEFAULT_BROWSER_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
  "--disable-blink-features=AutomationControlled",
  "--disable-infobars"
];
const ZOOM_RESPONSE_RE = /(?:^|\.)zoom\.us$|zoomcdn\.com$|zmdownload\.zoom\.us$/iu;

async function clickFirst(page, selectors, { timeout = 1500 } = {}) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible({ timeout }).catch(() => false)) {
      await locator.click({ timeout }).catch(() => null);
      return true;
    }
  }
  return false;
}

async function clickButtonByText(page, patterns) {
  for (const pattern of patterns) {
    const button = page.getByRole("button", { name: pattern }).first();
    if (await button.isVisible({ timeout: 1200 }).catch(() => false)) {
      await button.click().catch(() => null);
      await page.waitForTimeout(1200).catch(() => null);
      return true;
    }
  }
  return clickVisibleControlByText(page, patterns);
}

async function clickTextByPattern(page, patterns) {
  for (const pattern of patterns) {
    const text = page.getByText(pattern).first();
    if (await text.isVisible({ timeout: 1200 }).catch(() => false)) {
      await text.click().catch(() => null);
      await page.waitForTimeout(1200).catch(() => null);
      return true;
    }
  }
  return false;
}

async function clickVisibleControlByText(page, patterns) {
  const serialized = patterns.map((pattern) => ({ source: pattern.source, flags: pattern.flags }));
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const clicked = await page.evaluate((items) => {
      const regexes = items.map((item) => new RegExp(item.source, item.flags));
      const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const isVisible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 1 && rect.height > 1;
      };
      const controls = [...document.querySelectorAll("button, a, [role='button']")];
      const target = controls.find((element) => {
        if (!isVisible(element)) return false;
        const label = [
          clean(element.innerText || element.textContent),
          clean(element.getAttribute("aria-label")),
          clean(element.getAttribute("title"))
        ].filter(Boolean).join(" ");
        return regexes.some((regex) => regex.test(label));
      });
      if (!target) return false;
      target.click();
      return true;
    }, serialized).catch(() => false);
    if (clicked) {
      await page.waitForTimeout(1200).catch(() => null);
      return true;
    }
    await page.waitForTimeout(700).catch(() => null);
  }
  return false;
}

async function hasChatInput(page) {
  return page.evaluate(() => {
    const selectors = [
      'textarea[aria-label*="chat" i]',
      'textarea[placeholder*="chat" i]',
      'textarea[aria-placeholder*="chat" i]',
      'input[aria-label*="chat" i]',
      'input[placeholder*="chat" i]',
      '[role="textbox"][aria-label*="chat" i]',
      '[role="textbox"][aria-placeholder*="chat" i]',
      '[role="textbox"][data-placeholder*="chat" i]',
      'div[contenteditable="true"][aria-label*="chat" i]',
      'div[contenteditable="plaintext-only"][aria-label*="chat" i]',
      'div[contenteditable="plaintext-only"][aria-placeholder*="chat" i]',
      'div[contenteditable="plaintext-only"][data-placeholder*="chat" i]',
      'p[contenteditable="true"]',
      'p[contenteditable="plaintext-only"]',
      'div[contenteditable="true"]'
    ];
    return selectors.some((selector) => [...document.querySelectorAll(selector)].some((element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 20 && rect.height > 10;
    }));
  }).catch(() => false);
}

async function hasChatUnavailableNotice(page) {
  const bodyText = await page.locator("body").innerText({ timeout: 1200 }).catch(() => "");
  return CHAT_UNAVAILABLE_PATTERNS.some((pattern) => pattern.test(bodyText));
}

async function clickChatButtonInDom(page) {
  const serialized = CHAT_BUTTON_PATTERNS.map((pattern) => ({ source: pattern.source, flags: pattern.flags }));
  return page.evaluate((items) => {
    const regexes = items.map((item) => new RegExp(item.source, item.flags));
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 1 && rect.height > 1;
    };
    const controls = [...document.querySelectorAll("button, [role='button'], a")].filter(isVisible);
    const target = controls.find((element) => {
      const label = [
        clean(element.innerText || element.textContent),
        clean(element.getAttribute("aria-label")),
        clean(element.getAttribute("title")),
        clean(element.getAttribute("data-tooltip"))
      ].filter(Boolean).join(" ");
      return /open\s+the\s+chat\s+panel/i.test(label) || regexes.some((regex) => regex.test(label));
    });
    if (!target) return false;
    target.scrollIntoView({ block: "center", inline: "center" });
    target.click();
    return true;
  }, serialized).catch(() => false);
}

async function openChatPanel(page) {
  if (await hasChatInput(page)) return true;
  await clickButtonByText(page, CHAT_BUTTON_PATTERNS).catch(() => false);
  await page.waitForTimeout(1500).catch(() => null);
  if (await hasChatInput(page)) return true;
  await clickChatButtonInDom(page).catch(() => false);
  await page.waitForTimeout(1500).catch(() => null);
  if (await hasChatInput(page)) return true;
  await clickFirst(page, [
    'button[aria-label*="open the chat panel" i]',
    'button[aria-label*="chat" i]',
    'button[title*="chat" i]',
    '[role="button"][aria-label*="open the chat panel" i]',
    '[role="button"][aria-label*="chat" i]',
    '[role="button"][title*="chat" i]'
  ]).catch(() => false);
  await page.waitForTimeout(1500).catch(() => null);
  if (await hasChatInput(page)) return true;
  if (await clickButtonByText(page, MORE_BUTTON_PATTERNS).catch(() => false)) {
    await clickButtonByText(page, CHAT_BUTTON_PATTERNS).catch(() => false);
    await page.waitForTimeout(1500).catch(() => null);
    if (await hasChatInput(page)) return true;
  }
  await page.keyboard.press("Alt+KeyH").catch(() => null);
  await page.waitForTimeout(800).catch(() => null);
  return hasChatInput(page);
}

async function fillMeetingName(page, name) {
  const selectors = [
    "#input-for-name",
    'input[name="name"]',
    'input[placeholder*="name" i]',
    'input[aria-label*="name" i]',
    'input[type="text"]:visible'
  ];
  for (const selector of selectors) {
    const input = page.locator(selector).first();
    if (await input.isVisible({ timeout: 1200 }).catch(() => false)) {
      await input.fill(name);
      await page.waitForTimeout(300).catch(() => null);
      const value = await input.inputValue().catch(() => "");
      if (String(value || "").trim()) return true;
    }
  }
  return page.evaluate((participantName) => {
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 20 && rect.height > 10;
    };
    const input = [...document.querySelectorAll('input[type="text"]')].find(isVisible);
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, participantName);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return String(input.value || "").trim().length > 0;
  }, name).catch(() => false);
}

async function ensureMeetingMediaOff(page) {
  let microphoneStopped = false;
  let videoStopped = false;
  const microphonePatterns = MUTE_MICROPHONE_PATTERNS.map((pattern) => ({ source: pattern.source, flags: pattern.flags }));
  const videoPatterns = STOP_VIDEO_PATTERNS.map((pattern) => ({ source: pattern.source, flags: pattern.flags }));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await page.evaluate(({ microphoneItems, videoItems }) => {
      const microphoneRegexes = microphoneItems.map((item) => new RegExp(item.source, item.flags));
      const videoRegexes = videoItems.map((item) => new RegExp(item.source, item.flags));
      const clean = (value) => String(value || "").replace(/\s+/gu, " ").trim();
      const isVisible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 1 && rect.height > 1;
      };
      const controls = [...document.querySelectorAll("button, [role='button']")].filter(isVisible);
      const labelFor = (element) => [
        clean(element.getAttribute("aria-label")),
        clean(element.getAttribute("title")),
        clean(element.innerText || element.textContent)
      ].filter(Boolean).join(" ");
      const microphone = controls.find((element) => microphoneRegexes.some((regex) => regex.test(labelFor(element))));
      const video = controls.find((element) => videoRegexes.some((regex) => regex.test(labelFor(element))));
      microphone?.click();
      video?.click();
      return { microphoneStopped: Boolean(microphone), videoStopped: Boolean(video) };
    }, { microphoneItems: microphonePatterns, videoItems: videoPatterns }).catch(() => ({ microphoneStopped: false, videoStopped: false }));
    microphoneStopped ||= result.microphoneStopped;
    videoStopped ||= result.videoStopped;
    if (microphoneStopped && videoStopped) break;
    await page.waitForTimeout(500).catch(() => null);
  }
  return { microphoneStopped, videoStopped };
}

async function sendChatText(page, text) {
  if (!await openChatPanel(page)) return { sent: false, ack: false };
  const selectors = [
    'textarea[aria-label*="chat" i]',
    'textarea[placeholder*="chat" i]',
    'textarea[aria-placeholder*="chat" i]',
    '[role="textbox"][aria-label*="chat" i]',
    '[role="textbox"][aria-placeholder*="chat" i]',
    '[role="textbox"][data-placeholder*="chat" i]',
    'div[contenteditable="true"][aria-label*="chat" i]',
    'div[contenteditable="plaintext-only"][aria-label*="chat" i]',
    'div[contenteditable="plaintext-only"][aria-placeholder*="chat" i]',
    'div[contenteditable="plaintext-only"][data-placeholder*="chat" i]',
    'p[contenteditable="true"]',
    'p[contenteditable="plaintext-only"]',
    'div[contenteditable="true"]'
  ];
  for (const selector of selectors) {
    const input = page.locator(selector).last();
    if (await input.isVisible({ timeout: 1500 }).catch(() => false)) {
      await input.click().catch(() => null);
      await page.keyboard.insertText(String(text || ""));
      await page.keyboard.press("Enter");
      await page.waitForTimeout(700);
      return { sent: true, ack: true };
    }
  }
  return { sent: false, ack: false };
}

function sanitizePageUrl(value) {
  try {
    const url = new URL(String(value || ""));
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return String(value || "").replace(/[?#].*$/u, "");
  }
}

function sanitizeDiagnosticText(value) {
  return String(value || "")
    .replace(/([?&](?:pwd|zak|token|secret|code|signature|passcode)=)[^&\s"'<>]+/giu, "$1[redacted]")
    .replace(/(x-nafanya-zoom-secret["':\s]+)[^"'\s<>]+/giu, "$1[redacted]")
    .replace(/(authorization["':\s]+bearer\s+)[^"'\s<>]+/giu, "$1[redacted]")
    .replace(/https?:\/\/[^\s"'<>]+/giu, (match) => sanitizePageUrl(match));
}

function buildZoomWebClientUrl(meetingUrl) {
  try {
    const url = new URL(meetingUrl);
    const match = url.pathname.match(/^\/j\/(\d+)/u);
    if (match) {
      url.pathname = `/wc/join/${match[1]}`;
    }
    return url.toString();
  } catch {
    return meetingUrl;
  }
}

function safeEventText(value) {
  return sanitizeDiagnosticText(String(value || "")).slice(0, 1000);
}

function normalizeDiagnosticChatText(value) {
  return sanitizeDiagnosticText(String(value || "").replace(/\s+/gu, " ").trim());
}

function buildChatMessageFingerprint(message = {}) {
  const basis = [
    normalizeDiagnosticChatText(message.displayName || ""),
    normalizeDiagnosticChatText(message.text || ""),
    normalizeDiagnosticChatText(message.timestamp || ""),
    normalizeDiagnosticChatText(message.domPath || "")
  ].join("|");
  let hash = 2166136261;
  for (let index = 0; index < basis.length; index += 1) {
    hash ^= basis.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `chat-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function isZoomRelatedUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ZOOM_RESPONSE_RE.test(url.hostname);
  } catch {
    return false;
  }
}

async function collectVisibleControls(page) {
  return page.evaluate(() => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 1 && rect.height > 1;
    };
    const buttons = [...document.querySelectorAll("button, [role='button'], a")].filter(visible).slice(0, 80).map((element) => ({
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role") || "",
      text: clean(element.innerText || element.textContent),
      ariaLabel: clean(element.getAttribute("aria-label")),
      title: clean(element.getAttribute("title")),
      type: clean(element.getAttribute("type"))
    }));
    const inputs = [...document.querySelectorAll("input, textarea, [contenteditable='true']")].filter(visible).slice(0, 60).map((element) => ({
      tag: element.tagName.toLowerCase(),
      type: clean(element.getAttribute("type")),
      name: clean(element.getAttribute("name")),
      placeholder: clean(element.getAttribute("placeholder")),
      ariaLabel: clean(element.getAttribute("aria-label")),
      valuePresent: Boolean(element.value)
    }));
    return { buttons, inputs };
  }).catch(() => ({ buttons: [], inputs: [] }));
}

async function collectPageDiagnostics(page) {
  return page.evaluate(() => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const scriptDomains = [...document.scripts].map((script) => {
      try {
        return script.src ? new URL(script.src).hostname : "";
      } catch {
        return "";
      }
    }).filter(Boolean);
    const iframes = [...document.querySelectorAll("iframe")].slice(0, 40).map((frame) => ({
      src: frame.src || "",
      title: frame.title || "",
      name: frame.name || "",
      ariaLabel: frame.getAttribute("aria-label") || ""
    }));
    return {
      readyState: document.readyState,
      bodyText: clean(document.body?.innerText || ""),
      bodyHtml: String(document.body?.innerHTML || ""),
      iframes,
      scriptDomains: [...new Set(scriptDomains)].slice(0, 80),
      userAgent: navigator.userAgent,
      webdriver: navigator.webdriver
    };
  }).catch((error) => ({
    readyState: "",
    bodyText: "",
    bodyHtml: "",
    iframes: [],
    scriptDomains: [],
    evaluateError: error?.message || String(error)
  }));
}

async function collectVisibleChatMessages(page) {
  return page.evaluate(({ textLimit, domLimit }) => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 10 && rect.height > 8;
    };
    const parseGroupHeader = (value) => {
      const text = clean(value);
      const match = text.match(/^(.+?)\s+to\s+Everyone(?:,)?(?:\s+(\d{1,2}:\d{2}(?:\s?[AP]M)?))?/i);
      if (!match) return { authorName: "", timestamp: "" };
      return { authorName: clean(match[1]), timestamp: clean(match[2] || "") };
    };
    const isSupportedAtomicChatText = (value) => /^(?:111|222|333|444|\u0438\u0433\u0440\u0430\s+\d{1,3})$/iu.test(clean(value));
    const isTimestampText = (value) => /^(?:\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?|am|pm|\u0441\u0435\u0433\u043e\u0434\u043d\u044f|today)$/iu.test(clean(value));
    const isTextBubbleNode = (element) => {
      const className = clean(element?.className || "");
      return /(?:new-chat-message__(?:text-box|text-content)|_rtfEditor|message__text|message-text|text-content)/iu.test(className);
    };
    const isLikelySenderName = (value, messageText = "") => {
      const name = clean(value);
      if (!name || name.length > 80) return false;
      if (name === clean(messageText)) return false;
      if (isSupportedAtomicChatText(name) || isTimestampText(name)) return false;
      if (/\bto\s+everyone\b|^\d+$|chat|message|\u0447\u0430\u0442|\u0441\u043e\u043e\u0431\u0449/iu.test(name)) return false;
      return true;
    };
    const senderNameFrom = (scope, messageText = "") => {
      if (!scope?.querySelectorAll) return "";
      const selectors = [
        "[data-sender]",
        "[data-display-name]",
        "[data-name]",
        '[class*="sender" i]',
        '[class*="author" i]',
        '[class*="display-name" i]',
        '[class*="user-name" i]',
        '[class*="username" i]',
        '[class*="name" i]',
        '[aria-label*="sender" i]'
      ];
      for (const candidate of scope.querySelectorAll(selectors.join(","))) {
        if (!visible(candidate)) continue;
        const values = [
          candidate.getAttribute("data-sender"),
          candidate.getAttribute("data-display-name"),
          candidate.getAttribute("data-name"),
          candidate.getAttribute("aria-label"),
          candidate.textContent
        ];
        for (const value of values) {
          const name = clean(value);
          if (isLikelySenderName(name, messageText)) return name;
        }
      }
      return "";
    };
    const groupContainerFor = (element) => {
      const elementText = clean(element.innerText || element.textContent);
      let best = null;
      let bestScore = -1;
      for (let node = element; node && node !== document.body; node = node.parentElement) {
        if (!visible(node)) continue;
        const text = clean(node.innerText || node.textContent);
        if (!text || text.length > textLimit) continue;
        const className = clean(node.className || "");
        const id = clean(node.getAttribute("id") || "");
        const ariaLabel = clean(node.getAttribute("aria-label") || "");
        const role = clean(node.getAttribute("role") || "");
        const header = parseGroupHeader(ariaLabel || text);
        const senderName = senderNameFrom(node, elementText);
        const looksLikeMessageRoot = (
          id.startsWith("chat-message-content-") ||
          /\bnew-chat-message\b(?!__)|chat-message|message-item|chat-item/iu.test(className) ||
          /\bto\s+Everyone\b/iu.test(ariaLabel) ||
          role === "listitem" ||
          role === "row"
        );
        if (!looksLikeMessageRoot && !senderName && !header.authorName) continue;
        const score =
          (looksLikeMessageRoot ? 4 : 0) +
          (senderName ? 8 : 0) +
          (header.authorName ? 8 : 0) +
          (id || ariaLabel ? 2 : 0) -
          (isTextBubbleNode(node) ? 8 : 0);
        if (score > bestScore) {
          best = node;
          bestScore = score;
        }
      }
      return best || element.closest([
        '[id^="chat-message-content-"]',
        '[aria-label*="to Everyone" i]',
        '[class*="message-item" i]',
        '[class*="chat-item" i]',
        '[role="listitem"]'
      ].join(", ")) || element;
    };
    const stableIdFor = (element, fallbackIndex) => clean(
      element.getAttribute("id") ||
      element.getAttribute("data-message-id") ||
      element.getAttribute("data-testid") ||
      element.getAttribute("aria-label") ||
      `group-${fallbackIndex}`
    );
    const atomicCodeNodesFor = (groupElement) => {
      const descendants = [...groupElement.querySelectorAll("*")].filter(visible);
      const nodes = descendants.length ? descendants : [groupElement];
      return nodes
        .map((node, childIndex) => ({
          node,
          childIndex,
          text: clean(node.innerText || node.textContent)
        }))
        .filter((item) => isSupportedAtomicChatText(item.text));
    };
    const selectors = [
      '[class*="chat-message" i]',
      '[class*="chat_item" i]',
      '[class*="chat-item" i]',
      '[class*="message-item" i]',
      '[data-testid*="chat" i]',
      '[aria-label*="chat" i] [role="listitem"]',
      '[role="log"] [role="listitem"]',
      '[role="list"] [role="listitem"]'
    ];
    const nodes = [];
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (!visible(element)) continue;
        const text = clean(element.innerText || element.textContent);
        if (!text || text.length > textLimit) continue;
        nodes.push(element);
      }
    }
    const uniqueNodes = [...new Set(nodes)].slice(-40);
    const records = [];
    const seenChildRecords = new Set();
    uniqueNodes.forEach((element, index) => {
      const text = clean(element.innerText || element.textContent).slice(0, textLimit);
      const lines = text.split(/\n+/u).map(clean).filter(Boolean);
      const timestampPattern = /(?:\d{1,2}:\d{2}(?::\d{2})?|am|pm|сегодня|today)/iu;
      const timestamp = lines.find((line) => timestampPattern.test(line)) || "";
      const groupElement = groupContainerFor(element);
      const groupText = clean(groupElement.innerText || groupElement.textContent).slice(0, textLimit);
      const groupAriaLabel = clean(groupElement.getAttribute("aria-label") || "");
      const groupHeader = parseGroupHeader(groupAriaLabel || groupText);
      const groupStableId = stableIdFor(groupElement, index);
      const groupSenderName = senderNameFrom(groupElement, text);
      const displayName = clean(
        element.getAttribute("data-sender") ||
        element.getAttribute("data-display-name") ||
        groupHeader.authorName ||
        groupSenderName ||
        senderNameFrom(element, text) ||
        (timestamp && lines[0] === timestamp ? lines[1] : lines[0]) ||
        ""
      );
      records.push({
        displayName,
        text,
        timestamp,
        domPath: `${element.tagName.toLowerCase()}:${index}`,
        rawDom: String(element.outerHTML || "").slice(0, domLimit),
        groupAuthorName: groupHeader.authorName,
        groupTimestamp: groupHeader.timestamp || timestamp,
        groupText,
        groupStableId,
        childIndex: ""
      });
      for (const child of atomicCodeNodesFor(groupElement)) {
        const rawDom = String(child.node.outerHTML || "").slice(0, domLimit);
        const childKey = [groupStableId, child.childIndex, child.text, rawDom].join("|");
        if (seenChildRecords.has(childKey)) continue;
        seenChildRecords.add(childKey);
        const childAuthorName = groupHeader.authorName || senderNameFrom(groupElement, child.text) || displayName;
        records.push({
          displayName: childAuthorName,
          text: child.text,
          timestamp: groupHeader.timestamp || timestamp,
          domPath: `${child.node.tagName.toLowerCase()}:${index}:${child.childIndex}`,
          rawDom,
          groupAuthorName: groupHeader.authorName || childAuthorName,
          groupTimestamp: groupHeader.timestamp || timestamp,
          groupText,
          groupStableId,
          childIndex: String(child.childIndex)
        });
      }
    });
    const identityRecords = [...document.querySelectorAll('[data-id^="1-{"]')]
      .filter(visible)
      .map((item, index) => {
        const messageBox = item.querySelector('[id^="1-{"]');
        const messageRow = item.querySelector('[id^="chat-message-content-"][aria-label]');
        const sender = item.querySelector('[class*="sender" i][data-name], [class*="sender" i]');
        const receiver = item.querySelector('[class*="receiver" i][data-name], [class*="receiver" i]');
        const time = item.querySelector('[class*="time-stamp" i], time, [datetime]');
        const text = clean(messageBox?.innerText || messageRow?.innerText || item.innerText).slice(0, textLimit);
        const sourceMessageId = clean(item.getAttribute("data-id") || messageBox?.getAttribute("id"));
        return {
          displayName: clean(sender?.getAttribute("data-name") || sender?.textContent),
          text,
          timestamp: clean(time?.getAttribute("datetime") || time?.getAttribute("title") || time?.textContent),
          domPath: `zoom-message:${index}`,
          rawDom: String(item.outerHTML || "").slice(0, domLimit),
          groupAuthorName: clean(sender?.getAttribute("data-name") || sender?.textContent),
          groupTimestamp: clean(time?.getAttribute("datetime") || time?.getAttribute("title") || time?.textContent),
          groupText: clean(item.innerText || item.textContent).slice(0, textLimit),
          groupStableId: sourceMessageId,
          childIndex: "",
          recordKind: "zoom-message-identity",
          sourceMessageId,
          itemId: clean(item.getAttribute("id")),
          itemDataId: clean(item.getAttribute("data-id")),
          messageRowId: clean(messageRow?.getAttribute("id")),
          messageBoxId: clean(messageBox?.getAttribute("id")),
          ariaLabel: clean(messageRow?.getAttribute("aria-label") || item.getAttribute("aria-label")),
          role: clean(messageRow?.getAttribute("role") || item.getAttribute("role")),
          title: clean(messageRow?.getAttribute("title") || item.getAttribute("title")),
          datetime: clean(time?.getAttribute("datetime")),
          recipientName: clean(receiver?.getAttribute("data-name") || receiver?.textContent)
        };
      })
      .filter((record) => record.text && record.sourceMessageId);
    return [...records.slice(-80), ...identityRecords];
  }, { textLimit: CHAT_DIAGNOSTIC_TEXT_LIMIT, domLimit: CHAT_DIAGNOSTIC_DOM_LIMIT }).catch(() => []);
}

async function makeDiagnosticsDir(diagnosticsDir) {
  if (!diagnosticsDir) return null;
  const [{ mkdir, writeFile }, path] = await Promise.all([import("node:fs/promises"), import("node:path")]);
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const dir = path.join(diagnosticsDir, stamp);
  await mkdir(dir, { recursive: true });
  return { dir, writeFile, path };
}

async function saveDiagnosticsSnapshot(page, presence, diagnosticsRun, label, details = {}, logger = console) {
  if (!diagnosticsRun || !page) return null;
  const safeLabel = String(label || "snapshot").replace(/[^a-z0-9_-]+/giu, "-").slice(0, 60);
  const controls = await collectVisibleControls(page);
  const visibleText = await page.locator("body").innerText({ timeout: 2000 }).catch(() => "");
  const pageData = await collectPageDiagnostics(page);
  const data = {
    capturedAt: new Date().toISOString(),
    label: safeLabel,
    url: sanitizePageUrl(page.url()),
    title: await page.title().catch(() => ""),
    readyState: pageData.readyState,
    visibleText: String(visibleText || "").slice(0, DIAGNOSTIC_TEXT_LIMIT),
    bodyText: sanitizeDiagnosticText(pageData.bodyText).slice(0, DIAGNOSTIC_BODY_TEXT_LIMIT),
    bodyHtml: sanitizeDiagnosticText(pageData.bodyHtml).slice(0, DIAGNOSTIC_HTML_LIMIT),
    iframes: pageData.iframes.map((frame) => ({
      ...frame,
      src: sanitizePageUrl(frame.src)
    })),
    scriptDomains: pageData.scriptDomains,
    userAgent: safeEventText(pageData.userAgent),
    webdriver: pageData.webdriver,
    buttons: controls.buttons,
    inputs: controls.inputs,
    presence,
    details
  };
  await diagnosticsRun.writeFile(diagnosticsRun.path.join(diagnosticsRun.dir, `${safeLabel}.json`), JSON.stringify(data, null, 2), "utf8");
  await page.screenshot({ path: diagnosticsRun.path.join(diagnosticsRun.dir, `${safeLabel}.png`), fullPage: true }).catch(() => null);
  logger.info?.(`Zoom Sender diagnostics snapshot saved: ${safeLabel}`);
  return diagnosticsRun.dir;
}

async function writeDiagnosticsSummary(diagnosticsRun, events, launchInfo) {
  if (!diagnosticsRun) return null;
  const data = {
    capturedAt: new Date().toISOString(),
    launchInfo,
    console: events.console.slice(-120),
    pageErrors: events.pageErrors.slice(-40),
    requestFailed: events.requestFailed.slice(-80),
    badResponses: events.badResponses.slice(-120)
  };
  await diagnosticsRun.writeFile(diagnosticsRun.path.join(diagnosticsRun.dir, "browser-events.json"), JSON.stringify(data, null, 2), "utf8");
  return diagnosticsRun.dir;
}

async function getSystemDiagnostics(config, browser, launchArgs) {
  const fs = await import("node:fs/promises");
  const devShm = await fs.stat("/dev/shm").then((stat) => ({ exists: true, size: stat.size })).catch(() => ({ exists: false }));
  return {
    headless: config.headless,
    launchArgs,
    userDataDir: config.userDataDir || "/app/profile",
    diagnosticsDir: Boolean(config.diagnosticsDir),
    display: Boolean(process.env.DISPLAY),
    nodeVersion: process.version,
    playwrightBrowserVersion: browser?.browser?.()?.version?.() || "",
    devShm
  };
}

export class PlaywrightZoomSender {
  constructor(config, { logger = console } = {}) {
    this.config = config;
    this.logger = logger;
    this.browser = null;
    this.page = null;
    this.presence = {
      zoomPageOpen: false,
      zoomJoined: false,
      waitingRoom: false,
      chatOpen: false,
      chatUnavailable: false,
      chatReason: null
    };
    this.lastDiagnosticsDir = null;
    this.diagnosticsRun = null;
    this.chatDiagnosticFingerprints = new Set();
    this.diagnosticsEvents = {
      console: [],
      pageErrors: [],
      requestFailed: [],
      badResponses: []
    };
  }

  attachPageDiagnostics(page) {
    page.on("console", (message) => {
      const type = message.type();
      if (!["error", "warning"].includes(type)) return;
      this.diagnosticsEvents.console.push({
        type,
        text: safeEventText(message.text()),
        location: message.location()
      });
    });
    page.on("pageerror", (error) => {
      this.diagnosticsEvents.pageErrors.push({
        message: safeEventText(error?.message || String(error)),
        stack: safeEventText(error?.stack || "")
      });
    });
    page.on("requestfailed", (request) => {
      if (!isZoomRelatedUrl(request.url())) return;
      this.diagnosticsEvents.requestFailed.push({
        url: sanitizePageUrl(request.url()),
        method: request.method(),
        failure: safeEventText(request.failure()?.errorText || "")
      });
    });
    page.on("response", (response) => {
      if (response.status() < 400 || !isZoomRelatedUrl(response.url())) return;
      this.diagnosticsEvents.badResponses.push({
        url: sanitizePageUrl(response.url()),
        status: response.status(),
        statusText: safeEventText(response.statusText())
      });
    });
  }

  async start() {
    const { chromium } = await import("playwright");
    const launchArgs = [...DEFAULT_BROWSER_ARGS, ...(this.config.browserArgs || [])];
    const launchOptions = {
      headless: this.config.headless,
      viewport: { width: 1280, height: 720 },
      ignoreDefaultArgs: ["--enable-automation"],
      args: launchArgs
    };
    const userDataDir = this.config.userDataDir || "/app/profile";
    const diagnosticsRun = await makeDiagnosticsDir(this.config.diagnosticsDir);
    this.diagnosticsRun = diagnosticsRun;
    this.browser = await chromium.launchPersistentContext(userDataDir, launchOptions);
    this.page = await this.browser.newPage();
    this.attachPageDiagnostics(this.page);
    await this.page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    await this.page.goto(buildZoomWebClientUrl(this.config.zoomMeetingUrl), { waitUntil: "domcontentloaded", timeout: 60000 });
    this.presence.zoomPageOpen = true;
    await saveDiagnosticsSnapshot(this.page, this.presence, diagnosticsRun, "01-after-goto", {
      launchInfo: await getSystemDiagnostics(this.config, this.browser, launchArgs)
    }, this.logger).catch((error) => this.logger.warn?.(`Zoom Sender diagnostics failed: ${error?.message || String(error)}`));
    await clickButtonByText(this.page, COOKIE_BUTTON_PATTERNS).catch(() => false);
    if (await clickButtonByText(this.page, JOIN_FROM_BROWSER_PATTERNS).catch(() => false)) {
      await this.page.waitForTimeout(2500);
    }
    await saveDiagnosticsSnapshot(this.page, this.presence, diagnosticsRun, "02-after-join-from-browser", {}, this.logger).catch((error) => this.logger.warn?.(`Zoom Sender diagnostics failed: ${error?.message || String(error)}`));
    await clickTextByPattern(this.page, CONTINUE_WITHOUT_MEDIA_PATTERNS).catch(() => false);
    await saveDiagnosticsSnapshot(this.page, this.presence, diagnosticsRun, "03-after-continue-without-media", {}, this.logger).catch((error) => this.logger.warn?.(`Zoom Sender diagnostics failed: ${error?.message || String(error)}`));
    const nameFilled = await fillMeetingName(this.page, this.config.participantName).catch(() => false);
    await saveDiagnosticsSnapshot(this.page, this.presence, diagnosticsRun, "04-after-fill-name", { nameFilled }, this.logger).catch((error) => this.logger.warn?.(`Zoom Sender diagnostics failed: ${error?.message || String(error)}`));
    if (nameFilled) {
      await clickButtonByText(this.page, JOIN_MEETING_PATTERNS).catch(() => false);
    } else {
      this.logger.warn?.("Zoom Sender could not confirm participant name field before Join.");
    }
    await clickTextByPattern(this.page, CONTINUE_WITHOUT_MEDIA_PATTERNS).catch(() => false);
    const nameRefilled = await fillMeetingName(this.page, this.config.participantName).catch(() => nameFilled);
    if (nameRefilled) {
      await clickButtonByText(this.page, JOIN_MEETING_PATTERNS).catch(() => false);
    }
    await this.page.waitForTimeout(3000);
    const mediaOff = await ensureMeetingMediaOff(this.page);
    await openChatPanel(this.page).catch(() => false);
    await ensureMeetingMediaOff(this.page);
    this.presence = await this.getPresence();
    this.lastDiagnosticsDir = await saveDiagnosticsSnapshot(this.page, this.presence, diagnosticsRun, "04-after-final-join", { mediaOff }, this.logger).catch((error) => {
      this.logger.warn?.(`Zoom Sender diagnostics failed: ${error?.message || String(error)}`);
      return null;
    });
    await writeDiagnosticsSummary(diagnosticsRun, this.diagnosticsEvents, await getSystemDiagnostics(this.config, this.browser, launchArgs)).catch((error) => {
      this.logger.warn?.(`Zoom Sender diagnostics summary failed: ${error?.message || String(error)}`);
    });
    if (diagnosticsRun) {
      this.lastDiagnosticsDir = diagnosticsRun.dir;
      this.logger.info?.(`Zoom Sender diagnostics saved to ${diagnosticsRun.dir}`);
    }
    if (this.config.chatReadonlyDiagnostics) {
      await this.observeChatDiagnostics().catch((error) => this.logger.warn?.(`Zoom Sender chat diagnostics failed: ${error?.message || String(error)}`));
      this.logger.info?.("Zoom Sender read-only chat diagnostics enabled.");
    }
    this.logger.info?.("Zoom Sender browser adapter started.");
    return this.presence;
  }

  async getPresence() {
    if (!this.page) return { ...this.presence };
    const chatOpen = await hasChatInput(this.page);
    const bodyText = await this.page.locator("body").innerText({ timeout: 1500 }).catch(() => "");
    const waitingRoom = /waiting room|host.*let you in|\u043e\u0436\u0438\u0434\u0430/iu.test(bodyText);
    const zoomJoined = chatOpen || /leave|mute|unmute|participants|chat|\u0447\u0430\u0442|\u043c\u0438\u043a\u0440\u043e\u0444\u043e\u043d/iu.test(bodyText);
    const chatUnavailable = !chatOpen && await hasChatUnavailableNotice(this.page);
    this.presence = {
      zoomPageOpen: !this.page.isClosed(),
      zoomJoined,
      waitingRoom,
      chatOpen,
      chatUnavailable,
      chatReason: chatOpen ? "input_found" : chatUnavailable ? "unavailable" : "input_not_found"
    };
    return { ...this.presence };
  }

  async sendMessage(text) {
    if (!this.page) return { sent: false, ack: false };
    const result = await sendChatText(this.page, text);
    this.presence = await this.getPresence();
    return result;
  }

  async observeChatDiagnostics() {
    if (!this.config.chatReadonlyDiagnostics || !this.page || !this.diagnosticsRun) {
      return { enabled: Boolean(this.config.chatReadonlyDiagnostics), newMessages: 0, messages: [] };
    }
    if (!await hasChatInput(this.page)) {
      await openChatPanel(this.page).catch(() => false);
    }
    const messages = await collectVisibleChatMessages(this.page);
    const now = new Date().toISOString();
    const fresh = [];
    for (const message of messages) {
      const safeMessage = {
        observedAt: now,
        displayName: normalizeDiagnosticChatText(message.displayName).slice(0, 160),
        text: normalizeDiagnosticChatText(message.text).slice(0, CHAT_DIAGNOSTIC_TEXT_LIMIT),
        timestamp: normalizeDiagnosticChatText(message.timestamp).slice(0, 80),
        domPath: normalizeDiagnosticChatText(message.domPath).slice(0, 120),
        rawDom: sanitizeDiagnosticText(message.rawDom).slice(0, CHAT_DIAGNOSTIC_DOM_LIMIT),
        groupAuthorName: normalizeDiagnosticChatText(message.groupAuthorName).slice(0, 160),
        groupTimestamp: normalizeDiagnosticChatText(message.groupTimestamp).slice(0, 80),
        groupText: normalizeDiagnosticChatText(message.groupText).slice(0, CHAT_DIAGNOSTIC_TEXT_LIMIT),
        groupStableId: normalizeDiagnosticChatText(message.groupStableId).slice(0, 240),
        childIndex: normalizeDiagnosticChatText(message.childIndex).slice(0, 40),
        recordKind: normalizeDiagnosticChatText(message.recordKind).slice(0, 80),
        sourceMessageId: normalizeDiagnosticChatText(message.sourceMessageId).slice(0, 240),
        itemId: normalizeDiagnosticChatText(message.itemId).slice(0, 240),
        itemDataId: normalizeDiagnosticChatText(message.itemDataId).slice(0, 240),
        messageRowId: normalizeDiagnosticChatText(message.messageRowId).slice(0, 240),
        messageBoxId: normalizeDiagnosticChatText(message.messageBoxId).slice(0, 240),
        ariaLabel: normalizeDiagnosticChatText(message.ariaLabel).slice(0, 500),
        role: normalizeDiagnosticChatText(message.role).slice(0, 80),
        title: normalizeDiagnosticChatText(message.title).slice(0, 240),
        datetime: normalizeDiagnosticChatText(message.datetime).slice(0, 120),
        recipientName: normalizeDiagnosticChatText(message.recipientName).slice(0, 160)
      };
      if (!safeMessage.text) continue;
      const fingerprint = buildChatMessageFingerprint(safeMessage);
      if (this.chatDiagnosticFingerprints.has(fingerprint)) continue;
      this.chatDiagnosticFingerprints.add(fingerprint);
      fresh.push({ ...safeMessage, fingerprint });
    }
    if (fresh.length) {
      const file = this.diagnosticsRun.path.join(this.diagnosticsRun.dir, "chat-readonly-diagnostics.jsonl");
      const lines = fresh.map((message) => JSON.stringify(message)).join("\n") + "\n";
      const fs = await import("node:fs/promises");
      await fs.appendFile(file, lines, "utf8");
      this.logger.info?.(`Zoom Sender read-only chat diagnostics captured ${fresh.length} new message(s).`);
    }
    return { enabled: true, newMessages: fresh.length, totalSeen: this.chatDiagnosticFingerprints.size, messages: fresh };
  }

  async stop() {
    await this.browser?.close().catch(() => null);
  }
}

export { DEFAULT_BROWSER_ARGS, buildChatMessageFingerprint, buildZoomWebClientUrl, collectVisibleChatMessages, collectVisibleControls, ensureMeetingMediaOff, hasChatInput, openChatPanel, sanitizeDiagnosticText, sanitizePageUrl, saveDiagnosticsSnapshot };
