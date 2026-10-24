import { lazy, Suspense, type CSSProperties } from "react";

import QueryCard, { type QueryCardProps } from "../features/query/QueryCard";
import { DESIGN_PREVIEW_TEXT } from "../shared/designPreviewText";

const ExampleCarousel = lazy(() => import("./ExampleCarousel"));

interface HomePageProps extends QueryCardProps {
  homeBackgroundRgb: [number, number, number];
  activeSection: "query" | "examples";
  onStart: () => void;
}

export default function HomePage(props: HomePageProps) {
  const copy = DESIGN_PREVIEW_TEXT[props.language];
  const showingExamples = props.activeSection === "examples";
  const homeBackground = `rgb(${props.homeBackgroundRgb.join(", ")})`;
  return (
    <div className={`dp-page${showingExamples ? " dp-examples-page" : " dp-query-page"}`} style={{ "--dp-home-background": homeBackground } as CSSProperties}>
      <main>
        {!showingExamples ? <QueryCard {...props} revealVisible /> : null}

        {showingExamples ? <section id="examples" className="dp-story-shell dp-examples-shell">
          <Suspense fallback={null}>
            <ExampleCarousel blocks={copy.storyBlocks} language={props.language} />
          </Suspense>
        </section> : null}
      </main>
    </div>
  );
}
