import { DAILY_FREE_AI_LIMIT, getEffectiveDailyUsage, isHostedInstance, isUserProActive } from "./db";
import type { AllowlistRow, ConfigRow } from "./types";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const BASE_CSS = `
:root {
  --bg: #ffffff;
  --surface: #f7f7f7;
  --surface-2: #efefef;
  --ink: #0a0a0a;
  --muted: #525252;
  --border: #dcdcdc;
  --border-strong: #0a0a0a;
  --accent: #d94e00;
  --accent-hover: #b84000;
  --accent-tint: rgba(217, 78, 0, 0.08);
  --accent-border: rgba(217, 78, 0, 0.45);
  --grid-line: #e8e8e8;
  --danger: #dc2626;
  --ok: #15803d;
}
@media (prefers-color-scheme: dark) {
  /* Intentionally light/white by default; toggled via [data-theme="dark"] */
}
[data-theme="dark"] {
  --bg: #0a0a0a;
  --surface: #121212;
  --surface-2: #1a1a1a;
  --ink: #ffffff;
  --muted: #a3a3a3;
  --border: #262626;
  --border-strong: #ffffff;
  --accent: #e05200;
  --accent-hover: #ff620a;
  --accent-tint: rgba(224, 82, 0, 0.14);
  --accent-border: rgba(224, 82, 0, 0.55);
  --grid-line: rgba(255, 255, 255, 0.04);
}
* { box-sizing: border-box; }
html { overflow-x: hidden; max-width: 100%; }
body {
  margin: 0;
  min-height: 100vh;
  overflow-x: hidden;
  max-width: 100%;
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
  color: var(--ink);
  background-color: var(--bg);
  background-image:
    linear-gradient(to right, var(--grid-line) 1px, transparent 1px),
    linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px);
  background-size: 48px 48px;
  line-height: 1.55;
  padding: 28px 16px 64px;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 860px; width: 100%; margin: 0 auto; overflow-x: hidden; }
.card {
  position: relative;
  background: var(--bg);
  border: 1px solid var(--border);
  border-top: 3px solid var(--ink);
  border-radius: 0;
  padding: 24px;
  margin-bottom: 18px;
  max-width: 100%;
  overflow-wrap: anywhere;
}
h1 { margin: 8px 0 8px; font-size: 1.65rem; font-weight: 800; letter-spacing: -0.025em; }
h2 { margin: 0 0 12px; font-size: 1.15rem; font-weight: 800; letter-spacing: -0.015em; }
p { margin: 0 0 12px; color: var(--muted); }
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.88em;
  padding: 1px 5px;
  background: var(--surface-2);
  border: 1px solid var(--border);
}
label { display: block; font-weight: 700; font-size: 0.88rem; margin: 12px 0 6px; }
input[type="password"], input[type="text"], input[type="email"], input[type="number"], textarea, select {
  width: 100%; padding: 10px 12px; border-radius: 0;
  border: 1px solid var(--border);
  background: var(--surface); color: var(--ink);
  font: inherit;
}
input:focus, textarea:focus, select:focus {
  outline: none;
  border-color: var(--accent);
}
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: 10px 18px; border-radius: 0; border: 1px solid var(--border);
  background: var(--bg); color: var(--ink); font-weight: 700;
  cursor: pointer; text-decoration: none; font-size: 0.9rem;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}
.btn:hover { border-color: var(--border-strong); background: var(--surface); }
.btn-primary {
  background: var(--accent);
  color: #fff; border-color: var(--accent);
}
.btn-primary:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}
.btn-danger { color: var(--danger); border-color: rgba(220, 38, 38, 0.35); }
.btn-danger:hover { border-color: var(--danger); }
.row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.code-box {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.85rem; padding: 10px 12px; border-radius: 0;
  border: 1px solid var(--border);
  background: var(--surface); overflow-wrap: anywhere; word-break: break-word; flex: 1; min-width: 0; max-width: 100%;
}
.grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
.grid-2 > * { min-width: 0; max-width: 100%; }
@media (max-width: 640px) {
  body { padding: 16px 12px 48px; }
  .card { padding: 16px 14px; }
  .grid-2 { grid-template-columns: 1fr; }
  .btn { max-width: 100%; white-space: normal; text-align: center; }
  .row { flex-direction: column; align-items: stretch; }
  .row > .btn, .row > form, .row > form > .btn { width: 100%; }
  .wiz-prog { height: 5px; background: var(--surface-2); border: 1px solid var(--border); margin-bottom: 16px; }
.wiz-prog-bar { height: 100%; background: var(--accent); transition: width 0.25s ease; }
.wiz-choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin: 14px 0 18px; }
.wiz-choice {
  padding: 14px; border: 2px solid var(--border); background: var(--surface);
  cursor: pointer; text-align: left; transition: border-color 0.15s, background-color 0.15s;
}
.wiz-choice:hover { border-color: var(--ink); }
.wiz-choice.selected { border-color: var(--accent); background: var(--accent-tint); }
.wiz-choice strong { display: block; font-size: 0.96rem; margin-bottom: 4px; color: var(--ink); }
.wiz-choice span { display: block; font-size: 0.82rem; color: var(--muted); line-height: 1.4; }
.wiz-phone {
  border: 2px solid var(--ink); background: var(--surface); padding: 14px;
  font-size: 0.82rem; position: relative; min-height: 190px;
}
.wiz-phone-hdr { font-size: 0.72rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: var(--accent); margin-bottom: 10px; }
.wiz-box { background: var(--bg); border: 1px solid var(--border); padding: 8px 10px; margin-bottom: 8px; }
.wiz-tap {
  display: inline-block; width: 14px; height: 14px; border-radius: 50%;
  background: var(--accent); border: 2px solid #fff; vertical-align: middle; margin-left: 6px;
  animation: wizPulse 1.3s ease-in-out infinite;
}
@keyframes wizPulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.35); opacity: 0.65; } }
.ca-phone { width: 100%; max-width: 240px; }
}
.banner {
  padding: 12px 14px; border-radius: 0; margin-bottom: 16px; font-size: 0.9rem;
  border: 1px solid rgba(21,128,61,0.35); background: rgba(21,128,61,0.1); color: var(--ok);
}
.banner.err { border-color: rgba(220,38,38,0.4); background: rgba(220,38,38,0.1); color: var(--danger); }
.dropzone {
  border: 2px dashed var(--border); border-radius: 0; padding: 26px;
  background: var(--surface);
  text-align: center; cursor: pointer; transition: border-color 0.15s, background 0.15s;
}
.dropzone.over { border-color: var(--accent); background: var(--accent-tint); }
.pill {
  display: inline-block; padding: 3px 10px; border-radius: 0; font-size: 0.74rem;
  font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
  background: var(--accent-tint); border: 1px solid var(--accent-border); color: var(--accent);
}
.wiz-prog { height: 5px; background: var(--surface-2); border: 1px solid var(--border); margin-bottom: 16px; }
.wiz-prog-bar { height: 100%; background: var(--accent); transition: width 0.25s ease; }
.wiz-choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin: 14px 0 18px; }
.wiz-choice {
  padding: 14px; border: 2px solid var(--border); background: var(--surface);
  cursor: pointer; text-align: left; transition: border-color 0.15s, background-color 0.15s;
}
.wiz-choice:hover { border-color: var(--ink); }
.wiz-choice.selected { border-color: var(--accent); background: var(--accent-tint); }
.wiz-choice strong { display: block; font-size: 0.96rem; margin-bottom: 4px; color: var(--ink); }
.wiz-choice span { display: block; font-size: 0.82rem; color: var(--muted); line-height: 1.4; }
.wiz-phone {
  border: 2px solid var(--ink); background: var(--surface); padding: 14px;
  font-size: 0.82rem; position: relative; min-height: 190px;
}
.wiz-phone-hdr { font-size: 0.72rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: var(--accent); margin-bottom: 10px; }
.wiz-box { background: var(--bg); border: 1px solid var(--border); padding: 8px 10px; margin-bottom: 8px; }
.wiz-tap {
  display: inline-block; width: 14px; height: 14px; border-radius: 50%;
  background: var(--accent); border: 2px solid #fff; vertical-align: middle; margin-left: 6px;
  animation: wizPulse 1.3s ease-in-out infinite;
}
@keyframes wizPulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.35); opacity: 0.65; } }
.ca-phone {
  width: 224px; margin: 0 auto; border: 2px solid var(--ink); background: var(--bg);
  padding: 8px; position: relative;
}
.ca-bar {
  display: flex; justify-content: space-between; font-size: 9px; font-weight: 700;
  padding-bottom: 6px; border-bottom: 1px solid var(--border); margin-bottom: 6px;
}
.ca-stage { position: relative; height: 214px; overflow: hidden; font-size: 11px; }
.ca-scene {
  position: absolute; inset: 0; opacity: 0; pointer-events: none;
  display: flex; flex-direction: column; gap: 6px;
}
.ca-s1 { animation: caS1 8s infinite; }
.ca-s2 { animation: caS2 8s infinite; }
.ca-s3 { animation: caS3 8s infinite; }
.ca-s4 { animation: caS4 8s infinite; }
@keyframes caS1 { 0%,22% { opacity:1; } 25%,100% { opacity:0; } }
@keyframes caS2 { 0%,24% { opacity:0; } 25%,47% { opacity:1; } 50%,100% { opacity:0; } }
@keyframes caS3 { 0%,49% { opacity:0; } 50%,72% { opacity:1; } 75%,100% { opacity:0; } }
@keyframes caS4 { 0%,74% { opacity:0; } 75%,97% { opacity:1; } 100% { opacity:0; } }
.ca-home-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; padding-top: 8px; }
.ca-app {
  border: 1px solid var(--border); background: var(--surface); padding: 8px 4px;
  text-align: center; font-size: 9px; font-weight: 700; position: relative;
}
.ca-app.focus { border-color: var(--accent); background: var(--accent-tint); color: var(--accent); }
.ca-nav {
  display: flex; align-items: center; justify-content: space-between;
  padding: 5px 6px; border: 1px solid var(--border); background: var(--surface); font-weight: 800;
}
.ca-ham {
  display: inline-flex; flex-direction: column; gap: 2px; padding: 3px 4px;
  border: 1px solid var(--accent); background: var(--accent-tint); position: relative;
}
.ca-ham span { display: block; width: 12px; height: 2px; background: var(--accent); }
.ca-row {
  padding: 6px 8px; border: 1px solid var(--border); background: var(--bg);
  display: flex; justify-content: space-between; align-items: center; font-size: 10.5px;
}
.ca-row.held {
  border-color: var(--accent); background: var(--accent-tint); font-weight: 800;
  transform: scale(0.98);
}
.ca-menu {
  border: 1px solid var(--ink); background: var(--bg); margin-top: 2px;
  box-shadow: 0 8px 20px rgba(0,0,0,0.16);
}
.ca-menu-item {
  padding: 7px 10px; font-size: 10.5px; font-weight: 700; border-bottom: 1px solid var(--border);
  display: flex; justify-content: space-between;
}
.ca-menu-item:last-child { border-bottom: 0; }
.ca-menu-item.export { background: var(--accent); color: #fff; position: relative; }
.ca-tap {
  position: absolute; width: 14px; height: 14px; border-radius: 50%;
  background: rgba(217,78,0,0.9); border: 2px solid #fff;
  box-shadow: 0 0 0 4px rgba(217,78,0,0.28);
  animation: caPulse 1s ease-in-out infinite;
}
@keyframes caPulse { 0%,100% { transform: scale(0.9); } 50% { transform: scale(1.18); } }
.ca-caption {
  margin-top: auto; font-size: 9.5px; font-weight: 700; text-align: center;
  padding: 4px; background: var(--surface); border: 1px solid var(--border); color: var(--muted);
}
`;

const CONTACTS_ANIM_HTML = `
<div class="ca-phone" aria-label="Animated guide: Export Contacts from iPhone">
  <div class="ca-bar"><span>9:41</span><span>Contacts Export</span><span>5G</span></div>
  <div class="ca-stage">
    <div class="ca-scene ca-s1">
      <div class="ca-home-grid">
        <div class="ca-app">Phone</div>
        <div class="ca-app focus">Contacts<span class="ca-tap" style="right:4px;bottom:4px;"></span></div>
        <div class="ca-app">Messages</div>
        <div class="ca-app">Safari</div>
        <div class="ca-app">Files</div>
        <div class="ca-app">Settings</div>
      </div>
      <div class="ca-caption">1. Tap the Contacts app</div>
    </div>
    <div class="ca-scene ca-s2">
      <div class="ca-nav">
        <span class="ca-ham"><span></span><span></span><span></span><span class="ca-tap" style="left:6px;top:4px;"></span></span>
        <span>All Contacts</span>
        <span>+</span>
      </div>
      <div class="ca-row"><span>Alex Smith</span><span style="opacity:.5;">›</span></div>
      <div class="ca-row"><span>Cody Miller</span><span style="opacity:.5;">›</span></div>
      <div class="ca-row"><span>Mom</span><span style="opacity:.5;">›</span></div>
      <div class="ca-row"><span>Sarah Jones</span><span style="opacity:.5;">›</span></div>
      <div class="ca-caption">2. Tap the 3 bars at top-left</div>
    </div>
    <div class="ca-scene ca-s3">
      <div class="ca-nav"><span>Lists</span><span style="font-weight:400;opacity:.6;">Edit</span></div>
      <div class="ca-row held" style="position:relative;">
        <span>All Contacts</span><span>142</span>
        <span class="ca-tap" style="left:48%;top:22%;"></span>
      </div>
      <div class="ca-row"><span>iCloud</span><span>142</span></div>
      <div class="ca-row"><span>Gmail</span><span>24</span></div>
      <div class="ca-caption">3. Press &amp; hold All Contacts</div>
    </div>
    <div class="ca-scene ca-s4">
      <div class="ca-nav"><span>Lists</span><span style="font-weight:400;opacity:.6;">Edit</span></div>
      <div class="ca-row held"><span>All Contacts</span><span>142</span></div>
      <div class="ca-menu">
        <div class="ca-menu-item export"><span>Export</span><span>&rarr;<span class="ca-tap" style="right:18px;top:6px;"></span></span></div>
        <div class="ca-menu-item"><span>Email All</span><span></span></div>
      </div>
      <div class="ca-caption">4. Tap Export &rarr; Save to Files</div>
    </div>
  </div>
</div>`;

const LOGO_SVG = `<svg width="24" height="24" viewBox="0 0 128 128" fill="none" aria-hidden="true"><path d="M12 20H116V88H56L26 114V88H12V20Z" fill="#D94E00"/><rect x="26" y="34" width="76" height="40" fill="#FFFFFF"/><rect x="36" y="45" width="32" height="6" fill="#0A0A0A"/><rect x="36" y="57" width="56" height="6" fill="#D94E00"/><rect x="76" y="45" width="16" height="6" fill="#0A0A0A"/></svg>`;
const SHORTCUT_ICLOUD_URL = "https://www.icloud.com/shortcuts/9db7f8acb9af489999f26256e901e180";
const SHORTCUT_QR_SVG = `<svg viewBox="0 0 41 41" fill="none" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges"><path d="M2,2h1v1h-1zM3,2h1v1h-1zM4,2h1v1h-1zM5,2h1v1h-1zM6,2h1v1h-1zM7,2h1v1h-1zM8,2h1v1h-1zM10,2h1v1h-1zM17,2h1v1h-1zM19,2h1v1h-1zM20,2h1v1h-1zM21,2h1v1h-1zM23,2h1v1h-1zM24,2h1v1h-1zM26,2h1v1h-1zM29,2h1v1h-1zM32,2h1v1h-1zM33,2h1v1h-1zM34,2h1v1h-1zM35,2h1v1h-1zM36,2h1v1h-1zM37,2h1v1h-1zM38,2h1v1h-1zM2,3h1v1h-1zM8,3h1v1h-1zM12,3h1v1h-1zM14,3h1v1h-1zM16,3h1v1h-1zM17,3h1v1h-1zM20,3h1v1h-1zM22,3h1v1h-1zM30,3h1v1h-1zM32,3h1v1h-1zM38,3h1v1h-1zM2,4h1v1h-1zM4,4h1v1h-1zM5,4h1v1h-1zM6,4h1v1h-1zM8,4h1v1h-1zM11,4h1v1h-1zM12,4h1v1h-1zM13,4h1v1h-1zM16,4h1v1h-1zM19,4h1v1h-1zM20,4h1v1h-1zM21,4h1v1h-1zM22,4h1v1h-1zM23,4h1v1h-1zM24,4h1v1h-1zM25,4h1v1h-1zM28,4h1v1h-1zM29,4h1v1h-1zM32,4h1v1h-1zM34,4h1v1h-1zM35,4h1v1h-1zM36,4h1v1h-1zM38,4h1v1h-1zM2,5h1v1h-1zM4,5h1v1h-1zM5,5h1v1h-1zM6,5h1v1h-1zM8,5h1v1h-1zM10,5h1v1h-1zM12,5h1v1h-1zM14,5h1v1h-1zM20,5h1v1h-1zM21,5h1v1h-1zM22,5h1v1h-1zM25,5h1v1h-1zM27,5h1v1h-1zM28,5h1v1h-1zM29,5h1v1h-1zM30,5h1v1h-1zM32,5h1v1h-1zM34,5h1v1h-1zM35,5h1v1h-1zM36,5h1v1h-1zM38,5h1v1h-1zM2,6h1v1h-1zM4,6h1v1h-1zM5,6h1v1h-1zM6,6h1v1h-1zM8,6h1v1h-1zM10,6h1v1h-1zM11,6h1v1h-1zM12,6h1v1h-1zM14,6h1v1h-1zM15,6h1v1h-1zM16,6h1v1h-1zM18,6h1v1h-1zM20,6h1v1h-1zM22,6h1v1h-1zM23,6h1v1h-1zM25,6h1v1h-1zM29,6h1v1h-1zM30,6h1v1h-1zM32,6h1v1h-1zM34,6h1v1h-1zM35,6h1v1h-1zM36,6h1v1h-1zM38,6h1v1h-1zM2,7h1v1h-1zM8,7h1v1h-1zM10,7h1v1h-1zM13,7h1v1h-1zM15,7h1v1h-1zM18,7h1v1h-1zM20,7h1v1h-1zM21,7h1v1h-1zM23,7h1v1h-1zM24,7h1v1h-1zM27,7h1v1h-1zM28,7h1v1h-1zM32,7h1v1h-1zM38,7h1v1h-1zM2,8h1v1h-1zM3,8h1v1h-1zM4,8h1v1h-1zM5,8h1v1h-1zM6,8h1v1h-1zM7,8h1v1h-1zM8,8h1v1h-1zM10,8h1v1h-1zM12,8h1v1h-1zM14,8h1v1h-1zM16,8h1v1h-1zM18,8h1v1h-1zM20,8h1v1h-1zM22,8h1v1h-1zM24,8h1v1h-1zM26,8h1v1h-1zM28,8h1v1h-1zM30,8h1v1h-1zM32,8h1v1h-1zM33,8h1v1h-1zM34,8h1v1h-1zM35,8h1v1h-1zM36,8h1v1h-1zM37,8h1v1h-1zM38,8h1v1h-1zM10,9h1v1h-1zM11,9h1v1h-1zM12,9h1v1h-1zM15,9h1v1h-1zM16,9h1v1h-1zM19,9h1v1h-1zM20,9h1v1h-1zM21,9h1v1h-1zM22,9h1v1h-1zM24,9h1v1h-1zM28,9h1v1h-1zM29,9h1v1h-1zM2,10h1v1h-1zM6,10h1v1h-1zM8,10h1v1h-1zM9,10h1v1h-1zM10,10h1v1h-1zM11,10h1v1h-1zM12,10h1v1h-1zM15,10h1v1h-1zM17,10h1v1h-1zM20,10h1v1h-1zM24,10h1v1h-1zM26,10h1v1h-1zM28,10h1v1h-1zM29,10h1v1h-1zM31,10h1v1h-1zM32,10h1v1h-1zM33,10h1v1h-1zM34,10h1v1h-1zM35,10h1v1h-1zM38,10h1v1h-1zM9,11h1v1h-1zM10,11h1v1h-1zM12,11h1v1h-1zM13,11h1v1h-1zM16,11h1v1h-1zM18,11h1v1h-1zM21,11h1v1h-1zM22,11h1v1h-1zM23,11h1v1h-1zM27,11h1v1h-1zM29,11h1v1h-1zM30,11h1v1h-1zM34,11h1v1h-1zM35,11h1v1h-1zM37,11h1v1h-1zM2,12h1v1h-1zM3,12h1v1h-1zM7,12h1v1h-1zM8,12h1v1h-1zM9,12h1v1h-1zM10,12h1v1h-1zM11,12h1v1h-1zM12,12h1v1h-1zM13,12h1v1h-1zM14,12h1v1h-1zM15,12h1v1h-1zM18,12h1v1h-1zM19,12h1v1h-1zM20,12h1v1h-1zM22,12h1v1h-1zM28,12h1v1h-1zM29,12h1v1h-1zM30,12h1v1h-1zM33,12h1v1h-1zM35,12h1v1h-1zM2,13h1v1h-1zM6,13h1v1h-1zM7,13h1v1h-1zM9,13h1v1h-1zM12,13h1v1h-1zM13,13h1v1h-1zM15,13h1v1h-1zM16,13h1v1h-1zM19,13h1v1h-1zM23,13h1v1h-1zM26,13h1v1h-1zM28,13h1v1h-1zM32,13h1v1h-1zM34,13h1v1h-1zM35,13h1v1h-1zM36,13h1v1h-1zM37,13h1v1h-1zM2,14h1v1h-1zM5,14h1v1h-1zM6,14h1v1h-1zM7,14h1v1h-1zM8,14h1v1h-1zM10,14h1v1h-1zM11,14h1v1h-1zM12,14h1v1h-1zM13,14h1v1h-1zM15,14h1v1h-1zM17,14h1v1h-1zM19,14h1v1h-1zM21,14h1v1h-1zM22,14h1v1h-1zM23,14h1v1h-1zM24,14h1v1h-1zM25,14h1v1h-1zM31,14h1v1h-1zM32,14h1v1h-1zM35,14h1v1h-1zM36,14h1v1h-1zM37,14h1v1h-1zM38,14h1v1h-1zM4,15h1v1h-1zM7,15h1v1h-1zM10,15h1v1h-1zM11,15h1v1h-1zM15,15h1v1h-1zM16,15h1v1h-1zM17,15h1v1h-1zM18,15h1v1h-1zM19,15h1v1h-1zM20,15h1v1h-1zM22,15h1v1h-1zM24,15h1v1h-1zM25,15h1v1h-1zM27,15h1v1h-1zM28,15h1v1h-1zM29,15h1v1h-1zM30,15h1v1h-1zM31,15h1v1h-1zM34,15h1v1h-1zM35,15h1v1h-1zM2,16h1v1h-1zM4,16h1v1h-1zM5,16h1v1h-1zM6,16h1v1h-1zM8,16h1v1h-1zM9,16h1v1h-1zM12,16h1v1h-1zM14,16h1v1h-1zM17,16h1v1h-1zM20,16h1v1h-1zM22,16h1v1h-1zM23,16h1v1h-1zM24,16h1v1h-1zM25,16h1v1h-1zM26,16h1v1h-1zM29,16h1v1h-1zM33,16h1v1h-1zM34,16h1v1h-1zM35,16h1v1h-1zM36,16h1v1h-1zM4,17h1v1h-1zM5,17h1v1h-1zM6,17h1v1h-1zM9,17h1v1h-1zM13,17h1v1h-1zM18,17h1v1h-1zM21,17h1v1h-1zM23,17h1v1h-1zM26,17h1v1h-1zM30,17h1v1h-1zM31,17h1v1h-1zM32,17h1v1h-1zM33,17h1v1h-1zM34,17h1v1h-1zM36,17h1v1h-1zM3,18h1v1h-1zM5,18h1v1h-1zM6,18h1v1h-1zM8,18h1v1h-1zM9,18h1v1h-1zM10,18h1v1h-1zM11,18h1v1h-1zM12,18h1v1h-1zM15,18h1v1h-1zM16,18h1v1h-1zM18,18h1v1h-1zM21,18h1v1h-1zM22,18h1v1h-1zM25,18h1v1h-1zM26,18h1v1h-1zM28,18h1v1h-1zM30,18h1v1h-1zM32,18h1v1h-1zM35,18h1v1h-1zM36,18h1v1h-1zM38,18h1v1h-1zM2,19h1v1h-1zM3,19h1v1h-1zM4,19h1v1h-1zM5,19h1v1h-1zM7,19h1v1h-1zM9,19h1v1h-1zM10,19h1v1h-1zM13,19h1v1h-1zM15,19h1v1h-1zM20,19h1v1h-1zM21,19h1v1h-1zM24,19h1v1h-1zM26,19h1v1h-1zM27,19h1v1h-1zM29,19h1v1h-1zM31,19h1v1h-1zM33,19h1v1h-1zM34,19h1v1h-1zM35,19h1v1h-1zM37,19h1v1h-1zM3,20h1v1h-1zM7,20h1v1h-1zM8,20h1v1h-1zM9,20h1v1h-1zM10,20h1v1h-1zM11,20h1v1h-1zM12,20h1v1h-1zM13,20h1v1h-1zM14,20h1v1h-1zM16,20h1v1h-1zM17,20h1v1h-1zM21,20h1v1h-1zM24,20h1v1h-1zM25,20h1v1h-1zM28,20h1v1h-1zM29,20h1v1h-1zM33,20h1v1h-1zM35,20h1v1h-1zM36,20h1v1h-1zM2,21h1v1h-1zM3,21h1v1h-1zM6,21h1v1h-1zM11,21h1v1h-1zM14,21h1v1h-1zM16,21h1v1h-1zM17,21h1v1h-1zM18,21h1v1h-1zM19,21h1v1h-1zM21,21h1v1h-1zM22,21h1v1h-1zM23,21h1v1h-1zM24,21h1v1h-1zM25,21h1v1h-1zM29,21h1v1h-1zM32,21h1v1h-1zM34,21h1v1h-1zM35,21h1v1h-1zM36,21h1v1h-1zM37,21h1v1h-1zM2,22h1v1h-1zM4,22h1v1h-1zM6,22h1v1h-1zM7,22h1v1h-1zM8,22h1v1h-1zM11,22h1v1h-1zM12,22h1v1h-1zM14,22h1v1h-1zM15,22h1v1h-1zM19,22h1v1h-1zM20,22h1v1h-1zM23,22h1v1h-1zM24,22h1v1h-1zM26,22h1v1h-1zM28,22h1v1h-1zM31,22h1v1h-1zM32,22h1v1h-1zM33,22h1v1h-1zM35,22h1v1h-1zM36,22h1v1h-1zM2,23h1v1h-1zM3,23h1v1h-1zM4,23h1v1h-1zM6,23h1v1h-1zM9,23h1v1h-1zM11,23h1v1h-1zM12,23h1v1h-1zM14,23h1v1h-1zM15,23h1v1h-1zM17,23h1v1h-1zM18,23h1v1h-1zM23,23h1v1h-1zM24,23h1v1h-1zM25,23h1v1h-1zM26,23h1v1h-1zM27,23h1v1h-1zM28,23h1v1h-1zM29,23h1v1h-1zM30,23h1v1h-1zM31,23h1v1h-1zM33,23h1v1h-1zM34,23h1v1h-1zM2,24h1v1h-1zM5,24h1v1h-1zM6,24h1v1h-1zM8,24h1v1h-1zM9,24h1v1h-1zM12,24h1v1h-1zM14,24h1v1h-1zM17,24h1v1h-1zM19,24h1v1h-1zM25,24h1v1h-1zM26,24h1v1h-1zM29,24h1v1h-1zM31,24h1v1h-1zM33,24h1v1h-1zM34,24h1v1h-1zM35,24h1v1h-1zM36,24h1v1h-1zM5,25h1v1h-1zM9,25h1v1h-1zM11,25h1v1h-1zM13,25h1v1h-1zM14,25h1v1h-1zM15,25h1v1h-1zM17,25h1v1h-1zM18,25h1v1h-1zM19,25h1v1h-1zM20,25h1v1h-1zM22,25h1v1h-1zM24,25h1v1h-1zM25,25h1v1h-1zM26,25h1v1h-1zM28,25h1v1h-1zM29,25h1v1h-1zM30,25h1v1h-1zM31,25h1v1h-1zM32,25h1v1h-1zM33,25h1v1h-1zM34,25h1v1h-1zM36,25h1v1h-1zM4,26h1v1h-1zM8,26h1v1h-1zM9,26h1v1h-1zM13,26h1v1h-1zM14,26h1v1h-1zM15,26h1v1h-1zM20,26h1v1h-1zM21,26h1v1h-1zM24,26h1v1h-1zM25,26h1v1h-1zM29,26h1v1h-1zM30,26h1v1h-1zM32,26h1v1h-1zM35,26h1v1h-1zM36,26h1v1h-1zM2,27h1v1h-1zM3,27h1v1h-1zM4,27h1v1h-1zM5,27h1v1h-1zM7,27h1v1h-1zM10,27h1v1h-1zM12,27h1v1h-1zM13,27h1v1h-1zM15,27h1v1h-1zM16,27h1v1h-1zM18,27h1v1h-1zM21,27h1v1h-1zM22,27h1v1h-1zM25,27h1v1h-1zM26,27h1v1h-1zM28,27h1v1h-1zM29,27h1v1h-1zM31,27h1v1h-1zM33,27h1v1h-1zM34,27h1v1h-1zM36,27h1v1h-1zM6,28h1v1h-1zM7,28h1v1h-1zM8,28h1v1h-1zM9,28h1v1h-1zM10,28h1v1h-1zM13,28h1v1h-1zM14,28h1v1h-1zM15,28h1v1h-1zM16,28h1v1h-1zM18,28h1v1h-1zM20,28h1v1h-1zM22,28h1v1h-1zM23,28h1v1h-1zM25,28h1v1h-1zM27,28h1v1h-1zM28,28h1v1h-1zM29,28h1v1h-1zM30,28h1v1h-1zM33,28h1v1h-1zM35,28h1v1h-1zM36,28h1v1h-1zM5,29h1v1h-1zM6,29h1v1h-1zM11,29h1v1h-1zM14,29h1v1h-1zM16,29h1v1h-1zM19,29h1v1h-1zM20,29h1v1h-1zM23,29h1v1h-1zM24,29h1v1h-1zM25,29h1v1h-1zM30,29h1v1h-1zM32,29h1v1h-1zM34,29h1v1h-1zM35,29h1v1h-1zM36,29h1v1h-1zM2,30h1v1h-1zM3,30h1v1h-1zM4,30h1v1h-1zM6,30h1v1h-1zM8,30h1v1h-1zM9,30h1v1h-1zM10,30h1v1h-1zM14,30h1v1h-1zM17,30h1v1h-1zM19,30h1v1h-1zM21,30h1v1h-1zM23,30h1v1h-1zM24,30h1v1h-1zM25,30h1v1h-1zM26,30h1v1h-1zM30,30h1v1h-1zM31,30h1v1h-1zM32,30h1v1h-1zM33,30h1v1h-1zM34,30h1v1h-1zM35,30h1v1h-1zM36,30h1v1h-1zM38,30h1v1h-1zM10,31h1v1h-1zM11,31h1v1h-1zM14,31h1v1h-1zM16,31h1v1h-1zM17,31h1v1h-1zM18,31h1v1h-1zM19,31h1v1h-1zM20,31h1v1h-1zM25,31h1v1h-1zM27,31h1v1h-1zM28,31h1v1h-1zM30,31h1v1h-1zM34,31h1v1h-1zM37,31h1v1h-1zM2,32h1v1h-1zM3,32h1v1h-1zM4,32h1v1h-1zM5,32h1v1h-1zM6,32h1v1h-1zM7,32h1v1h-1zM8,32h1v1h-1zM10,32h1v1h-1zM12,32h1v1h-1zM14,32h1v1h-1zM15,32h1v1h-1zM16,32h1v1h-1zM17,32h1v1h-1zM18,32h1v1h-1zM20,32h1v1h-1zM22,32h1v1h-1zM23,32h1v1h-1zM24,32h1v1h-1zM25,32h1v1h-1zM26,32h1v1h-1zM28,32h1v1h-1zM30,32h1v1h-1zM32,32h1v1h-1zM34,32h1v1h-1zM37,32h1v1h-1zM2,33h1v1h-1zM8,33h1v1h-1zM11,33h1v1h-1zM12,33h1v1h-1zM13,33h1v1h-1zM14,33h1v1h-1zM15,33h1v1h-1zM17,33h1v1h-1zM18,33h1v1h-1zM22,33h1v1h-1zM23,33h1v1h-1zM26,33h1v1h-1zM28,33h1v1h-1zM30,33h1v1h-1zM34,33h1v1h-1zM35,33h1v1h-1zM36,33h1v1h-1zM37,33h1v1h-1zM38,33h1v1h-1zM2,34h1v1h-1zM4,34h1v1h-1zM5,34h1v1h-1zM6,34h1v1h-1zM8,34h1v1h-1zM10,34h1v1h-1zM11,34h1v1h-1zM13,34h1v1h-1zM15,34h1v1h-1zM16,34h1v1h-1zM17,34h1v1h-1zM18,34h1v1h-1zM21,34h1v1h-1zM22,34h1v1h-1zM25,34h1v1h-1zM28,34h1v1h-1zM30,34h1v1h-1zM31,34h1v1h-1zM32,34h1v1h-1zM33,34h1v1h-1zM34,34h1v1h-1zM35,34h1v1h-1zM36,34h1v1h-1zM38,34h1v1h-1zM2,35h1v1h-1zM4,35h1v1h-1zM5,35h1v1h-1zM6,35h1v1h-1zM8,35h1v1h-1zM11,35h1v1h-1zM12,35h1v1h-1zM13,35h1v1h-1zM14,35h1v1h-1zM16,35h1v1h-1zM20,35h1v1h-1zM21,35h1v1h-1zM24,35h1v1h-1zM25,35h1v1h-1zM26,35h1v1h-1zM27,35h1v1h-1zM30,35h1v1h-1zM32,35h1v1h-1zM33,35h1v1h-1zM36,35h1v1h-1zM38,35h1v1h-1zM2,36h1v1h-1zM4,36h1v1h-1zM5,36h1v1h-1zM6,36h1v1h-1zM8,36h1v1h-1zM12,36h1v1h-1zM14,36h1v1h-1zM15,36h1v1h-1zM17,36h1v1h-1zM20,36h1v1h-1zM21,36h1v1h-1zM24,36h1v1h-1zM25,36h1v1h-1zM26,36h1v1h-1zM27,36h1v1h-1zM31,36h1v1h-1zM32,36h1v1h-1zM36,36h1v1h-1zM2,37h1v1h-1zM8,37h1v1h-1zM14,37h1v1h-1zM17,37h1v1h-1zM18,37h1v1h-1zM19,37h1v1h-1zM21,37h1v1h-1zM22,37h1v1h-1zM23,37h1v1h-1zM25,37h1v1h-1zM28,37h1v1h-1zM34,37h1v1h-1zM35,37h1v1h-1zM36,37h1v1h-1zM37,37h1v1h-1zM2,38h1v1h-1zM3,38h1v1h-1zM4,38h1v1h-1zM5,38h1v1h-1zM6,38h1v1h-1zM7,38h1v1h-1zM8,38h1v1h-1zM10,38h1v1h-1zM13,38h1v1h-1zM14,38h1v1h-1zM15,38h1v1h-1zM18,38h1v1h-1zM19,38h1v1h-1zM20,38h1v1h-1zM23,38h1v1h-1zM24,38h1v1h-1zM26,38h1v1h-1zM33,38h1v1h-1zM35,38h1v1h-1zM36,38h1v1h-1zM37,38h1v1h-1zM38,38h1v1h-1z" fill="#0a0a0a"/></svg>`;

function layout(title: string, body: string): Response {
  return new Response(
    `<!DOCTYPE html><html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><!-- Made by Packer Evans --><style>${BASE_CSS}</style></head><body><div class="wrap"><header style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;margin-bottom:20px;background:var(--bg);border:1px solid var(--border);gap:10px;flex-wrap:wrap;"><div style="display:flex;align-items:center;gap:10px;font-weight:800;font-size:0.95rem;letter-spacing:-0.01em;">${LOGO_SVG}<span>AI Text Hub</span></div><div style="display:flex;align-items:center;gap:8px;"><a href="https://elevatedcleaning.page/ai_text_hub.html?donate=1" target="_blank" rel="noopener" class="btn" style="padding:6px 12px;font-size:0.82rem;">Buy Me a Coffee</a><button id="themeToggle" class="btn" type="button" style="padding:6px 10px;font-size:0.85rem;" aria-label="Toggle theme">☾</button></div></header>${body}<div style="margin-top:24px;text-align:right;font-size:11px;opacity:0.42;color:var(--muted);">Made by Packer Evans</div></div><script>(function(){var r=document.documentElement,b=document.getElementById('themeToggle');function a(t){r.setAttribute('data-theme',t);if(b)b.textContent=t==='dark'?'☀':'☾';try{localStorage.setItem('athWorkerTheme',t)}catch{}}var s=null;try{s=localStorage.getItem('athWorkerTheme')}catch{}a(s==='dark'?'dark':'light');if(b)b.addEventListener('click',function(){a(r.getAttribute('data-theme')==='dark'?'light':'dark')});})();</script></body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      },
    }
  );
}

export function renderSetupPage(error?: string): Response {
  return layout(
    "Setup — AI Text Hub",
    `
    <div class="card">
      <span class="pill">First-Run Setup</span>
      <h1>Create Your Hub Account</h1>
      <ul style="margin:0 0 14px 18px;color:var(--muted);display:flex;flex-direction:column;gap:4px;">
        <li>This Worker runs inside your own Cloudflare account.</li>
        <li>Your username and password lock this dashboard.</li>
        <li>They also act as your OAuth 2.1 login for Claude, ChatGPT, or Grok.</li>
      </ul>
      ${error ? `<div class="banner err">${esc(error)}</div>` : ""}
      <form method="POST" action="/setup">
        <label for="username">Username</label>
        <input id="username" name="username" type="text" value="admin" minlength="2" maxlength="40" required autocomplete="username" />
        <label for="password">Password (min 10 characters)</label>
        <input id="password" name="password" type="password" minlength="10" required autocomplete="new-password" />
        <label for="confirm">Confirm Password</label>
        <input id="confirm" name="confirm" type="password" minlength="10" required autocomplete="new-password" />
        <div style="margin-top:16px">
          <button class="btn btn-primary" type="submit">Initialize Hub</button>
        </div>
      </form>
    </div>
    `
  );
}

export function renderSignupPage(error?: string): Response {
  return layout(
    "Create Account — AI Text Hub",
    `
    <div class="card" style="max-width:480px;margin:32px auto;">
      <span class="pill">30-Second Setup</span>
      <h1>Create Your Free Account</h1>
      <ul style="margin:0 0 14px 18px;color:var(--muted);display:flex;flex-direction:column;gap:4px;">
        <li>Sign up with your email and password.</li>
        <li>You will immediately get your private Shortcut API Key and MCP URL.</li>
      </ul>
      <div style="padding:10px 12px;margin-bottom:14px;border:1px solid var(--accent-border);background:var(--accent-tint);font-size:0.84rem;color:var(--ink);">
        <strong>AI Compatibility:</strong> Works free with <strong>Claude</strong>. <strong>ChatGPT</strong> requires Pro/Business and <strong>Grok</strong> requires a paid plan for custom MCP connectors.
      </div>
      ${error ? `<div class="banner err">${esc(error)}</div>` : ""}
      <form method="POST" action="/signup">
        <input type="text" name="website" value="" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;opacity:0;height:0;width:0;pointer-events:none;" />
        <label for="email">Email</label>
        <input id="email" name="email" type="email" maxlength="120" placeholder="you@example.com" required autocomplete="email" />
        <label for="password">Password (min 10 characters)</label>
        <input id="password" name="password" type="password" minlength="10" required autocomplete="new-password" />
        <label for="confirm">Confirm Password</label>
        <input id="confirm" name="confirm" type="password" minlength="10" required autocomplete="new-password" />
        <div class="row" style="margin-top:16px;justify-content:space-between;">
          <button class="btn btn-primary" type="submit">Create Account</button>
          <a href="/login" style="font-size:0.88rem;color:var(--accent);font-weight:700;text-decoration:none;">Already have an account? Sign In &rarr;</a>
        </div>
      </form>
    </div>
    `
  );
}

export function renderLoginPage(error?: string, nextUrl = "/dashboard", notice?: string): Response {
  return layout(
    "Sign In — AI Text Hub",
    `
    <div class="card" style="max-width:460px;margin:48px auto;">
      <h1>Sign In to AI Text Hub</h1>
      <p>Enter your email and password to manage your Shortcut key, contacts, and connected AI clients.</p>
      ${notice ? `<div class="banner ok">${esc(notice)}</div>` : ""}
      ${error ? `<div class="banner err">${esc(error)}</div>` : ""}
      <form method="POST" action="/login">
        <input type="hidden" name="next" value="${esc(nextUrl)}" />
        <label for="email">Email</label>
        <input id="email" name="email" type="text" placeholder="you@example.com" required autocomplete="email" />
        <label for="password">Password</label>
        <input id="password" name="password" type="password" required autocomplete="current-password" />
        <div class="row" style="margin-top:16px;justify-content:space-between;">
          <button class="btn btn-primary" type="submit">Sign In</button>
          <a href="/signup" style="font-size:0.88rem;color:var(--accent);font-weight:700;text-decoration:none;">New here? Create Account &rarr;</a>
        </div>
      </form>
    </div>
    `
  );
}

export function renderOAuthAuthorizePage(params: {
  clientName: string;
  csrfToken: string;
  authNonce: string;
  error?: string;
}): Response {
  return layout(
    "Authorize AI Client — AI Text Hub",
    `
    <div class="card" style="max-width:520px;margin:32px auto;">
      <span class="pill">OAuth 2.1 Remote MCP</span>
      <h1>Connect ${esc(params.clientName)}</h1>
      <p>Enter your email and password to grant <strong>${esc(params.clientName)}</strong> scoped access to your private AI Text Hub.</p>
      ${params.error ? `<div class="banner err">${esc(params.error)}</div>` : ""}
      <form method="POST" action="/authorize" onsubmit="const b=this.querySelector('button[type=submit]');if(b){b.disabled=true;b.textContent='Connecting...';}">
        <input type="hidden" name="csrf" value="${esc(params.csrfToken)}" />
        <input type="hidden" name="auth_nonce" value="${esc(params.authNonce)}" />
        <label>Permissions</label>
        <label style="font-weight:400"><input type="checkbox" name="scope" value="messages:read" checked /> Read recent chats (past 6 messages)</label>
        <label style="font-weight:400"><input type="checkbox" name="scope" value="contacts:read" checked /> Search synced contacts</label>
        <label style="font-weight:400"><input type="checkbox" name="scope" value="outbox:write" checked /> Queue outbound texts (respects allowlist &amp; hourly cap)</label>
        <label for="email">Email</label>
        <input id="email" name="email" type="text" placeholder="you@example.com" required autocomplete="email" />
        <label for="password">Password</label>
        <input id="password" name="password" type="password" required autocomplete="current-password" />
        <div class="row" style="margin-top:18px;">
          <button class="btn btn-primary" type="submit" id="authApproveBtn">Approve Connection</button>
        </div>
      </form>
      <script>window.addEventListener("pageshow",function(){var b=document.getElementById("authApproveBtn");if(b){b.disabled=false;b.textContent="Approve Connection";}});</script>
    </div>
    `
  );
}

export function renderDashboardPage(params: {
  origin: string;
  config: ConfigRow;
  csrfToken: string;
  contactCount: number;
  chatCount: number;
  pendingOutbox: number;
  allowlist: AllowlistRow[];
  grants: { id: string; clientId: string; scope: string[]; createdAt?: number }[];
  freshApiKey?: string;
  freshMcpBearer?: string;
  notice?: string;
}): Response {
  const mcpUrl = `${params.origin}/mcp`;
  const starterPrompt = `I just connected my private AI Text Hub MCP server. Please run get_onboarding_config to see my setup questions and current preferences, walk me through any unanswered setup questions briefly, and save my preferences.`;
  const encodedPrompt = encodeURIComponent(starterPrompt);
  const claudeLaunchUrl = `https://claude.ai/new?q=${encodedPrompt}`;
  const chatgptLaunchUrl = `https://chatgpt.com/?q=${encodedPrompt}`;
  const grokLaunchUrl = `https://grok.com/?q=${encodedPrompt}`;
  const autoDraftOn = params.config.auto_draft_enabled === 1;
  const maxParticipants = Math.min(4, Math.max(1, params.config.auto_draft_max_participants ?? 4));
  const autoDraftPrompt = `Hey! I just turned on Auto-Draft Replies for chats with 1–${maxParticipants} people. Please run get_onboarding_config to see my current setup and help me tune my auto-reply style and rules!`;
  const hosted = isHostedInstance(params.origin);
  const isPro = isUserProActive(params.config);
  const dailyUsed = getEffectiveDailyUsage(params.config);
  const usagePct = isPro ? 100 : Math.min(100, Math.round((dailyUsed / DAILY_FREE_AI_LIMIT) * 100));
  const upgradeUrl = `https://elevatedcleaning.page/api/ai-text-hub/upgrade?user=${encodeURIComponent(params.config.username || "admin")}&return=${encodeURIComponent(params.origin)}`;

  const allowRows = params.allowlist
    .map(
      (a) => `
      <div class="row" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
        <div><strong>${esc(a.label || a.target_value)}</strong> <span class="pill">${esc(a.target_type)}</span> <span style="color:var(--muted);font-size:.85rem">${esc(a.target_value)}</span></div>
        <form method="POST" action="/api/allowlist/delete" style="margin:0">
          <input type="hidden" name="csrf" value="${esc(params.csrfToken)}" />
          <input type="hidden" name="id" value="${a.id}" />
          <button class="btn btn-danger" type="submit">Remove</button>
        </form>
      </div>`
    )
    .join("");

  const grantRows =
    params.grants.length === 0
      ? `<p>No AI clients connected yet. Paste your MCP URL into Claude, ChatGPT, or Grok to connect.</p>`
      : params.grants
          .map(
            (g) => `
        <div class="row" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
          <div><strong>${esc(g.clientId)}</strong> <span style="color:var(--muted);font-size:.82rem">(${esc(g.scope.join(", "))})</span></div>
          <form method="POST" action="/api/clients/revoke" style="margin:0">
            <input type="hidden" name="csrf" value="${esc(params.csrfToken)}" />
            <input type="hidden" name="grantId" value="${esc(g.id)}" />
            <button class="btn btn-danger" type="submit">Revoke</button>
          </form>
        </div>`
          )
          .join("");

  const showWizardByDefault = params.contactCount === 0 && params.chatCount === 0 && !autoDraftOn && !params.freshMcpBearer;

  return layout(
    "Dashboard — AI Text Hub",
    `
    <div class="row" style="justify-content:space-between;margin-bottom:14px">
      <div>
        <h1>AI Text Hub</h1>
        <p style="margin:0">Account: <strong>${esc(params.config.username || "admin")}</strong> &middot; ${params.contactCount} contacts &middot; ${params.chatCount} chats &middot; ${params.pendingOutbox} queued</p>
      </div>
      <div class="row">
        <button class="btn" type="button" id="toggleGuideBtn" onclick="toggleSetupMode()">${showWizardByDefault ? "Skip to Dashboard" : "Setup Guide"}</button>
        <form method="POST" action="/logout" style="margin:0"><button class="btn" type="submit">Sign Out</button></form>
      </div>
    </div>

    ${params.notice ? `<div class="banner">${esc(params.notice)}</div>` : ""}

    ${
      params.freshMcpBearer
        ? `<div class="card" style="border-color:var(--accent-border);border-top-color:var(--accent)">
            <span class="pill">CLI / Grok Bearer Token — Shown Once</span>
            <h2>Your MCP Bearer Fallback Token</h2>
            <div class="row">
              <div class="code-box" id="freshBearer">${esc(params.freshMcpBearer)}</div>
              <button class="btn btn-primary" type="button" onclick="copyText('freshBearer')">Copy Token</button>
            </div>
          </div>`
        : ""
    }

    <div id="setupWizard" style="display:${showWizardByDefault ? "block" : "none"};">
      <div class="card">
        <div class="row" style="justify-content:space-between;margin-bottom:8px;">
          <span class="pill" id="wizStepPill">Step 1 of 6</span>
          <span style="font-size:0.8rem;color:var(--muted);" id="wizStepLabel">Choose Your Goal</span>
        </div>
        <div class="wiz-prog"><div class="wiz-prog-bar" id="wizProgBar" style="width:16.6%;"></div></div>

        <!-- WIZARD STEP 1: GOAL -->
        <div class="wiz-pane" data-step="1">
          <h2>What are you looking for?</h2>
          <p>Pick one so we only show the steps you actually need.</p>
          <div class="wiz-choices">
            <button type="button" class="wiz-choice" data-goal="queue" onclick="pickGoal('queue', this)">
              <strong>Queue texts from my AI</strong>
              <span>Ask Claude, ChatGPT, or Grok to read texts &amp; queue replies for your approval.</span>
            </button>
            <button type="button" class="wiz-choice" data-goal="autodraft" onclick="pickGoal('autodraft', this)">
              <strong>Auto-Draft my unread texts</strong>
              <span>Automatically draft replies to 1&ndash;4 person chats whenever Messages opens.</span>
            </button>
            <button type="button" class="wiz-choice selected" data-goal="both" onclick="pickGoal('both', this)">
              <strong>Both (Recommended)</strong>
              <span>Full AI texting assistant + automatic background drafts.</span>
            </button>
          </div>
        </div>

        <!-- WIZARD STEP 2: AI CLIENT -->
        <div class="wiz-pane" data-step="2" style="display:none;">
          <h2>Which AI are you using?</h2>
          <p>Select one or more (you can always add another later).</p>
          <div class="wiz-choices">
            <button type="button" class="wiz-choice selected" data-ai="claude" onclick="toggleAi('claude', this)">
              <strong>Claude (Free or Paid)</strong>
              <span>Works on Claude Free &amp; Pro via Custom Connectors.</span>
            </button>
            <button type="button" class="wiz-choice" data-ai="chatgpt" onclick="toggleAi('chatgpt', this)">
              <strong>ChatGPT (Pro / Team)</strong>
              <span>Uses Developer Mode &rarr; Apps &rarr; Create App.</span>
            </button>
            <button type="button" class="wiz-choice" data-ai="grok" onclick="toggleAi('grok', this)">
              <strong>Grok (Paid)</strong>
              <span>Connects via grok.com/connectors &rarr; Custom.</span>
            </button>
          </div>
        </div>

        <!-- WIZARD STEP 3: SHORTCUT -->
        <div class="wiz-pane" data-step="3" style="display:none;">
          <h2>Add the iPhone Shortcut</h2>
          <p>Tap <strong>Add iOS Shortcut</strong>, then paste these 2 boxes into the import prompts.</p>
          <div class="grid-2" style="align-items:start;">
            <div>
              <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px;">
                <div style="width:104px;height:104px;padding:6px;background:#fff;border:1px solid var(--border);flex-shrink:0;">${SHORTCUT_QR_SVG}</div>
                <a class="btn btn-primary" href="${SHORTCUT_ICLOUD_URL}" target="_blank" rel="noopener">Add iOS Shortcut &rarr;</a>
              </div>
              <label style="margin-top:0;">Prompt 1: Worker URL</label>
              <div class="row" style="margin-bottom:8px;">
                <div class="code-box" id="wizWorkerUrl">${esc(params.origin)}</div>
                <button class="btn" type="button" onclick="copyText('wizWorkerUrl')">Copy</button>
              </div>
              <label>Prompt 2: Shortcut API Key</label>
              ${
                params.freshApiKey
                  ? `<div class="row">
                       <div class="code-box" id="wizApiKey">${esc(params.freshApiKey)}</div>
                       <button class="btn btn-primary" type="button" onclick="copyText('wizApiKey')">Copy Key</button>
                     </div>`
                  : `<div class="row" style="justify-content:space-between;">
                       <div class="code-box">Saved (${esc(params.config.api_key_prefix)})</div>
                       <form method="POST" action="/api/rotate-key" style="margin:0"><input type="hidden" name="csrf" value="${esc(params.csrfToken)}" /><button class="btn" type="submit">Reveal New Key</button></form>
                     </div>`
              }
            </div>
            <div class="wiz-phone">
              <div class="wiz-phone-hdr">iPhone Preview &middot; Import</div>
              <div class="wiz-box"><strong>1. Worker URL</strong><div style="color:var(--muted);font-size:0.76rem;">${esc(params.origin)}</div></div>
              <div class="wiz-box"><strong>2. Shortcut API Key</strong><div style="color:var(--muted);font-size:0.76rem;">ath_••••••••••••</div></div>
              <div style="margin-top:12px;padding:8px;background:var(--accent);color:#fff;font-weight:700;text-align:center;">Add Shortcut <span class="wiz-tap"></span></div>
            </div>
          </div>
        </div>

        <!-- WIZARD STEP 4: AUTOMATION -->
        <div class="wiz-pane" data-step="4" style="display:none;">
          <h2>Set the Messages Automation</h2>
          <p>Set the AI Hub to trigger when you open Messages. There are two parts: <strong>When</strong> (the trigger) and <strong>Do</strong> (the action).</p>
          <div class="grid-2" style="align-items:start;">
            <div>
              <div class="wiz-box" style="border-left:4px solid var(--accent);">
                <strong>1. When (Trigger):</strong><br/>
                Open <strong>Shortcuts</strong> &rarr; <strong>Automation</strong> &rarr; <strong>New Automation</strong> (<strong>+</strong>) &rarr; <strong>App</strong> &rarr; <strong>Messages</strong> &rarr; <strong>Is Opened</strong> &rarr; <strong>Run Immediately</strong> &rarr; <strong>Next</strong>.
              </div>
              <div class="wiz-box" style="border-left:4px solid var(--ink);">
                <strong>2. Do (Action):</strong><br/>
                Select <strong>AI Text Hub</strong> (or search <strong>Run Shortcut</strong> &rarr; <strong>AI Text Hub</strong>) &rarr; <strong>Done</strong>.
              </div>
              <div class="wiz-box" style="font-size:0.84rem;color:var(--muted);">
                <strong>3. First Run:</strong> Open <strong>Messages</strong> once &amp; tap <strong>Always Allow</strong> on the popups. <em>Nothing sends without your tap.</em>
              </div>
            </div>
            <div class="wiz-phone">
              <div class="wiz-phone-hdr">iPhone Preview &middot; Automation</div>
              <div class="wiz-box"><strong>When:</strong> Automation &rarr; App &rarr; <strong>Messages</strong> &rarr; <strong>Is Opened</strong> &#10003;</div>
              <div class="wiz-box"><strong>Mode:</strong> Run Immediately &#10003;</div>
              <div class="wiz-box" style="border-color:var(--accent);"><strong>Do:</strong> Run Shortcut &rarr; <strong>AI Text Hub</strong> <span class="wiz-tap"></span></div>
            </div>
          </div>
        </div>

        <!-- WIZARD STEP 5: CONNECT AI -->
        <div class="wiz-pane" data-step="5" style="display:none;">
          <h2>Connect Your AI</h2>
          <div class="grid-2" style="align-items:start;">
            <div>
              <label style="margin-top:0;">Remote MCP URL</label>
              <div class="row" style="margin-bottom:12px;">
                <div class="code-box" id="wizMcpUrl">${esc(mcpUrl)}</div>
                <button class="btn" type="button" onclick="copyText('wizMcpUrl')">Copy URL</button>
              </div>
              <div id="wizAiInstructions"></div>
              <div class="row" style="margin-top:12px;" id="wizAiLaunchBtns">
                <a class="btn btn-primary" data-ai-btn="claude" href="https://claude.ai/settings/connectors" target="_blank" rel="noopener">Open Claude Connectors &rarr;</a>
                <a class="btn" data-ai-btn="chatgpt" href="https://chatgpt.com" target="_blank" rel="noopener">Open ChatGPT &rarr;</a>
                <a class="btn" data-ai-btn="grok" href="https://grok.com/connectors" target="_blank" rel="noopener">Open Grok Connectors &rarr;</a>
              </div>
            </div>
            <div class="wiz-phone">
              <div class="wiz-phone-hdr">iPhone Preview &middot; Connector</div>
              <div class="wiz-box"><strong>Name:</strong> AI Texting <span style="color:var(--muted);">(any name works)</span></div>
              <div class="wiz-box"><strong>URL:</strong> .../mcp</div>
              <div class="wiz-box"><strong>Auth:</strong> Detected <span style="color:var(--muted);">(ignore Headers)</span></div>
              <div style="margin-top:10px;padding:8px;background:var(--accent);color:#fff;font-weight:700;text-align:center;">Add &rarr; Approve Connection <span class="wiz-tap"></span></div>
            </div>
          </div>
        </div>

        <!-- WIZARD STEP 6: CELEBRATION & OPTIONAL EXTRAS -->
        <div class="wiz-pane" data-step="6" style="display:none;">
          <h2>You're All Set! 🎉</h2>
          <p>Your iPhone &amp; AI are ready. These last two extras are <strong>optional</strong> — you can turn them on now or anytime on your dashboard.</p>
          <div class="grid-2" style="align-items:start;">
            <div class="wiz-box" style="padding:14px;">
              <strong>Optional: Auto-Draft Replies</strong>
              <p style="font-size:0.84rem;margin:6px 0 10px;">Automatically drafts replies for 1&ndash;4 person chats (2,000 free credits/day, $12/yr Unlimited).</p>
              <form method="POST" action="/api/auto-draft/toggle" style="margin:0;">
                <input type="hidden" name="csrf" value="${esc(params.csrfToken)}" />
                ${
                  autoDraftOn
                    ? `<button class="btn btn-primary" type="submit">Auto-Draft: ON</button>`
                    : `<div class="row">
                         <select name="max_participants" style="width:auto;">
                           <option value="1">1 person</option>
                           <option value="2">1&ndash;2 people</option>
                           <option value="3">1&ndash;3 people</option>
                           <option value="4" selected>1&ndash;4 people (Preset)</option>
                         </select>
                         <button class="btn btn-primary" type="submit">Turn Auto-Draft ON</button>
                       </div>`
                }
              </form>
            </div>
            <div class="wiz-box" style="padding:14px;">
              <strong>Optional: Upload Contacts.vcf</strong>
              <p style="font-size:0.82rem;margin:6px 0 8px;">Auto-Sync already grabs your 10 newest contacts. For all contacts: <strong>Contacts &rarr; &lt; Lists (top-left) &rarr; hold All Contacts &rarr; Export &rarr; Save to Files</strong>.</p>
              <button class="btn" type="button" onclick="finishSetup(true)">Upload Contacts on Dashboard</button>
            </div>
          </div>
        </div>

        <div class="row" style="justify-content:space-between;margin-top:18px;padding-top:14px;border-top:1px solid var(--border);">
          <button class="btn" type="button" id="wizBackBtn" onclick="wizNav(-1)" style="visibility:hidden;">&larr; Back</button>
          <div class="row">
            <button class="btn btn-primary" type="button" id="wizNextBtn" onclick="wizNav(1)">Next &rarr;</button>
          </div>
        </div>
      </div>
    </div>

    <div id="simpleDash" style="display:${showWizardByDefault ? "none" : "block"};">

    <div class="card">
      <span class="pill">Background AI</span>
      <div class="row" style="justify-content:space-between;margin-top:8px;gap:10px;flex-wrap:wrap;">
        <h2 style="margin:0;">Auto-Draft Replies</h2>
        ${
          autoDraftOn
            ? `<form method="POST" action="/api/auto-draft/toggle" style="margin:0;">
                 <input type="hidden" name="csrf" value="${esc(params.csrfToken)}" />
                 <button class="btn btn-primary" type="submit">Auto-Draft: ON</button>
               </form>`
            : `<form method="POST" action="/api/auto-draft/toggle" style="margin:0;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                 <input type="hidden" name="csrf" value="${esc(params.csrfToken)}" />
                 <label for="maxPartOff" style="margin:0;font-size:0.82rem;color:var(--muted);">Reply to chats up to:</label>
                 <select id="maxPartOff" name="max_participants" style="width:auto;margin:0;padding:6px 10px;">
                   <option value="1" ${maxParticipants === 1 ? "selected" : ""}>1 person (1-on-1 only)</option>
                   <option value="2" ${maxParticipants === 2 ? "selected" : ""}>2 people</option>
                   <option value="3" ${maxParticipants === 3 ? "selected" : ""}>3 people</option>
                   <option value="4" ${maxParticipants === 4 ? "selected" : ""}>4 people (Recommended)</option>
                 </select>
                 <button class="btn" type="submit">Turn Auto-Draft ON</button>
               </form>`
        }
      </div>
      ${
        autoDraftOn
          ? `<form method="POST" action="/api/auto-draft/toggle" style="margin:10px 0 4px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
               <input type="hidden" name="csrf" value="${esc(params.csrfToken)}" />
               <input type="hidden" name="action" value="update_max" />
               <label for="maxPartOn" style="margin:0;font-size:0.85rem;">How many people in a chat should Auto-Draft reply to?</label>
               <select id="maxPartOn" name="max_participants" onchange="this.form.submit()" style="width:auto;margin:0;padding:6px 10px;">
                 <option value="1" ${maxParticipants === 1 ? "selected" : ""}>1 person (1-on-1 only)</option>
                 <option value="2" ${maxParticipants === 2 ? "selected" : ""}>1–2 people</option>
                 <option value="3" ${maxParticipants === 3 ? "selected" : ""}>1–3 people</option>
                 <option value="4" ${maxParticipants === 4 ? "selected" : ""}>1–4 people (Preset)</option>
               </select>
             </form>`
          : ""
      }
      <ul style="margin:10px 0 12px 18px;color:var(--muted);display:flex;flex-direction:column;gap:4px;">
        <li>Drafts replies for new unread texts in chats with <strong>1&ndash;${maxParticipants}</strong> people (5+ person groups are always skipped). Approval menu still required before sending.</li>
        ${
          hosted
            ? `<li>Every user gets <strong>${DAILY_FREE_AI_LIMIT} free credits/day</strong> (${dailyUsed} / ${DAILY_FREE_AI_LIMIT} used today). <strong>$12/year</strong> to upgrade to Unlimited.</li>`
            : `<li>Runs on your own Cloudflare Workers AI allowance (10,000 free Neurons/day).</li>`
        }
      </ul>
      ${
        params.contactCount < 20
          ? `<div class="banner" style="margin-bottom:12px;border-color:var(--accent-border);background:var(--surface-2);">
               <strong>Heads up:</strong> Group size detection &amp; group replies struggle unless your full <code>Contacts.vcf</code> is uploaded below (auto-sync only pulls 10 recent contacts).
             </div>`
          : ""
      }
      ${
        !hosted || isPro
          ? ""
          : `<div style="height:6px;background:var(--surface-2);border:1px solid var(--border);margin-bottom:12px;">
               <div style="height:100%;width:${usagePct}%;background:var(--accent);"></div>
             </div>
             <a class="btn" href="${upgradeUrl}">Upgrade to Unlimited ($12/year) &rarr;</a>`
      }
      ${
        autoDraftOn
          ? `<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border);">
               <label style="margin-top:0;">Tune Auto-Draft With Your AI (Copy &amp; Paste)</label>
               <div class="code-box" id="autoDraftPromptBox" style="margin-bottom:8px;">${esc(autoDraftPrompt)}</div>
               <div class="row">
                 <button class="btn btn-primary" type="button" onclick="copyText('autoDraftPromptBox')">Copy Auto-Draft Prompt</button>
                 <a class="btn" href="https://claude.ai/new?q=${encodeURIComponent(autoDraftPrompt)}" target="_blank" rel="noopener">Open in Claude &rarr;</a>
                 <a class="btn" href="https://chatgpt.com/?q=${encodeURIComponent(autoDraftPrompt)}" target="_blank" rel="noopener">Open in ChatGPT &rarr;</a>
               </div>
             </div>`
          : ""
      }
    </div>

    <div class="card" id="contactsCard">
      <span class="pill">Recommended</span>
      <h2 style="margin-top:8px;">Contacts (${params.contactCount} Synced)</h2>
      <div class="grid-2" style="align-items:start;">
        <div>
          <ul style="margin:0 0 14px 18px;color:var(--muted);display:flex;flex-direction:column;gap:4px;">
            <li><strong>${params.contactCount}</strong> contact(s) currently synced.</li>
            <li><strong>On iPhone:</strong> Contacts &rarr; <strong>&lt; Lists</strong> (top-left) &rarr; press &amp; hold <em>All Contacts</em> &rarr; <strong>Export</strong> &rarr; Save to Files.</li>
            <li><em>Optional:</em> Auto-Sync already pulls your 10 most recent contacts automatically.</li>
          </ul>
          <div class="dropzone" id="vcfDrop">
            <strong>Drop <code>Contacts.vcf</code> here</strong> or tap to pick from Files
            <input type="file" id="vcfInput" accept=".vcf,text/vcard" style="display:none" />
          </div>
          <p id="vcfStatus" style="margin-top:10px;font-weight:600"></p>
          <form method="POST" action="/api/contacts/add" class="row" style="margin-top:12px">
            <input type="hidden" name="csrf" value="${esc(params.csrfToken)}" />
            <input name="name" type="text" placeholder="Quick add name" required style="flex:1;min-width:130px" />
            <input name="phone" type="text" placeholder="Phone number" required style="flex:1;min-width:140px" />
            <button class="btn" type="submit">Add Contact</button>
          </form>
        </div>
        <div>
          ${CONTACTS_ANIM_HTML}
        </div>
      </div>
    </div>

    <div class="card">
      <span class="pill">Shortcut &amp; AI Keys</span>
      <h2 style="margin-top:8px;">Quick Access</h2>
      <div class="grid-2">
        <div>
          <label style="margin-top:0;">Worker URL</label>
          <div class="row">
            <div class="code-box" id="dashWorkerUrl">${esc(params.origin)}</div>
            <button class="btn" type="button" onclick="copyText('dashWorkerUrl')">Copy</button>
          </div>
          <label>Shortcut API Key</label>
          ${
            params.freshApiKey
              ? `<div class="row">
                   <div class="code-box" id="dashApiKey">${esc(params.freshApiKey)}</div>
                   <button class="btn btn-primary" type="button" onclick="copyText('dashApiKey')">Copy Key</button>
                 </div>`
              : `<div class="row" style="justify-content:space-between;">
                   <div class="code-box">Saved (${esc(params.config.api_key_prefix)})</div>
                   <form method="POST" action="/api/rotate-key" style="margin:0"><input type="hidden" name="csrf" value="${esc(params.csrfToken)}" /><button class="btn" type="submit">Reveal New Key</button></form>
                 </div>`
          }
        </div>
        <div>
          <label style="margin-top:0;">Remote MCP URL</label>
          <div class="row" style="margin-bottom:10px;">
            <div class="code-box" id="mcpUrl">${esc(mcpUrl)}</div>
            <button class="btn" type="button" onclick="copyText('mcpUrl')">Copy URL</button>
          </div>
          <div class="row">
            <a class="btn btn-primary" href="${claudeLaunchUrl}" target="_blank" rel="noopener">Open in Claude &rarr;</a>
            <a class="btn" href="${chatgptLaunchUrl}" target="_blank" rel="noopener">Open in ChatGPT &rarr;</a>
            <a class="btn" href="${grokLaunchUrl}" target="_blank" rel="noopener">Open in Grok &rarr;</a>
          </div>
        </div>
      </div>
    </div>

    <details style="margin-top:16px;">
      <summary class="btn" style="margin-bottom:14px;">Advanced: Endpoints &amp; Settings</summary>

      <div class="card">
        <h2>Guardrails &amp; Allowlist</h2>
        <form method="POST" action="/api/settings" class="grid-2" style="margin-bottom:16px">
          <input type="hidden" name="csrf" value="${esc(params.csrfToken)}" />
          <div>
            <label for="hourly_send_cap">Max Outbound Texts / Hour</label>
            <input id="hourly_send_cap" name="hourly_send_cap" type="number" min="1" max="100" value="${params.config.hourly_send_cap}" />
          </div>
          <div style="display:flex;flex-direction:column;justify-content:flex-end;gap:6px">
            <label style="margin:0;font-weight:400"><input type="checkbox" name="allowlist_only" value="1" ${params.config.allowlist_only ? "checked" : ""} /> Block sends outside allowlist</label>
            <label style="margin:0;font-weight:400"><input type="checkbox" name="require_approval_default" value="1" ${params.config.require_approval_default ? "checked" : ""} /> Require iPhone tap approval by default</label>
            <button class="btn btn-primary" type="submit" style="margin-top:6px;width:fit-content">Save Guardrails</button>
          </div>
        </form>
        <form method="POST" action="/api/allowlist/add" class="row" style="margin-bottom:12px">
          <input type="hidden" name="csrf" value="${esc(params.csrfToken)}" />
          <select name="target_type" style="width:auto"><option value="phone">Phone</option><option value="chat">Group / Chat Title</option></select>
          <input name="target_value" type="text" placeholder="+15551234567 or Family Chat" required style="flex:1;min-width:180px" />
          <input name="label" type="text" placeholder="Label (optional)" style="width:160px" />
          <button class="btn" type="submit">Add</button>
        </form>
        ${allowRows || "<p>No allowlist entries yet.</p>"}
      </div>

      <div class="card">
        <h2>Connected AI Clients (OAuth 2.1)</h2>
        ${grantRows}
        <hr style="border:none;border-top:1px solid var(--border);margin:16px 0" />
        <form method="POST" action="/api/mcp-bearer" class="row" style="justify-content:space-between">
          <input type="hidden" name="csrf" value="${esc(params.csrfToken)}" />
          <div style="font-size:.9rem;color:var(--muted)">Optional Static MCP Bearer Fallback (for CLI / Grok API): <strong>${params.config.mcp_bearer_enabled ? "Enabled" : "Disabled"}</strong></div>
          <div class="row">
            <button class="btn" name="action" value="generate" type="submit">Generate / Enable</button>
            ${params.config.mcp_bearer_enabled ? `<button class="btn btn-danger" name="action" value="disable" type="submit">Disable</button>` : ""}
          </div>
        </form>
      </div>
    </details>
    </div>

    <script>
      var wizStep = 1;
      var wizGoal = 'both';
      var wizAis = { claude: true, chatgpt: false, grok: false };
      var wizDoneKey = 'ath_setup_done_' + ${JSON.stringify(params.config.id)};
      var wizLabels = {
        1: 'Choose Your Goal',
        2: 'Pick Your AI',
        3: 'Add iPhone Shortcut',
        4: 'Set Messages Automation',
        5: 'Connect Your AI',
        6: 'All Set!'
      };
      function pickGoal(g, el) {
        wizGoal = g;
        document.querySelectorAll('[data-goal]').forEach(function(b){ b.classList.remove('selected'); });
        el.classList.add('selected');
      }
      function toggleAi(ai, el) {
        wizAis[ai] = !wizAis[ai];
        if (!wizAis.claude && !wizAis.chatgpt && !wizAis.grok) { wizAis[ai] = true; return; }
        el.classList.toggle('selected', wizAis[ai]);
      }
      function renderAiStep() {
        var box = document.getElementById('wizAiInstructions');
        if (!box) return;
        var html = '<ul style="margin:0 0 8px 18px;color:var(--muted);display:flex;flex-direction:column;gap:6px;">';
        if (wizAis.claude) html += '<li><strong>Claude:</strong> Settings &rarr; Connectors &rarr; Add Custom Connector &rarr; Name it anything (e.g. <code>Texting</code>), leave Auth on <strong>Detected</strong>, ignore Headers &rarr; <strong>Add</strong> &rarr; <strong>Approve Connection</strong>.</li>';
        if (wizAis.chatgpt) html += '<li><strong>ChatGPT:</strong> Settings &rarr; Apps &rarr; Developer Mode ON &rarr; Create App &rarr; paste MCP URL &rarr; <strong>Approve Connection</strong>.</li>';
        if (wizAis.grok) html += '<li><strong>Grok:</strong> <code>grok.com/connectors</code> &rarr; New Connector &rarr; Custom &rarr; paste MCP URL &rarr; <strong>Approve Connection</strong>.</li>';
        html += '</ul>';
        box.innerHTML = html;
        document.querySelectorAll('[data-ai-btn]').forEach(function(b){
          b.style.display = wizAis[b.getAttribute('data-ai-btn')] ? 'inline-flex' : 'none';
        });
      }
      function showWizStep(s) {
        wizStep = Math.max(1, Math.min(6, s));
        document.querySelectorAll('.wiz-pane').forEach(function(p){
          p.style.display = Number(p.getAttribute('data-step')) === wizStep ? 'block' : 'none';
        });
        document.getElementById('wizStepPill').textContent = 'Step ' + wizStep + ' of 6';
        document.getElementById('wizStepLabel').textContent = wizLabels[wizStep] || '';
        document.getElementById('wizProgBar').style.width = ((wizStep / 6) * 100) + '%';
        document.getElementById('wizBackBtn').style.visibility = wizStep > 1 ? 'visible' : 'hidden';
        document.getElementById('wizNextBtn').textContent = wizStep === 6 ? 'Go to Dashboard \u2192' : 'Next \u2192';
        if (wizStep === 5) renderAiStep();
      }
      function wizNav(dir) {
        if (dir === 1 && wizStep === 6) { finishSetup(false); return; }
        var next = wizStep + dir;
        if (wizGoal === 'autodraft' && next === 2) next = dir > 0 ? 3 : 1;
        if (wizGoal === 'autodraft' && next === 5) next = dir > 0 ? 6 : 4;
        showWizStep(next);
      }
      function finishSetup(scrollContacts) {
        try { localStorage.setItem(wizDoneKey, '1'); } catch (e) {}
        document.getElementById('setupWizard').style.display = 'none';
        document.getElementById('simpleDash').style.display = 'block';
        document.getElementById('toggleGuideBtn').textContent = 'Setup Guide';
        if (scrollContacts) {
          var c = document.getElementById('contactsCard');
          if (c) c.scrollIntoView({ behavior: 'smooth' });
        }
      }
      function toggleSetupMode() {
        var w = document.getElementById('setupWizard');
        var d = document.getElementById('simpleDash');
        var btn = document.getElementById('toggleGuideBtn');
        var showingWiz = w.style.display !== 'none';
        if (showingWiz) {
          finishSetup(false);
        } else {
          w.style.display = 'block';
          d.style.display = 'none';
          btn.textContent = 'Skip to Dashboard';
          showWizStep(1);
        }
      }
      try {
        if (localStorage.getItem(wizDoneKey) === '1' && document.getElementById('setupWizard').style.display !== 'none') {
          finishSetup(false);
        }
      } catch (e) {}
      function copyText(id) {
        const el = document.getElementById(id);
        if (!el) return;
        navigator.clipboard.writeText(el.textContent.trim()).then(() => {
          const orig = el.style.outline;
          el.style.outline = '2px solid var(--accent)';
          setTimeout(() => el.style.outline = orig, 700);
        });
      }
      const drop = document.getElementById('vcfDrop');
      const input = document.getElementById('vcfInput');
      const status = document.getElementById('vcfStatus');
      const csrf = ${JSON.stringify(params.csrfToken)};
      drop.onclick = () => input.click();
      drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
      drop.ondragleave = () => drop.classList.remove('over');
      drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) uploadVcf(e.dataTransfer.files[0]); };
      input.onchange = () => { if (input.files[0]) uploadVcf(input.files[0]); };
      async function uploadVcf(file) {
        status.textContent = 'Uploading & parsing ' + file.name + '...';
        const text = await file.text();
        const res = await fetch('/api/contacts/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'text/vcard', 'X-CSRF-Token': csrf },
          body: text
        });
        const data = await res.json();
        status.textContent = data.ok ? ('Imported ' + data.imported + ' contact number(s)!') : ('Error: ' + (data.error || 'Upload failed'));
      }
    </script>
    `
  );
}
