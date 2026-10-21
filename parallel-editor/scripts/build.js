'use strict';
const esbuild = require('esbuild');
const path = require('path');

esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', 'src', 'renderer', 'app.js')],
  bundle: true,
  outfile: path.join(__dirname, '..', 'dist', 'renderer.js'),
  platform: 'browser',
  target: 'chrome120',
  sourcemap: true,
  logLevel: 'info',
});
