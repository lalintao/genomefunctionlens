export interface LandingTitleLayout {
  fontSize: number;
  horizontalPadding: number;
  samplePadding: number;
  sampleStep: number;
}

export function resolveLandingTitleLayout(width: number, height: number): LandingTitleLayout {
  const safeWidth = Math.max(320, width);
  const safeHeight = Math.max(170, height);
  let maxFontSize = 72;
  let horizontalPadding = 4;
  let samplePadding = 12;
  let sampleStep = 2;

  if (safeWidth >= 1320) {
    maxFontSize = 390;
    horizontalPadding = 20;
    samplePadding = 28;
    sampleStep = 3;
  } else if (safeWidth >= 1120) {
    maxFontSize = 340;
    horizontalPadding = 12;
    samplePadding = 26;
    sampleStep = 3;
  } else if (safeWidth >= 900) {
    maxFontSize = 280;
    horizontalPadding = 12;
    samplePadding = 22;
    sampleStep = 3;
  } else if (safeWidth >= 720) {
    maxFontSize = 200;
    horizontalPadding = 10;
    samplePadding = 20;
    sampleStep = 3;
  } else if (safeWidth >= 520) {
    maxFontSize = 132;
    horizontalPadding = 8;
    samplePadding = 16;
  } else if (safeWidth >= 380) {
    maxFontSize = 92;
    horizontalPadding = 5;
  }

  return {
    fontSize: Math.min(maxFontSize, safeHeight * 0.78),
    horizontalPadding,
    samplePadding,
    sampleStep,
  };
}
