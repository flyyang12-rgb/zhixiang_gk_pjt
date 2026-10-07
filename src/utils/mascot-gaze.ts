export type Point = { x: number; y: number }

/** A bounded gaze vector that eases away from the center without a hard edge. */
export function gazeDirection(pointer: Point, eye: Point): Point {
  const dx = pointer.x - eye.x
  const dy = pointer.y - eye.y
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { x: 0, y: 0 }
  const distance = Math.hypot(dx, dy, 120)
  return { x: dx / distance, y: dy / distance }
}
