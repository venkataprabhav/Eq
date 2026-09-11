import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Universal EQ",
  version: "0.1.0",
  description:
    "Detect browser audio, read track metadata, and apply a parametric EQ at the page output.",
  icons: {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png",
  },
  action: {
    default_title: "Universal EQ",
    default_popup: "index.html",
    default_icon: {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png",
    },
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  permissions: ["storage", "tabs", "scripting"],
  host_permissions: ["<all_urls>", "http://127.0.0.1:8787/*", "http://localhost:8787/*"],
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/index.ts"],
      all_frames: false,
      run_at: "document_idle",
    },
  ],
});
