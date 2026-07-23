import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";

const assetRoot = path.resolve(
  "ios/App/App/Assets.xcassets"
);

function artwork(size: number, compact: boolean) {
  const markSize = compact ? Math.round(size * 0.46) : Math.round(size * 0.22);
  const titleSize = Math.round(size * 0.055);
  const subtitleSize = Math.round(size * 0.019);

  return `
    <!doctype html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          * { box-sizing: border-box; }
          html, body {
            width: ${size}px;
            height: ${size}px;
            margin: 0;
            overflow: hidden;
          }
          body {
            display: grid;
            place-items: center;
            color: #f8fafc;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            background:
              radial-gradient(circle at 50% 33%, rgba(34, 211, 238, .20), transparent 35%),
              linear-gradient(145deg, #071426 0%, #020617 62%, #06151a 100%);
          }
          .content { display: grid; place-items: center; text-align: center; }
          .mark {
            position: relative;
            width: ${markSize}px;
            height: ${markSize}px;
            border: ${Math.max(8, Math.round(size * 0.012))}px solid #22d3ee;
            border-radius: 34% 10% 34% 10%;
            transform: rotate(45deg);
            box-shadow: 0 0 ${Math.round(size * 0.09)}px rgba(34, 211, 238, .28);
          }
          .mark::before {
            content: "";
            position: absolute;
            inset: 18%;
            border: ${Math.max(5, Math.round(size * 0.007))}px solid #fbbf24;
            border-radius: 50%;
          }
          .copy { display: ${compact ? "none" : "block"}; }
          h1 {
            margin: ${Math.round(size * 0.055)}px 0 0;
            font-size: ${titleSize}px;
            line-height: 1;
            letter-spacing: -.035em;
          }
          p {
            margin: ${Math.round(size * 0.018)}px 0 0;
            color: #a5f3fc;
            font-size: ${subtitleSize}px;
            font-weight: 650;
            letter-spacing: .16em;
            text-transform: uppercase;
          }
        </style>
      </head>
      <body>
        <main class="content">
          <div class="mark" aria-hidden="true"></div>
          <div class="copy">
            <h1>Solartelligence</h1>
            <p>Solar readiness, clarified</p>
          </div>
        </main>
      </body>
    </html>
  `;
}

async function capture(
  page: Page,
  filePath: string,
  size: number,
  compact: boolean
) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(artwork(size, compact), { waitUntil: "load" });
  await page.screenshot({ path: filePath, type: "png" });
}

async function main() {
  const iconDirectory = path.join(assetRoot, "AppIcon.appiconset");
  const splashDirectory = path.join(assetRoot, "Splash.imageset");
  await Promise.all([
    mkdir(iconDirectory, { recursive: true }),
    mkdir(splashDirectory, { recursive: true }),
  ]);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await capture(
      page,
      path.join(iconDirectory, "AppIcon-512@2x.png"),
      1024,
      true
    );

    for (const filename of [
      "splash-2732x2732.png",
      "splash-2732x2732-1.png",
      "splash-2732x2732-2.png",
    ]) {
      await capture(page, path.join(splashDirectory, filename), 2732, false);
    }
  } finally {
    await browser.close();
  }

  console.log("Generated Solartelligence iOS icon and launch assets.");
}

void main();
