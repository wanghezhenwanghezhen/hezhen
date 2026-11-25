// Seconds are measured after the last sheet panel has opened. The end tangent
// of the approach matches the speed of the orbit, including on slow displays.
export const boardShot = Object.freeze({
  seconds: 5.6,
  openingYaw: 0.16,
  openingScale: 0.68,
  openingLift: 0.34,
  destinationYaw: 1.24,
  destinationPitch: 0.67,
  radiansPerSecond: 0.13,
  desktopWidth: 0.616,
  narrowWidth: 0.91,
  // Ground-plane composition offset reconstructed from the road crossings.
  // It rotates with the camera around the board's stationary vertical axis.
  targetOffsetX: 25,
  targetOffsetZ: 1
});

export function sampleBoardShot(seconds) {
  const {seconds: duration, openingYaw, destinationYaw, destinationPitch, radiansPerSecond} = boardShot;
  const t = Math.min(1, Math.max(0, seconds / duration));
  const blend = t * t * (3 - 2 * t);
  const yaw = openingYaw + (destinationYaw - openingYaw) * blend
    + radiansPerSecond * duration * t * t * (t - 1)
    + radiansPerSecond * Math.max(0, seconds - duration);
  return {yaw, pitch: destinationPitch * blend, blend, phase: t < 1 ? 'approach' : 'orbit'};
}
