export interface DustParticle {
  homeX: number;
  homeY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  alpha: number;
  size: number;
  drift: number;
  phase: number;
  swirl: number;
  wanderX: number;
  wanderY: number;
  scatter: number;
}

export interface DustPointer {
  x: number;
  y: number;
  motion: number;
  sweepX: number;
  sweepY: number;
  active: number;
}

export const DUST_RADIUS = 108;
export const PARTICLE_ASSEMBLY_DURATION_MS = 1_450;

const INITIAL_REVEAL_FRACTION = 0.055;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function resolveParticleRevealCount(
  total: number,
  elapsedMs: number,
  reducedMotion: boolean,
) {
  if (total <= 0) return 0;
  if (reducedMotion) return total;
  const progress = clamp(elapsedMs / PARTICLE_ASSEMBLY_DURATION_MS, 0, 1);
  const easedProgress = 1 - Math.pow(1 - progress, 3);
  const revealedFraction = INITIAL_REVEAL_FRACTION
    + (1 - INITIAL_REVEAL_FRACTION) * easedProgress;
  return Math.min(total, Math.max(1, Math.ceil(total * revealedFraction)));
}

export function advanceParticleRevealAlpha(alpha: number, frameScale: number) {
  const delta = clamp(frameScale, 0.25, 2);
  return Math.min(1, alpha + (1 - alpha) * (1 - Math.pow(0.82, delta)));
}

export function advanceDustParticle(
  particle: DustParticle,
  pointer: DustPointer,
  frameScale: number,
  radius = DUST_RADIUS,
) {
  const delta = clamp(frameScale, 0.25, 2);
  const dx = particle.x - pointer.x;
  const dy = particle.y - pointer.y;
  const distance = Math.sqrt(dx * dx + dy * dy) || 1;
  const proximity = Math.max(0, 1 - distance / Math.max(1, radius));
  const influence = proximity * proximity * pointer.active * pointer.motion;

  if (influence > 0.0001) {
    const radialX = dx / distance;
    const radialY = dy / distance;
    const depth = 0.82 + Math.min(0.38, particle.size * 0.16);
    const impulse = influence * (1.55 + pointer.motion * 1.65) * depth * delta;

    particle.vx += radialX * impulse + pointer.sweepX * impulse * 0.18 - radialY * impulse * particle.swirl;
    particle.vy += radialY * impulse + pointer.sweepY * impulse * 0.18 + radialX * impulse * particle.swirl;
    particle.scatter = Math.min(1, Math.max(particle.scatter, proximity * pointer.active));
  }

  const settled = 1 - particle.scatter;
  const spring = 0.002 + settled * settled * 0.05;
  particle.vx += particle.wanderX * particle.scatter * delta;
  particle.vy += particle.wanderY * particle.scatter * delta;
  particle.vx += (particle.homeX - particle.x) * spring * delta;
  particle.vy += (particle.homeY - particle.y) * spring * delta;

  const damping = Math.pow(0.94, delta);
  particle.vx *= damping;
  particle.vy *= damping;
  const speed = Math.sqrt(particle.vx * particle.vx + particle.vy * particle.vy);
  if (speed > 6.2) {
    const speedLimit = 6.2 / speed;
    particle.vx *= speedLimit;
    particle.vy *= speedLimit;
  }

  particle.x += particle.vx * delta;
  particle.y += particle.vy * delta;
  particle.scatter *= Math.pow(0.982, delta);

  const homeDistance = Math.abs(particle.homeX - particle.x) + Math.abs(particle.homeY - particle.y);
  if (pointer.active < 0.01 && homeDistance < 0.08 && Math.abs(particle.vx) + Math.abs(particle.vy) < 0.04) {
    particle.x = particle.homeX;
    particle.y = particle.homeY;
    particle.vx = 0;
    particle.vy = 0;
    particle.scatter = 0;
  }

  return influence;
}

export function decayDustPointerVelocity(pointer: { vx: number; vy: number }, frameScale: number) {
  const damping = Math.pow(0.72, clamp(frameScale, 0.25, 2));
  pointer.vx *= damping;
  pointer.vy *= damping;
}
