import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowRight } from "lucide-react";
import gsap from "gsap";

import type { Language } from "../shared/types";
import { DESIGN_PREVIEW_TEXT } from "../shared/designPreviewText";
import {
  advanceParticleRevealAlpha,
  advanceDustParticle,
  decayDustPointerVelocity,
  DUST_RADIUS,
  resolveParticleRevealCount,
  type DustParticle,
} from "./landingParticleMotion";
import { resolveLandingTitleLayout } from "./landingTitleLayout";

interface LandingPageProps {
  language: Language;
  onStart: () => void;
}

type AudioEngine = {
  context: AudioContext;
  master: GainNode;
  noteIndex: number;
  lastNoteAt: number;
};

const NOTE_FREQUENCIES = [523.25, 659.25, 783.99, 987.77, 1174.66, 1318.51];
const HERO_TITLE = "Genome Function Lens";
const PARTICLE_ALPHA_BUCKETS = [0.18, 0.36, 0.56, 0.75];

function addParticle(particles: DustParticle[], x: number, y: number, size: number) {
  const phase = Math.random() * Math.PI * 2;
  const horizontalDrift = 14 + Math.random() * 24;
  const verticalDrift = 10 + Math.random() * 18;
  particles.push({
    homeX: x,
    homeY: y,
    x: x + Math.cos(phase) * horizontalDrift,
    y: y + Math.sin(phase) * verticalDrift,
    vx: -Math.sin(phase) * (0.035 + Math.random() * 0.035),
    vy: Math.cos(phase) * (0.025 + Math.random() * 0.03),
    alpha: 0,
    size,
    drift: 0.15 + Math.random() * 0.4,
    phase,
    swirl: Math.sin(phase * 1.73) * 0.55,
    wanderX: Math.cos(phase * 2.11) * 0.006,
    wanderY: Math.sin(phase * 1.89) * 0.006,
    scatter: 0,
  });
}

function shuffleParticles(particles: DustParticle[]) {
  for (let index = particles.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [particles[index], particles[swapIndex]] = [particles[swapIndex], particles[index]];
  }
}

function createAudioEngine() {
  const AudioContextConstructor = window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return null;
  const context = new AudioContextConstructor();
  const master = context.createGain();
  master.gain.value = 0.038;
  master.connect(context.destination);
  return { context, master, noteIndex: 0, lastNoteAt: 0 } satisfies AudioEngine;
}

function playSoftNote(engine: AudioEngine) {
  const now = performance.now();
  if (now - engine.lastNoteAt < 240) return;
  engine.lastNoteAt = now;
  const oscillator = engine.context.createOscillator();
  const gain = engine.context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = NOTE_FREQUENCIES[engine.noteIndex % NOTE_FREQUENCIES.length];
  engine.noteIndex += 1;
  gain.gain.setValueAtTime(0.0001, engine.context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.17, engine.context.currentTime + 0.035);
  gain.gain.exponentialRampToValueAtTime(0.0001, engine.context.currentTime + 1.15);
  oscillator.connect(gain);
  gain.connect(engine.master);
  oscillator.start();
  oscillator.stop(engine.context.currentTime + 1.2);
}

export default function LandingPage({ language, onStart }: LandingPageProps) {
  const copy = DESIGN_PREVIEW_TEXT[language];
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const particlesRef = useRef<DustParticle[]>([]);
  const pointerRef = useRef({ x: 0, y: 0, vx: 0, vy: 0, lastUpdate: 0 });
  const interactionRef = useRef({ active: 0 });
  const audioRef = useRef<AudioEngine | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !stage || !context) return;

    const sampleCanvas = document.createElement("canvas");
    const sampleContext = sampleCanvas.getContext("2d");
    if (!sampleContext) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let devicePixelRatio = 1;
    let resizeSignature = "";
    let assemblyStartedAt = performance.now();

    const resize = () => {
      const rect = stage.getBoundingClientRect();
      const nextWidth = Math.max(320, rect.width);
      const nextHeight = Math.max(170, rect.height);
      const nextDevicePixelRatio = Math.min(1.5, window.devicePixelRatio || 1);
      const nextResizeSignature = `${Math.round(nextWidth)}:${Math.round(nextHeight)}:${nextDevicePixelRatio}`;
      if (nextResizeSignature === resizeSignature) return;
      resizeSignature = nextResizeSignature;
      width = nextWidth;
      height = nextHeight;
      devicePixelRatio = nextDevicePixelRatio;
      canvas.width = Math.round(width * devicePixelRatio);
      canvas.height = Math.round(height * devicePixelRatio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

      sampleCanvas.width = Math.ceil(width);
      sampleCanvas.height = Math.ceil(height);
      sampleContext.setTransform(1, 0, 0, 1, 0, 0);
      const titleLayout = resolveLandingTitleLayout(width, height);
      let fontSize = titleLayout.fontSize;
      sampleContext.font = `500 ${fontSize}px "Times New Roman", Georgia, serif`;
      sampleContext.textAlign = "center";
      sampleContext.textBaseline = "alphabetic";
      let textMetrics = sampleContext.measureText(HERO_TITLE);
      const availableWidth = width - titleLayout.horizontalPadding * 2;
      const measuredHeight = textMetrics.actualBoundingBoxAscent + textMetrics.actualBoundingBoxDescent;
      const availableHeight = height - titleLayout.samplePadding * 2;
      const fitScale = Math.min(1, availableWidth / textMetrics.width, availableHeight / measuredHeight);
      if (fitScale < 1) {
        fontSize *= fitScale;
        sampleContext.font = `500 ${fontSize}px "Times New Roman", Georgia, serif`;
        textMetrics = sampleContext.measureText(HERO_TITLE);
      }

      const textX = width / 2;
      const textY = height / 2
        + (textMetrics.actualBoundingBoxAscent - textMetrics.actualBoundingBoxDescent) / 2;
      const left = Math.max(0, Math.floor(
        textX - textMetrics.width / 2 - titleLayout.samplePadding,
      ));
      const top = Math.max(0, Math.floor(
        textY - textMetrics.actualBoundingBoxAscent - titleLayout.samplePadding,
      ));
      const sampleWidth = Math.max(1, Math.ceil(Math.min(
        width - left,
        textMetrics.width + titleLayout.samplePadding * 2,
      )));
      const sampleHeight = Math.max(1, Math.ceil(Math.min(
        height - top,
        textMetrics.actualBoundingBoxAscent
          + textMetrics.actualBoundingBoxDescent
          + titleLayout.samplePadding * 2,
      )));
      sampleContext.clearRect(0, 0, width, height);
      sampleContext.fillStyle = "#ffffff";
      sampleContext.fillText(HERO_TITLE, textX, textY);
      context.clearRect(0, 0, width, height);
      const pixels = sampleContext.getImageData(left, top, sampleWidth, sampleHeight).data;
      const sampleStep = titleLayout.sampleStep;
      const particles: DustParticle[] = [];

      for (let pixelY = 0; pixelY < sampleHeight; pixelY += sampleStep) {
        for (let pixelX = 0; pixelX < sampleWidth; pixelX += sampleStep) {
          const alpha = pixels[(pixelY * sampleWidth + pixelX) * 4 + 3];
          if (alpha < 48) continue;
          addParticle(particles, left + pixelX, top + pixelY, 0.62 + Math.random() * 1.05);
        }
      }

      shuffleParticles(particles);
      particlesRef.current = particles;
      assemblyStartedAt = performance.now();
      if (reducedMotion) {
        particles.forEach((particle) => {
          particle.x = particle.homeX;
          particle.y = particle.homeY;
          particle.alpha = 1;
        });
      }
    };

    const render = () => {
      const pointer = pointerRef.current;
      const intensity = interactionRef.current.active;
      const time = performance.now() * 0.001;
      const frameScale = Math.min(2, gsap.ticker.deltaRatio());
      const dustRadius = Math.min(DUST_RADIUS, width * 0.22);
      const pointerSpeed = Math.sqrt(pointer.vx * pointer.vx + pointer.vy * pointer.vy);
      const dustPointer = {
        x: pointer.x,
        y: pointer.y,
        motion: Math.min(1, pointerSpeed / 18),
        sweepX: pointerSpeed > 0.001 ? pointer.vx / pointerSpeed : 0,
        sweepY: pointerSpeed > 0.001 ? pointer.vy / pointerSpeed : 0,
        active: intensity,
      };
      context.clearRect(0, 0, width, height);

      const particles = particlesRef.current;
      const visibleParticleCount = resolveParticleRevealCount(
        particles.length,
        performance.now() - assemblyStartedAt,
        reducedMotion,
      );

      for (let index = 0; index < visibleParticleCount; index += 1) {
        const particle = particles[index];
        if (!reducedMotion) {
          particle.alpha = advanceParticleRevealAlpha(particle.alpha, frameScale);
          advanceDustParticle(particle, dustPointer, frameScale, dustRadius);
          if (particle.x < 6 || particle.x > width - 6) {
            particle.x = Math.max(6, Math.min(width - 6, particle.x));
            particle.vx *= -0.35;
          }
          if (particle.y < 6 || particle.y > height - 6) {
            particle.y = Math.max(6, Math.min(height - 6, particle.y));
            particle.vy *= -0.35;
          }
        } else {
          particle.x = particle.homeX;
          particle.y = particle.homeY;
        }
      }

      for (let bucket = 0; bucket < PARTICLE_ALPHA_BUCKETS.length; bucket += 1) {
        context.beginPath();
        let bucketHasParticles = false;
        for (let index = 0; index < visibleParticleCount; index += 1) {
          const particle = particles[index];
          const dustAlpha = particle.alpha * (0.75 - particle.scatter * 0.22);
          const particleBucket = Math.min(
            PARTICLE_ALPHA_BUCKETS.length - 1,
            Math.floor(dustAlpha * PARTICLE_ALPHA_BUCKETS.length / 0.75),
          );
          if (particleBucket !== bucket) continue;
          const ambientY = reducedMotion ? 0 : Math.sin(time * particle.drift + particle.phase) * 0.48;
          const radius = particle.size + particle.scatter * 0.16;
          const drawY = particle.y + ambientY;
          context.moveTo(particle.x + radius, drawY);
          context.arc(particle.x, drawY, radius, 0, Math.PI * 2);
          bucketHasParticles = true;
        }
        if (!bucketHasParticles) continue;
        context.fillStyle = `rgba(48, 52, 48, ${PARTICLE_ALPHA_BUCKETS[bucket]})`;
        context.fill();
      }
      decayDustPointerVelocity(pointer, frameScale);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();
    gsap.ticker.add(render);
    return () => {
      observer.disconnect();
      gsap.ticker.remove(render);
      gsap.killTweensOf(interactionRef.current);
      if (audioRef.current) void audioRef.current.context.close();
      audioRef.current = null;
    };
  }, []);

  const primeAudio = () => {
    if (!audioRef.current) audioRef.current = createAudioEngine();
    const audio = audioRef.current;
    if (audio?.context.state === "suspended") void audio.context.resume();
    return audio;
  };

  const updatePointerPosition = (event: ReactPointerEvent<HTMLDivElement>, resetVelocity = false) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const pointer = pointerRef.current;
    const nextX = event.clientX - rect.left;
    const nextY = event.clientY - rect.top;
    const now = performance.now();
    const elapsed = Math.max(8, Math.min(50, now - pointer.lastUpdate || 16.67));
    const frameCorrection = 16.67 / elapsed;
    const nextVx = (nextX - pointer.x) * frameCorrection;
    const nextVy = (nextY - pointer.y) * frameCorrection;
    pointer.vx = resetVelocity ? 0 : pointer.vx * 0.28 + nextVx * 0.72;
    pointer.vy = resetVelocity ? 0 : pointer.vy * 0.28 + nextVy * 0.72;
    pointer.x = nextX;
    pointer.y = nextY;
    pointer.lastUpdate = now;
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    updatePointerPosition(event);
    const audio = audioRef.current ?? createAudioEngine();
    audioRef.current = audio;
    if (audio) playSoftNote(audio);
  };

  return (
    <main className="landing-page">
      <section className="landing-content" aria-labelledby="landing-title">
        <div
          ref={stageRef}
          className="landing-title-stage"
          onPointerEnter={(event) => {
            updatePointerPosition(event, true);
            gsap.killTweensOf(interactionRef.current);
            gsap.to(interactionRef.current, { active: 1, duration: 0.18, ease: "power2.out", overwrite: true });
            const audio = audioRef.current ?? createAudioEngine();
            audioRef.current = audio;
            if (audio) playSoftNote(audio);
          }}
          onPointerLeave={() => {
            pointerRef.current.vx = 0;
            pointerRef.current.vy = 0;
            gsap.killTweensOf(interactionRef.current);
            gsap.to(interactionRef.current, { active: 0, duration: 0.66, ease: "power3.out", overwrite: true });
          }}
          onPointerMove={handlePointerMove}
          onPointerDown={() => {
            const audio = primeAudio();
            if (audio) playSoftNote(audio);
          }}
        >
          <canvas ref={canvasRef} className="landing-particle-canvas" aria-hidden="true" />
          <h1 id="landing-title" className="landing-title-accessible">{HERO_TITLE}</h1>
        </div>
        <button type="button" className="landing-start" onClick={() => { primeAudio(); onStart(); }}>
          <span>{language === "zh" ? "探索数据库" : "Explore the archive"}</span>
          <ArrowRight size={17} aria-hidden="true" />
        </button>
        <p className="landing-description">{copy.heroDescription}</p>
      </section>
    </main>
  );
}
