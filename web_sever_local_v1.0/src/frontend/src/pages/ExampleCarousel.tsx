import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import gsap from "gsap";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";

import type { DesignPreviewStoryBlock } from "../shared/designPreviewText";
import type { Language } from "../shared/types";

gsap.registerPlugin(MotionPathPlugin);

interface ExampleCarouselProps {
  blocks: DesignPreviewStoryBlock[];
  language: Language;
}

type CardPosition = "active" | "previous" | "next" | "hidden";

const ARTWORK_COPY = {
  zh: {
    atlas: "系统发育树与功能命中",
    density: "分类层级分布密度",
    workflow: "从查询到导出的工作流",
    carouselLabel: "示例展示轮播",
    previous: "上一张示例",
    next: "下一张示例",
    current: "当前示例",
  },
  en: {
    atlas: "Phylogeny and functional hits",
    density: "Distribution density by rank",
    workflow: "From query to export",
    carouselLabel: "Example showcase carousel",
    previous: "Previous example",
    next: "Next example",
    current: "Current example",
  },
} as const;

function normalizeIndex(index: number, total: number) {
  return (index + total) % total;
}

function resolveCardPosition(index: number, activeIndex: number, total: number): CardPosition {
  if (index === activeIndex) return "active";
  if (normalizeIndex(activeIndex + 1, total) === index) return "next";
  if (normalizeIndex(activeIndex - 1, total) === index) return "previous";
  return "hidden";
}

function artworkLabel(block: DesignPreviewStoryBlock, language: Language) {
  const copy = ARTWORK_COPY[language];
  return copy[block.id as keyof typeof copy] ?? block.title;
}

function PhylogenyArtwork() {
  return (
    <div className="dp-example-artwork dp-example-artwork-tree" aria-hidden="true">
      <div className="dp-art-window-bar"><span /><span /><span /></div>
      <div className="dp-art-tree-canvas">
        <div className="dp-art-tree-root" />
        <span className="dp-art-tree-node node-a" />
        <span className="dp-art-tree-node node-b" />
        <span className="dp-art-tree-node node-c" />
        <span className="dp-art-tree-node node-d" />
        <div className="dp-art-tree-label label-a">Bacteria</div>
        <div className="dp-art-tree-label label-b">Archaea</div>
        <div className="dp-art-tree-label label-c">Proteobacteria</div>
        <div className="dp-art-tree-axis"><i /><i /><i /><i /><i /></div>
      </div>
      <div className="dp-art-status-line"><span>FUNCTIONAL HIT</span><b>0.87</b></div>
    </div>
  );
}

function DensityArtwork() {
  return (
    <div className="dp-example-artwork dp-example-artwork-density" aria-hidden="true">
      <div className="dp-art-window-bar"><span /><span /><span /></div>
      <div className="dp-art-density-head"><span>RANK</span><span>COMPLETENESS</span><span>HITS</span></div>
      <div className="dp-art-density-grid">
        {Array.from({ length: 36 }).map((_, index) => (
          <span key={index} className={index % 11 === 0 ? "peak" : index % 5 === 0 ? "warm" : index % 3 === 0 ? "mid" : ""} />
        ))}
      </div>
      <div className="dp-art-density-axis"><span>phylum</span><span>class</span><span>order</span><span>family</span></div>
    </div>
  );
}

function WorkflowArtwork() {
  return (
    <div className="dp-example-artwork dp-example-artwork-workflow" aria-hidden="true">
      <div className="dp-art-window-bar"><span /><span /><span /></div>
      <div className="dp-art-workflow-canvas">
        <div className="dp-art-workflow-node node-query"><small>01</small><b>Query</b><span>COG0001</span></div>
        <div className="dp-art-workflow-node node-filter"><small>02</small><b>Filter</b><span>GTDB r226</span></div>
        <div className="dp-art-workflow-node node-export"><small>03</small><b>Export</b><span>SVG / FASTA</span></div>
        <div className="dp-art-workflow-line line-one" />
        <div className="dp-art-workflow-line line-two" />
      </div>
      <div className="dp-art-status-line"><span>PIPELINE READY</span><b>03 / 03</b></div>
    </div>
  );
}

function ExampleArtwork({ id }: { id: string }) {
  if (id === "density") return <DensityArtwork />;
  if (id === "workflow") return <WorkflowArtwork />;
  return <PhylogenyArtwork />;
}

function arcMidpoint(from: { x: number; y: number }, to: { x: number; y: number }) {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  return {
    x: (from.x + to.x) / 2 + deltaY * 0.18,
    y: (from.y + to.y) / 2 - deltaX * 0.18,
  };
}

export default function ExampleCarousel({ blocks, language }: ExampleCarouselProps) {
  const copy = ARTWORK_COPY[language];
  const stageRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Array<HTMLElement | null>>([]);
  const previousActiveIndexRef = useRef(0);
  const hasPositionedRef = useRef(false);
  const directionRef = useRef<"next" | "previous">("next");
  const [activeIndex, setActiveIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const activeBlock = blocks[activeIndex] ?? blocks[0];

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => setLayoutVersion((version) => version + 1));
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const elements = cardRefs.current.filter((element): element is HTMLElement => Boolean(element));
    if (!stage || !elements.length || !blocks.length) return undefined;

    const firstCard = elements[0];
    const cardWidth = firstCard.offsetWidth || 640;
    const cardHeight = firstCard.offsetHeight || 460;
    const xOffset = Math.min(stage.clientWidth * 0.39, cardWidth * 0.58);
    const yOffset = Math.min(stage.clientHeight * 0.31, cardHeight * 0.43);
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const total = blocks.length;
    const previousIndex = previousActiveIndexRef.current;
    const firstRender = !hasPositionedRef.current;

    const coordinates: Record<CardPosition, { x: number; y: number; scale: number; opacity: number; zIndex: number }> = {
      active: { x: 0, y: 0, scale: 1, opacity: 1, zIndex: 4 },
      next: { x: xOffset, y: -yOffset, scale: 0.25, opacity: 0.48, zIndex: 2 },
      previous: { x: -xOffset, y: yOffset, scale: 0.25, opacity: 0.48, zIndex: 2 },
      hidden: {
        x: directionRef.current === "next" ? -xOffset * 1.18 : xOffset * 1.18,
        y: directionRef.current === "next" ? yOffset * 1.18 : -yOffset * 1.18,
        scale: 0.16,
        opacity: 0,
        zIndex: 1,
      },
    };

    gsap.killTweensOf(elements);

    const shouldAnimate = hasPositionedRef.current && previousIndex !== activeIndex;
    if (firstRender || reducedMotion || !shouldAnimate) {
      elements.forEach((element, index) => {
        const position = resolveCardPosition(index, activeIndex, total);
        const target = coordinates[position];
        gsap.set(element, {
          xPercent: -50,
          yPercent: -50,
          x: target.x,
          y: target.y,
          scale: target.scale,
          opacity: target.opacity,
          zIndex: target.zIndex,
        });
      });
      hasPositionedRef.current = true;
      previousActiveIndexRef.current = activeIndex;
      setIsAnimating(false);
      return undefined;
    }

    const timeline = gsap.timeline({
      defaults: { duration: 0.86, ease: "power3.inOut" },
      onComplete: () => setIsAnimating(false),
    });

    elements.forEach((element, index) => {
      const fromPosition = resolveCardPosition(index, previousIndex, total);
      const toPosition = resolveCardPosition(index, activeIndex, total);
      const from = coordinates[fromPosition];
      const to = coordinates[toPosition];
      const path = [
        { x: from.x, y: from.y },
        arcMidpoint(from, to),
        { x: to.x, y: to.y },
      ];

      gsap.set(element, { xPercent: -50, yPercent: -50, zIndex: to.zIndex });
      timeline.to(element, {
        motionPath: { path, curviness: 1.08 },
        scale: to.scale,
        opacity: to.opacity,
        overwrite: "auto",
      }, 0);
    });

    hasPositionedRef.current = true;
    previousActiveIndexRef.current = activeIndex;
    return () => {
      timeline.kill();
    };
  }, [activeIndex, blocks.length, layoutVersion]);

  const shift = (direction: "next" | "previous") => {
    if (isAnimating || blocks.length < 2) return;
    directionRef.current = direction;
    setIsAnimating(true);
    setActiveIndex((current) => normalizeIndex(current + (direction === "next" ? 1 : -1), blocks.length));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      shift("next");
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      shift("previous");
    }
  };

  if (!activeBlock) return null;

  return (
    <div className="dp-example-carousel">
      <div
        ref={stageRef}
        className="dp-carousel-stage"
        role="region"
        aria-label={copy.carouselLabel}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <div className="dp-carousel-trajectory" aria-hidden="true" />
        <div className="dp-carousel-trajectory-dot" aria-hidden="true" />
        {blocks.map((block, index) => {
          const position = resolveCardPosition(index, activeIndex, blocks.length);
          return (
            <article
              key={block.id}
              ref={(element) => { cardRefs.current[index] = element; }}
              className={`dp-example-card is-${position}`}
              aria-hidden={position !== "active"}
            >
              <div className="dp-example-card-art">
                <span className="dp-example-card-index">{String(index + 1).padStart(2, "0")}</span>
                <ExampleArtwork id={block.id} />
              </div>
              <div className="dp-example-card-copy">
                <div className="dp-example-card-meta">
                  <span>{block.stat}</span>
                  <span>{String(index + 1).padStart(2, "0")} / {String(blocks.length).padStart(2, "0")}</span>
                </div>
                <h3>{block.title}</h3>
                <p>{block.body}</p>
                <div className="dp-example-card-foot"><span>{artworkLabel(block, language)}</span><i aria-hidden="true" /></div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="dp-carousel-controls">
        <div className="dp-carousel-buttons">
          <button type="button" title={copy.previous} aria-label={copy.previous} onClick={() => shift("previous")} disabled={isAnimating || blocks.length < 2}>
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <button type="button" title={copy.next} aria-label={copy.next} onClick={() => shift("next")} disabled={isAnimating || blocks.length < 2}>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">{copy.current}: {activeBlock.title}</p>
    </div>
  );
}
