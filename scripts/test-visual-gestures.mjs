/**
 * Pointer-gesture routing: mouse/touch/pen through one state machine.
 *
 * The invariants under test are the ones that hurt on real hardware when
 * broken: a second finger must cancel (not commit) an unfinished stroke, a
 * palm resting near an active pen must be ignored, and every captured
 * pointer must be released no matter how the gesture ends.
 */
import assert from 'node:assert/strict';
import { loadSrcModules } from './loadSrc.mjs';

const { gestures } = await loadSrcModules({ gestures: 'src/visual/pointerGestures.ts' });
const { GestureRouter, PEN_PALM_WINDOW_MS } = gestures;

function makeHost() {
	const log = [];
	const captured = new Set();
	const host = {
		onToolStart: p => log.push(`tool-start:${p.pointerId}`),
		onToolMove: p => log.push(`tool-move:${p.pointerId}`),
		onToolEnd: p => log.push(`tool-end:${p.pointerId}`),
		onToolCancel: () => log.push('tool-cancel'),
		onPanStart: p => log.push(`pan-start:${p.pointerId}`),
		onPanMove: p => log.push(`pan-move:${p.pointerId}`),
		onPanEnd: () => log.push('pan-end'),
		onPinchStart: (a, b) => log.push(`pinch-start:${a.pointerId},${b.pointerId}`),
		onPinchMove: (a, b) => log.push(`pinch-move:${a.pointerId},${b.pointerId}`),
		onPinchEnd: () => log.push('pinch-end'),
		capturePointer: id => { captured.add(id); log.push(`capture:${id}`); },
		releasePointer: id => { captured.delete(id); log.push(`release:${id}`); },
	};
	return { host, log, captured };
}

function makeRouter(overrides = {}) {
	const state = { fingerDraw: false, panTool: false, ...overrides };
	const { host, log, captured } = makeHost();
	const router = new GestureRouter(host, {
		fingerDraw: () => state.fingerDraw,
		panToolActive: () => state.panTool,
	});
	return { router, log, captured, state };
}

const mouse = (id, button = 0, x = 0, y = 0) =>
	({ pointerId: id, pointerType: 'mouse', button, clientX: x, clientY: y });
const touch = (id, x = 0, y = 0) =>
	({ pointerId: id, pointerType: 'touch', clientX: x, clientY: y });
const pen = (id, x = 0, y = 0) =>
	({ pointerId: id, pointerType: 'pen', clientX: x, clientY: y, pressure: 0.8 });

// --- mouse -------------------------------------------------------------------

{
	const { router, log, captured } = makeRouter();
	router.handlePointerDown(mouse(1));
	router.handlePointerMove(mouse(1, 0, 10, 10));
	router.handlePointerUp(mouse(1));
	assert.deepEqual(log, ['capture:1', 'tool-start:1', 'tool-move:1', 'tool-end:1', 'release:1']);
	assert.equal(captured.size, 0, 'pointer capture leaked');
	assert.equal(router.mode, 'idle');
}

// Middle button pans regardless of tool; right button is left alone.
{
	const { router, log } = makeRouter();
	router.handlePointerDown(mouse(1, 1));
	assert.ok(log.includes('pan-start:1'));
	router.handlePointerUp(mouse(1, 1));

	log.length = 0;
	router.handlePointerDown(mouse(2, 2));
	assert.deepEqual(log, [], 'right-click must not start a gesture');
}

// The Pan tool makes a primary drag pan.
{
	const { router, log } = makeRouter({ panTool: true });
	router.handlePointerDown(mouse(1));
	assert.ok(log.includes('pan-start:1'));
}

// --- touch with Finger Draw off ----------------------------------------------

{
	const { router, log, captured } = makeRouter({ fingerDraw: false });
	// One finger pans, never draws.
	router.handlePointerDown(touch(10));
	assert.ok(log.includes('pan-start:10'));
	assert.ok(!log.some(entry => entry.startsWith('tool-start')));

	// Second finger: pan ends, pinch begins with both.
	router.handlePointerDown(touch(11, 100, 0));
	assert.ok(log.includes('pan-end'));
	assert.ok(log.includes('pinch-start:10,11'));
	router.handlePointerMove(touch(11, 200, 0));
	assert.ok(log.some(entry => entry.startsWith('pinch-move')));

	// Lifting one finger ends the pinch; the survivor keeps panning.
	router.handlePointerUp(touch(10));
	assert.ok(log.includes('pinch-end'));
	assert.equal(router.mode, 'pan');
	router.handlePointerUp(touch(11));
	assert.equal(router.mode, 'idle');
	assert.equal(captured.size, 0, 'pointer capture leaked');
}

// --- touch with Finger Draw on -----------------------------------------------

{
	const { router, log } = makeRouter({ fingerDraw: true });
	router.handlePointerDown(touch(10));
	assert.ok(log.includes('tool-start:10'));

	// A second finger must CANCEL the stroke (not commit it) and pinch.
	router.handlePointerDown(touch(11, 80, 0));
	const cancelIndex = log.indexOf('tool-cancel');
	const pinchIndex = log.indexOf('pinch-start:10,11');
	assert.ok(cancelIndex >= 0, 'stroke was not cancelled');
	assert.ok(pinchIndex > cancelIndex, 'pinch must start after the cancel');
	assert.ok(!log.some(entry => entry.startsWith('tool-end')), 'stroke must not commit');
}

// --- stylus priority and palm rejection ----------------------------------------

{
	const { router, log } = makeRouter({ fingerDraw: false });
	// Pen down while a touch pan is active: pan aborts, pen draws.
	router.handlePointerDown(touch(10));
	router.handlePointerDown(pen(20), 1000);
	assert.ok(log.includes('pan-end'));
	assert.ok(log.includes('tool-start:20'));

	// A palm touching while the pen is down is ignored entirely.
	log.length = 0;
	router.handlePointerDown(touch(11), 1100);
	assert.deepEqual(log, [], 'palm contact must be ignored while pen is down');

	// Pen keeps drawing.
	router.handlePointerMove(pen(20, 5, 5));
	assert.ok(log.includes('tool-move:20'));
	router.handlePointerUp(pen(20), 1500);
	assert.ok(log.includes('tool-end:20'));

	// Touches shortly after pen lift are still palm.
	log.length = 0;
	router.handlePointerDown(touch(12), 1500 + PEN_PALM_WINDOW_MS - 50);
	assert.deepEqual(log, []);

	// After the window, touch input works again.
	router.handlePointerDown(touch(13), 1500 + PEN_PALM_WINDOW_MS + 50);
	assert.ok(log.includes('pan-start:13'));
}

// Pen cancels an in-progress finger-draw stroke too.
{
	const { router, log } = makeRouter({ fingerDraw: true });
	router.handlePointerDown(touch(10));
	router.handlePointerDown(pen(20), 2000);
	const cancelIndex = log.indexOf('tool-cancel');
	const penStart = log.indexOf('tool-start:20');
	assert.ok(cancelIndex >= 0 && penStart > cancelIndex);
}

// --- pointercancel and external cancellation -----------------------------------

{
	const { router, log, captured } = makeRouter();
	router.handlePointerDown(mouse(1));
	router.handlePointerCancel(mouse(1));
	assert.ok(log.includes('tool-cancel'));
	assert.ok(!log.some(entry => entry.startsWith('tool-end')));
	assert.equal(captured.size, 0);
	assert.equal(router.mode, 'idle');
}

{
	const { router, log, captured } = makeRouter({ fingerDraw: false });
	router.handlePointerDown(touch(10));
	router.handlePointerDown(touch(11));
	router.cancelActive(); // Escape / leaving edit mode mid-pinch.
	assert.ok(log.includes('pinch-end'));
	assert.equal(captured.size, 0, 'cancelActive leaked captures');
	assert.equal(router.mode, 'idle');
}

// Third finger is ignored.
{
	const { router, log } = makeRouter({ fingerDraw: false });
	router.handlePointerDown(touch(10));
	router.handlePointerDown(touch(11));
	log.length = 0;
	router.handlePointerDown(touch(12));
	assert.deepEqual(log, []);
}

console.log('visual-gestures: ok');
