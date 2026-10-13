#!/usr/bin/env node
// Prepare against a fresh, disposable schema so local database drift cannot hide stale SQL.
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const check = process.argv.slice(2);
if (check.length > 1 || (check.length === 1 && check[0] !== '--check')) {
  throw new Error('Usage: node scripts/sqlx-prepare.mjs [--check]');
}
const baseUrl = process.env.TEST_DATABASE_URL;
if (!baseUrl) {
  throw new Error('Set TEST_DATABASE_URL to a disposable PostgreSQL server with CREATE DATABASE permission.');
}
const url = new URL(baseUrl);
if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
  throw new Error('TEST_DATABASE_URL must be a PostgreSQL URL.');
}
url.pathname = `/touhouflandre_sqlx_${randomUUID().replaceAll('-', '')}`;
const cwd = fileURLToPath(new URL('..', import.meta.url));
const env = { ...process.env, DATABASE_URL: url.href, SQLX_OFFLINE: 'false' };

function run(args) {
  const result = spawnSync('cargo', ['sqlx', ...args], { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`cargo sqlx ${args[0]} failed (${result.status ?? result.signal}).`);
}

// Fail before creating a database if the CLI and the pinned SQLx crate differ.
const version = spawnSync('cargo', ['sqlx', '--version'], { cwd, encoding: 'utf8' });
if (version.status !== 0 || !/^sqlx-cli(?:-sqlx)? 0\.9\.0\s*$/.test(version.stdout.trim())) {
  throw new Error('Install sqlx-cli 0.9.0: cargo install sqlx-cli --version 0.9.0 --locked --no-default-features --features postgres,rustls');
}

let created = false;
try {
  run(['database', 'create']);
  created = true;
  run(['migrate', 'run', '--source', 'apps/api/db/migrations']);
  run(['prepare', '--workspace', ...check, '--', '--all-targets', '--locked']);
} finally {
  if (created) run(['database', 'drop', '-y']);
}
