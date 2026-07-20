const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const srcDir = path.join(root, "src");
const out = path.join(root, "www");

const files = [
  "index.html",
  "styles.css",
  "app.js",
  "sw.js",
  "manifest.webmanifest",
  "customer.html",
];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const file of files) {
  fs.copyFileSync(path.join(srcDir, file), path.join(out, file));
}

fs.cpSync(path.join(srcDir, "assets"), path.join(out, "assets"), { recursive: true });
fs.cpSync(path.join(srcDir, "vendor"), path.join(out, "vendor"), { recursive: true });

// Static assets/API calls use relative or root-absolute paths, which only
// resolve correctly when the app is served at the domain root (Vercel).
// When deployed under a path prefix (e.g. Traefik at /ticketops), the browser
// needs a <base> tag anchoring relative resolution to that prefix, or asset
// requests silently resolve to the site root and 404 there.
const basePath = process.env.TICKETOPS_BASE_PATH || "";
if (basePath) {
  for (const htmlFile of ["index.html", "customer.html"]) {
    const filePath = path.join(out, htmlFile);
    const html = fs.readFileSync(filePath, "utf8");
    fs.writeFileSync(filePath, html.replace(/<head>/, `<head>\n    <base href="${basePath}">`));
  }
}

const DEFAULT_GOOGLE_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzFg_7RGPt0HQIX_4oxmr_G8Br-UYT8GllmHKD3jf15cZvaods4bI4rFc8-sdmrgCEO/exec";
const configuredApiBase = process.env.TICKETOPS_GOOGLE_APPS_SCRIPT_URL || DEFAULT_GOOGLE_APPS_SCRIPT_URL || process.env.TICKETOPS_API_BASE || "";
const staleApiBasePattern = /(ticketops-api\.onrender\.com|supabase\.co|ksfbnsdqbaccuebrrhvu)/i;
const apiBase = staleApiBasePattern.test(configuredApiBase) ? "" : configuredApiBase;
fs.writeFileSync(path.join(out, "frontend-config.js"), `window.TICKETOPS_CONFIG = ${JSON.stringify({ apiBase })};\n`);

console.log(`Web assets copied to ${out}`);
