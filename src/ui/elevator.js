// @ts-check
// Elevator floor picker + ride transition for the player. Rides advance the
// world clock by travel time and move the camera to the destination lobby.
import { FLOORS } from '../../data/zones.js';
import { elevatorPos, travelMinutes } from '../sim/actors/nav.js';
import { emit } from '../core/bus.js';
import { feed } from '../core/log.js';

export class ElevatorUI {
  /** @param {import('../core/app.js').App} app */
  constructor(app) {
    this.app = app;
    this.riding = false;
    // black fade overlay
    this.fade = document.createElement('div');
    this.fade.id = 'elevator-fade';
    this.fade.style.cssText =
      'position:absolute;inset:0;background:#000;opacity:0;transition:opacity 0.5s;pointer-events:none;z-index:48';
    document.getElementById('ui').appendChild(this.fade);
  }

  /** open the floor picker (called by the elevator prop interaction) */
  openPicker() {
    if (this.riding) return;
    const app = this.app;
    const current = app.world.activeFloor;
    const options = Object.values(FLOORS).filter((f) => f.id !== current);
    emit('event.choice', {
      prompt: `Elevator — currently on ${FLOORS[current].label}. Where to?`,
      options: options.map((f) => f.label),
      pick: (idx) => this.ride(options[idx].id),
    });
  }

  /** @param {string} destFloor */
  async ride(destFloor) {
    const app = this.app;
    if (this.riding || destFloor === app.world.activeFloor) return;
    this.riding = true;
    const fromFloor = app.world.activeFloor;
    const mins = travelMinutes(fromFloor, destFloor);

    this.fade.style.pointerEvents = 'auto';
    this.fade.style.opacity = '1';
    app.audioFacade().sfx('door_servo');
    await new Promise((r) => setTimeout(r, 600));
    app.audioFacade().sfx('elevator_ding');

    // clock advances for the ride; world keeps simulating
    app.clock.skip(mins, (c) => app.worldTick.minute(c));

    // relocate player + camera
    const [ex, ez] = elevatorPos(destFloor);
    app.world.setActiveFloor(destFloor);
    app.lighting.setFloorOffset(FLOORS[destFloor].offsetX);
    app.cameraRig.fp.pos.set(ex, 1.62, ez + 0.6);
    app.cameraRig.fp.yaw = Math.PI;
    app.cameraRig.orbit.target.set(ex, 1.1, ez + 1.5);
    app.cameraRig.camera.position.set(ex + 3, 2.6, ez + 4.5);
    // The avatar's transform is only written by FirstPersonControls.update(), which
    // the rig calls in firstPerson/thirdPerson modes only. Riding in auto/director
    // otherwise left the body — and playerMarker, which combat spawn checks, cast
    // gaze and the director camera all key off — on the old floor, up to 1200
    // world units away.
    app.playerActor?.root.position.set(ex, 0, ez + 0.6);
    app.playerMarker?.position.set(ex, 1.1, ez + 0.6);
    app.setAmbienceForFloor(destFloor);
    emit('floor.changed', { floor: destFloor, from: fromFloor });
    feed(`Elevator: ${FLOORS[destFloor].label}.`, 'system');

    await new Promise((r) => setTimeout(r, 350));
    this.fade.style.opacity = '0';
    this.fade.style.pointerEvents = 'none';
    this.riding = false;
  }
}
