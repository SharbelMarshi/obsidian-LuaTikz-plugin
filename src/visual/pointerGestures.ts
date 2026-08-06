/**
 * Pointer-event routing for the drawing canvas.
 *
 * One state machine handles mouse, touch, and pen through Pointer Events —
 * there are no separate mouse-only or touch-only engines. The host owns the
 * actual tool behavior; this class only decides which gesture each pointer
 * belongs to and keeps the transitions safe:
 *
 * - Pen always draws and takes priority: a pen-down cancels any touch gesture,
 *   and touch contacts while the pen is down (or shortly after it lifts) are
 *   ignored entirely — practical palm rejection, not an OS-level guarantee.
 * - With Finger Draw off, one finger pans and two fingers pinch-zoom.
 * - With Finger Draw on, one finger uses the active tool; a second finger
 *   safely cancels the unfinished stroke and transitions into pinch.
 * - Middle-mouse drag pans regardless of tool; right-click is left alone so
 *   context menus keep working.
 */

export interface PointerLike {
	pointerId: number;
	pointerType: string;
	clientX: number;
	clientY: number;
	button?: number;
	isPrimary?: boolean;
	pressure?: number;
	shiftKey?: boolean;
}

export interface GestureHost {
	onToolStart(pointer: PointerLike): void;
	onToolMove(pointer: PointerLike): void;
	onToolEnd(pointer: PointerLike): void;
	/** The active stroke must be discarded without committing. */
	onToolCancel(): void;
	onPanStart(pointer: PointerLike): void;
	onPanMove(pointer: PointerLike): void;
	onPanEnd(): void;
	onPinchStart(a: PointerLike, b: PointerLike): void;
	onPinchMove(a: PointerLike, b: PointerLike): void;
	onPinchEnd(): void;
	capturePointer(pointerId: number): void;
	releasePointer(pointerId: number): void;
}

export interface GestureConfig {
	/** One-finger touch draws with the active tool instead of panning. */
	fingerDraw(): boolean;
	/** The active tool is the Pan tool (primary drag pans). */
	panToolActive(): boolean;
}

export type GestureMode = 'idle' | 'tool' | 'pan' | 'pinch';

/** Touch contacts arriving this soon after a pen lift are treated as palm. */
export const PEN_PALM_WINDOW_MS = 500;

export class GestureRouter {
	mode: GestureMode = 'idle';
	private toolPointerId: number | null = null;
	private toolPointerType = '';
	private panPointerId: number | null = null;
	private pinchIds: [number, number] | null = null;
	private readonly touchPoints = new Map<number, PointerLike>();
	private penDown = false;
	private lastPenUp = Number.NEGATIVE_INFINITY;

	constructor(
		private readonly host: GestureHost,
		private readonly config: GestureConfig,
	) {}

	/** True when a touch contact should be ignored as a resting palm. */
	private isPalmContact(now: number): boolean {
		return this.penDown || now - this.lastPenUp < PEN_PALM_WINDOW_MS;
	}

	handlePointerDown(pointer: PointerLike, now = Date.now()): void {
		const type = pointer.pointerType;

		if (type === 'pen') {
			this.penDown = true;
			this.abortTouchGestures();
			this.startTool(pointer);
			return;
		}

		if (type === 'touch') {
			if (this.isPalmContact(now)) {
				return;
			}
			this.touchPoints.set(pointer.pointerId, pointer);

			if (this.mode === 'idle') {
				if (this.config.fingerDraw() && !this.config.panToolActive()) {
					this.startTool(pointer);
				} else {
					this.startPan(pointer);
				}
				return;
			}
			if (this.mode === 'tool' && this.toolPointerType === 'touch') {
				const first = this.toolPointerId;
				this.host.onToolCancel();
				if (first !== null) {
					this.host.releasePointer(first);
				}
				this.toolPointerId = null;
				this.startPinchFromTouches();
				return;
			}
			if (this.mode === 'pan' && this.panPointerId !== null) {
				this.host.onPanEnd();
				this.startPinchFromTouches();
				return;
			}
			// Third finger, or touch during a pen/mouse gesture: ignored.
			return;
		}

		// Mouse / trackpad.
		if (pointer.button === 2) {
			return;
		}
		if (this.mode !== 'idle') {
			return;
		}
		if (pointer.button === 1 || this.config.panToolActive()) {
			this.startPan(pointer);
			return;
		}
		if (pointer.button === 0 || pointer.button === undefined) {
			this.startTool(pointer);
		}
	}

	handlePointerMove(pointer: PointerLike): void {
		if (pointer.pointerType === 'touch') {
			if (!this.touchPoints.has(pointer.pointerId) && this.toolPointerId !== pointer.pointerId) {
				return;
			}
			this.touchPoints.set(pointer.pointerId, pointer);
		}

		if (this.mode === 'tool' && pointer.pointerId === this.toolPointerId) {
			this.host.onToolMove(pointer);
			return;
		}
		if (this.mode === 'pan' && pointer.pointerId === this.panPointerId) {
			this.host.onPanMove(pointer);
			return;
		}
		if (this.mode === 'pinch' && this.pinchIds) {
			const [a, b] = this.pinchIds;
			if (pointer.pointerId === a || pointer.pointerId === b) {
				const pointA = this.touchPoints.get(a);
				const pointB = this.touchPoints.get(b);
				if (pointA && pointB) {
					this.host.onPinchMove(pointA, pointB);
				}
			}
		}
	}

	handlePointerUp(pointer: PointerLike, now = Date.now()): void {
		if (pointer.pointerType === 'pen') {
			this.penDown = false;
			this.lastPenUp = now;
		}
		this.touchPoints.delete(pointer.pointerId);

		if (this.mode === 'tool' && pointer.pointerId === this.toolPointerId) {
			this.host.onToolEnd(pointer);
			this.host.releasePointer(pointer.pointerId);
			this.toolPointerId = null;
			this.mode = 'idle';
			return;
		}
		if (this.mode === 'pan' && pointer.pointerId === this.panPointerId) {
			this.host.onPanEnd();
			this.host.releasePointer(pointer.pointerId);
			this.panPointerId = null;
			this.mode = 'idle';
			return;
		}
		if (this.mode === 'pinch' && this.pinchIds) {
			const [a, b] = this.pinchIds;
			if (pointer.pointerId !== a && pointer.pointerId !== b) {
				return;
			}
			this.host.onPinchEnd();
			this.host.releasePointer(a);
			this.host.releasePointer(b);
			this.pinchIds = null;
			this.mode = 'idle';
			// The remaining finger keeps panning so the gesture stays smooth.
			const remainingId = pointer.pointerId === a ? b : a;
			const remaining = this.touchPoints.get(remainingId);
			if (remaining) {
				this.startPan(remaining);
			}
		}
	}

	handlePointerCancel(pointer: PointerLike, now = Date.now()): void {
		if (pointer.pointerType === 'pen') {
			this.penDown = false;
			this.lastPenUp = now;
		}
		this.touchPoints.delete(pointer.pointerId);

		if (this.mode === 'tool' && pointer.pointerId === this.toolPointerId) {
			this.host.onToolCancel();
			this.host.releasePointer(pointer.pointerId);
			this.toolPointerId = null;
			this.mode = 'idle';
			return;
		}
		this.handlePointerUp(pointer, now);
	}

	/** Cancel whatever is in flight (Escape, mode exit, teardown). */
	cancelActive(): void {
		if (this.mode === 'tool') {
			this.host.onToolCancel();
			if (this.toolPointerId !== null) {
				this.host.releasePointer(this.toolPointerId);
			}
		} else if (this.mode === 'pan') {
			this.host.onPanEnd();
			if (this.panPointerId !== null) {
				this.host.releasePointer(this.panPointerId);
			}
		} else if (this.mode === 'pinch' && this.pinchIds) {
			this.host.onPinchEnd();
			this.host.releasePointer(this.pinchIds[0]);
			this.host.releasePointer(this.pinchIds[1]);
		}
		this.toolPointerId = null;
		this.panPointerId = null;
		this.pinchIds = null;
		this.touchPoints.clear();
		this.mode = 'idle';
	}

	private startTool(pointer: PointerLike): void {
		this.mode = 'tool';
		this.toolPointerId = pointer.pointerId;
		this.toolPointerType = pointer.pointerType;
		this.host.capturePointer(pointer.pointerId);
		this.host.onToolStart(pointer);
	}

	private startPan(pointer: PointerLike): void {
		this.mode = 'pan';
		this.panPointerId = pointer.pointerId;
		this.host.capturePointer(pointer.pointerId);
		this.host.onPanStart(pointer);
	}

	private startPinchFromTouches(): void {
		const ids = [...this.touchPoints.keys()];
		if (ids.length < 2) {
			this.mode = 'idle';
			this.panPointerId = null;
			return;
		}
		const a = ids[ids.length - 2];
		const b = ids[ids.length - 1];
		this.pinchIds = [a, b];
		this.mode = 'pinch';
		this.panPointerId = null;
		this.host.capturePointer(a);
		this.host.capturePointer(b);
		const pointA = this.touchPoints.get(a);
		const pointB = this.touchPoints.get(b);
		if (pointA && pointB) {
			this.host.onPinchStart(pointA, pointB);
		}
	}

	private abortTouchGestures(): void {
		if (this.mode === 'tool' && this.toolPointerType === 'touch') {
			this.host.onToolCancel();
			if (this.toolPointerId !== null) {
				this.host.releasePointer(this.toolPointerId);
			}
			this.toolPointerId = null;
			this.mode = 'idle';
		} else if (this.mode === 'pan') {
			this.host.onPanEnd();
			if (this.panPointerId !== null) {
				this.host.releasePointer(this.panPointerId);
			}
			this.panPointerId = null;
			this.mode = 'idle';
		} else if (this.mode === 'pinch' && this.pinchIds) {
			this.host.onPinchEnd();
			this.host.releasePointer(this.pinchIds[0]);
			this.host.releasePointer(this.pinchIds[1]);
			this.pinchIds = null;
			this.mode = 'idle';
		}
		this.touchPoints.clear();
	}
}
