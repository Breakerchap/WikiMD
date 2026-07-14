"use strict";

const esbuild = require("esbuild");

esbuild.build({
  entryPoints: ["web/client/collab-editor.js"],
  bundle: true,
  format: "iife",
  globalName: "WmdCollaborativeEditor",
  outfile: "web/public/wmd-collab.bundle.js",
  target: ["es2020"],
  sourcemap: true,
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
