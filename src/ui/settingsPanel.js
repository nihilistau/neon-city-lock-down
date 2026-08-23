// @ts-check
// The settings surface. ONE definition, rendered by both the main menu and the
// in-game pause screen.
//
// Before this, volume, explicitness, mouse sensitivity, subtitles and the
// auto-camera existed only inside the debug Director drawer — beside god-mode
// stat sliders — and the main-menu Settings screen said "Volumes and the rest
// live in-game under Esc", which was simply false. A player who never found the
// backtick key could not change the volume of an adults-only game, or its
// explicitness cap.
//
// Graphics had no control anywhere: the game ships a full post-FX stack (bloom,
// AO, soft shadows, grain, FOV) and offered no way to turn any of it down on a
// machine that could not afford it.
import { settings, setSetting, saveSettings } from '../core/settings.js';
import { cfg, applyConfig } from '../core/config.js';
import { h } from './widgets.js';
import { emit } from '../core/bus.js';

const EXPLICIT = ['suggestive', 'mature', 'full'];
const VOLUMES = [
  ['master', 'Master'], ['music', 'Music'], ['sfx', 'Effects'],
  ['ambience', 'Ambience'], ['voice', 'Voice'], ['ui', 'Interface'],
];
const SHADOWS = ['off', 'hard', 'soft'];

/** A labelled row. `label` becomes the control's accessible name. */
function row(label, control, hint) {
  const id = `set-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  control.id = id;
  return h('div', { class: 'set-row' }, [
    h('label', { class: 'set-label', for: id }, [label]),
    control,
    hint ? h('span', { class: 'set-hint' }, [hint]) : '',
  ]);
}

function slider(value, min, max, step, onInput, ariaLabel) {
  const el = h('input', {
    type: 'range', min: String(min), max: String(max), step: String(step),
    value: String(value), 'aria-label': ariaLabel,
  });
  el.addEventListener('input', (e) => onInput(Number(/** @type {HTMLInputElement} */(e.target).value)));
  return el;
}

function segmented(options, current, onPick, groupLabel) {
  return h('div', { class: 'set-seg', role: 'radiogroup', 'aria-label': groupLabel },
    options.map(([val, label]) => {
      const b = h('button', {
        class: `set-seg-btn ${current === val ? 'sel' : ''}`,
        role: 'radio', 'aria-checked': current === val ? 'true' : 'false',
      }, [label]);
      b.addEventListener('click', () => onPick(val));
      return b;
    }));
}

/**
 * Build the settings body. Re-renders itself in place on any change so the
 * segmented controls reflect the new state.
 * @param {() => void} rerender
 * @returns {HTMLElement[]}
 */
export function settingsBody(rerender) {
  const pick = (key, val) => { setSetting(key, val); saveSettings(); rerender(); };

  // Graphics live in the CONFIG layer, not user settings, because the render
  // stack reads them through cfg(). applyConfig validates against the schema and
  // emits config.changed, which is what the live-reload path already listens to.
  const render = cfg('render', {});
  const setRender = (patch) => {
    const errs = applyConfig('render', patch);
    if (errs?.length) { emit('hud.alert', { text: errs[0], kind: 'warn' }); return; }
    emit('hud.alert', { text: 'Graphics applied — reload to rebuild the render stack.', kind: 'info' });
    rerender();
  };

  return [
    h('div', { class: 'dir-label' }, ['CONTENT']),
    row('Explicitness',
      segmented(EXPLICIT.map((x) => [x, x]), settings.explicitness,
        (v) => pick('explicitness', v), 'Explicitness cap'),
      'caps how far intimate scenes render'),

    h('div', { class: 'dir-label' }, ['AUDIO']),
    ...VOLUMES.map(([key, label]) => row(label,
      slider(settings.volumes[key] ?? 0.8, 0, 1, 0.05,
        (v) => { setSetting(`volumes.${key}`, v); saveSettings(); }, `${label} volume`),
      null)),

    h('div', { class: 'dir-label' }, ['CAMERA & TEXT']),
    row('Mouse look',
      slider(settings.mouseSensitivity ?? 1, 0.3, 2.5, 0.1,
        (v) => { setSetting('mouseSensitivity', v); saveSettings(); }, 'Mouse look sensitivity'),
      'first-person look speed'),
    row('Subtitles',
      slider(settings.subtitleScale ?? 1, 0.7, 1.6, 0.1,
        (v) => { setSetting('subtitleScale', v); saveSettings(); emit('settings.changed', settings); }, 'Subtitle size'),
      'text size'),
    row('Auto-camera',
      segmented([[true, 'on'], [false, 'off']], !!settings.autoCamera,
        (v) => pick('autoCamera', v), 'Cinematic auto-camera'),
      'frames combat, dialogue and events for you'),

    h('div', { class: 'dir-label' }, ['GRAPHICS']),
    row('Shadows',
      segmented(SHADOWS.map((x) => [x, x]), render.shadows ?? 'soft',
        (v) => setRender({ shadows: v }), 'Shadow quality'),
      'soft costs the most'),
    row('Ambient occlusion',
      segmented([[true, 'on'], [false, 'off']], render.ao?.enabled !== false,
        (v) => setRender({ ao: { enabled: v } }), 'Ambient occlusion'),
      'contact shadows — about 1.5ms a frame'),
    row('Bloom',
      slider(render.bloom?.strength ?? 0.42, 0, 1.2, 0.02,
        (v) => setRender({ bloom: { strength: v } }), 'Bloom strength'),
      'neon glow'),
    row('Film grain',
      slider(render.grain?.amount ?? 0.055, 0, 0.2, 0.005,
        (v) => setRender({ grain: { amount: v } }), 'Film grain amount'),
      null),
    row('Field of view',
      slider(render.fov ?? 55, 55, 100, 1,
        (v) => setRender({ fov: v }), 'Field of view'),
      'applies on reload'),
  ];
}
