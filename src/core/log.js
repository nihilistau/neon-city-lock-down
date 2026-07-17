// @ts-check
// Activity feed ring buffer + debug logging.
// Feed entries are what the Director panel's activity feed shows.
import { emit } from './bus.js';

const CAP = 250;

/** @typedef {{t:number, kind:string, text:string}} FeedEntry */

/** @type {FeedEntry[]} */
export const feedEntries = [];

/**
 * Add an entry to the activity feed.
 * @param {string} text
 * @param {string} [kind]  'info'|'dialogue'|'stat'|'gate'|'event'|'combat'|'system'
 */
export function feed(text, kind = 'info') {
  const entry = { t: Date.now(), kind, text };
  feedEntries.push(entry);
  if (feedEntries.length > CAP) feedEntries.shift();
  emit('feed.entry', entry);
}

let debugEnabled = false;
export function setDebugLogging(v) { debugEnabled = v; }

/** Console logging that stays quiet unless ?debug=1. */
export function dbg(...args) {
  if (debugEnabled) console.log('[ncld]', ...args);
}
