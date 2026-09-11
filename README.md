# Universal EQ

Cross-platform, Rust-first equalization. See [techstack+plan.md](techstack+plan.md).

The first shipped surface is a Chrome extension that equalizes tab media and reads track metadata. System-wide Windows EQ remains the Rust milestone.

## Chrome extension

```bash
cd apps/chrome-extension
npm install
npm run build
```

Load `apps/chrome-extension/dist` as an unpacked extension in `chrome://extensions`.
