// @ts-check
// Shared look editor: skin, hair, style, height, build. Used by New Run and Settings.
import { SKIN_TONES, HAIR_COLORS, HAIR_STYLES, DEFAULT_APPEARANCE } from '../../data/cast/player.js';
import { settings, setSetting } from '../core/settings.js';
import { h } from './widgets.js';

const STYLE_LABELS = {
  short: 'Short', bob: 'Bob', long: 'Long',
  undercut: 'Undercut', ponytail: 'Ponytail', slick: 'Slick', pixie: 'Pixie',
};

function currentLook() {
  return { ...DEFAULT_APPEARANCE, ...(settings.appearance || {}) };
}

function buildWord(b) {
  if (b < 0.95) return 'slight';
  if (b < 1.08) return 'average';
  return 'solid';
}

/** Persist the whole appearance object. */
export function saveAppearance(look) {
  const next = { ...currentLook(), ...look };
  setSetting('appearance', next);
  return next;
}

/**
 * @param {{live?:boolean}} [opts] live writes each change (Settings tab)
 * @returns {{el:HTMLElement, read:() => typeof DEFAULT_APPEARANCE}}
 */
export function appearanceBlock(opts = {}) {
  const live = !!opts.live;
  const state = currentLook();

  const persist = () => { if (live) saveAppearance(state); };

  /** @param {string[]} colors @param {string} key */
  const swatches = (colors, key) => {
    const row = h('div', { class: 'look-swatches' }, colors.map((c) =>
      h('button', {
        type: 'button',
        class: `look-swatch${state[key] === c ? ' sel' : ''}`,
        style: `background:${c}`,
        title: c,
        onclick: (e) => {
          state[key] = c;
          row.querySelectorAll('.look-swatch').forEach((b) =>
            b.classList.toggle('sel', b === e.currentTarget));
          persist();
        },
      })));
    return row;
  };

  const styleRow = h('div', { class: 'look-styles' }, HAIR_STYLES.map((id) =>
    h('button', {
      type: 'button',
      class: state.hairStyle === id ? 'active' : '',
      'data-style': id,
      onclick: (e) => {
        state.hairStyle = id;
        styleRow.querySelectorAll('button').forEach((b) =>
          b.classList.toggle('active', b === e.currentTarget));
        persist();
      },
    }, [STYLE_LABELS[id] || id])));

  const heightVal = h('span', { class: 'look-val' }, [`${Math.round(state.height * 100)} cm`]);
  const height = h('input', {
    class: 'look-slider', type: 'range', min: '1.60', max: '1.92', step: '0.01',
    value: String(state.height),
    oninput: (e) => {
      state.height = Number(e.target.value);
      heightVal.textContent = `${Math.round(state.height * 100)} cm`;
      persist();
    },
  });

  const buildVal = h('span', { class: 'look-val' }, [buildWord(state.build)]);
  const build = h('input', {
    class: 'look-slider', type: 'range', min: '0.85', max: '1.25', step: '0.01',
    value: String(state.build),
    oninput: (e) => {
      state.build = Number(e.target.value);
      buildVal.textContent = buildWord(state.build);
      persist();
    },
  });

  const el = h('div', { class: 'look-block' }, [
    h('h2', {}, ['your look']),
    h('div', { class: 'row' }, [h('label', {}, ['Skin']), swatches(SKIN_TONES, 'skin')]),
    h('div', { class: 'row' }, [h('label', {}, ['Hair']), swatches(HAIR_COLORS, 'hair')]),
    h('div', { class: 'row' }, [h('label', {}, ['Style']), styleRow]),
    h('div', { class: 'row' }, [h('label', {}, ['Height']), height, heightVal]),
    h('div', { class: 'row' }, [h('label', {}, ['Build']), build, buildVal]),
  ]);

  return {
    el,
    read: () => ({
      skin: state.skin,
      hair: state.hair,
      hairStyle: state.hairStyle,
      height: state.height,
      build: state.build,
    }),
  };
}
