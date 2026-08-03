import React, { CSSProperties, ReactNode } from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";

const COLORS = {
  ink: "#050914",
  inkSoft: "#0d1525",
  panel: "rgba(15, 26, 45, 0.88)",
  cream: "#f6fbff",
  muted: "#a5b4c9",
  cyan: "#64e6f8",
  cyanSoft: "#a2f4fd",
  line: "rgba(162, 244, 253, 0.24)",
  gold: "#ffd166",
};

const ADDRESS = process.env.AD_ADDRESS || "6420 E Nance St, Mesa, AZ 85215";
const SCENES = [
  { start: 0, duration: 104 },
  { start: 104, duration: 96 },
  { start: 200, duration: 260 },
  { start: 460, duration: 122 },
  { start: 582, duration: 126 },
  { start: 708, duration: 192 },
] as const;

const font = "'Aptos Display', 'Segoe UI', Arial, sans-serif";
const mono = "'Cascadia Mono', 'SFMono-Regular', Consolas, monospace";

function enter(frame: number, distance = 18, offset = 0) {
  return interpolate(frame, [offset, offset + distance], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
}

function fade(frame: number, distance = 20, offset = 0) {
  return enter(frame, distance, offset);
}

function rise(frame: number, distance = 20, offset = 0) {
  return interpolate(frame, [offset, offset + distance], [34, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
}

function brandStyle(overrides: CSSProperties = {}): CSSProperties {
  return {
    fontFamily: font,
    color: COLORS.cream,
    ...overrides,
  };
}

const Kicker = ({ children }: { children: ReactNode }) => (
  <div
    style={brandStyle({
      color: COLORS.cyan,
      fontFamily: mono,
      fontSize: 21,
      fontWeight: 700,
      letterSpacing: "0.18em",
      textTransform: "uppercase",
    })}
  >
    {children}
  </div>
);

const Brand = ({ light = false }: { light?: boolean }) => (
  <div style={brandStyle({ display: "flex", alignItems: "center", gap: 16 })}>
    <div
      style={{
        width: 38,
        height: 38,
        border: `2px solid ${light ? COLORS.ink : COLORS.cyan}`,
        borderRadius: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: light ? COLORS.ink : COLORS.cyan,
        fontSize: 24,
        fontWeight: 700,
      }}
    >
      ◦
    </div>
    <div>
      <div
        style={{
          fontSize: 24,
          lineHeight: 1,
          fontWeight: 800,
          letterSpacing: "0.18em",
          color: light ? COLORS.ink : COLORS.cream,
        }}
      >
        SOLARTELLIGENCE
      </div>
      <div
        style={{
          marginTop: 8,
          color: light ? "rgba(5,9,20,0.62)" : COLORS.muted,
          fontSize: 14,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        ROOF INTELLIGENCE FOR HOMEOWNERS
      </div>
    </div>
  </div>
);

const StepRail = ({ active }: { active: number }) => (
  <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 46 }}>
    {["Address", "Roof", "Report"].map((label, index) => (
      <React.Fragment key={label}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              background: index <= active ? COLORS.cyan : "rgba(255,255,255,0.10)",
              color: index <= active ? COLORS.ink : COLORS.muted,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: mono,
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            {index + 1}
          </div>
          <span style={brandStyle({ color: index <= active ? COLORS.cream : COLORS.muted, fontSize: 18 })}>
            {label}
          </span>
        </div>
        {index < 2 && <div style={{ width: 42, height: 1, background: COLORS.line }} />}
      </React.Fragment>
    ))}
  </div>
);

const Pill = ({ children, accent = false }: { children: ReactNode; accent?: boolean }) => (
  <div
    style={brandStyle({
      display: "inline-flex",
      alignItems: "center",
      padding: "10px 16px",
      borderRadius: 999,
      border: `1px solid ${accent ? "rgba(5,9,20,0.28)" : COLORS.line}`,
      background: accent ? "rgba(5,9,20,0.12)" : "rgba(5,9,20,0.45)",
      color: accent ? COLORS.ink : COLORS.cyanSoft,
      fontFamily: mono,
      fontSize: 15,
      fontWeight: 700,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
    })}
  >
    {children}
  </div>
);

const FeatureRow = ({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) => (
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 30,
      padding: "17px 0",
      borderBottom: `1px solid ${accent ? "rgba(5,9,20,0.22)" : COLORS.line}`,
    }}
  >
    <span style={brandStyle({ color: accent ? COLORS.ink : COLORS.muted, fontSize: 20 })}>{label}</span>
    <span style={brandStyle({ color: accent ? COLORS.ink : COLORS.cyanSoft, fontFamily: mono, fontSize: 17 })}>{value}</span>
  </div>
);

const Frame = ({ children, background = COLORS.ink }: { children: ReactNode; background?: string }) => (
  <AbsoluteFill style={{ background, overflow: "hidden" }}>{children}</AbsoluteFill>
);

const ScreenCard = ({
  src,
  style,
  objectPosition = "center",
}: {
  src: string;
  style?: CSSProperties;
  objectPosition?: string;
}) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 120], [1.02, 1.075], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  return (
    <div
      style={{
        overflow: "hidden",
        borderRadius: 28,
        border: `1px solid ${COLORS.line}`,
        background: COLORS.inkSoft,
        boxShadow: "0 25px 80px rgba(0,0,0,0.32)",
        ...style,
      }}
    >
      <Img
        src={staticFile(src)}
        style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition, transform: `scale(${scale})` }}
      />
    </div>
  );
};

function HookScene() {
  const frame = useCurrentFrame();
  const imageScale = interpolate(frame, [0, 104], [1.04, 1.12], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  return (
    <Frame>
      <Img src={staticFile("assets/sunset.jpg")} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${imageScale})` }} />
      <AbsoluteFill style={{ background: "linear-gradient(90deg, rgba(5,9,20,0.92) 0%, rgba(5,9,20,0.66) 47%, rgba(5,9,20,0.18) 100%)" }} />
      <div style={{ position: "absolute", top: 72, left: 104 }}><Brand /></div>
      <div style={{ position: "absolute", left: 104, top: 270, width: 950, opacity: fade(frame, 20) }}>
        <Kicker>THE FIRST STEP ISN'T A SALES CALL</Kicker>
        <h1 style={brandStyle({ fontSize: 94, lineHeight: 0.98, letterSpacing: "-0.055em", margin: "32px 0 26px", fontWeight: 800 })}>
          Before you call an installer,
          <br />
          <span style={{ color: COLORS.cyan }}>see your roof.</span>
        </h1>
        <p style={brandStyle({ color: COLORS.muted, fontSize: 27, lineHeight: 1.35, margin: 0, maxWidth: 720 })}>
          A property-specific solar read, starting with one address.
        </p>
      </div>
      <div style={{ position: "absolute", right: 105, bottom: 82, opacity: fade(frame, 20, 12) }}><Pill>Free preliminary analysis</Pill></div>
    </Frame>
  );
}

function AddressScene() {
  const frame = useCurrentFrame();
  const contentOpacity = fade(frame, 18);
  return (
    <Frame>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 72% 30%, rgba(100,230,248,0.12), transparent 34%)" }} />
      <div style={{ position: "absolute", left: 102, top: 78 }}><Brand /></div>
      <div style={{ position: "absolute", left: 102, top: 275, width: 690, opacity: contentOpacity }}>
        <Kicker>STEP 01 / ENTER ADDRESS</Kicker>
        <h2 style={brandStyle({ fontSize: 78, lineHeight: 1.02, letterSpacing: "-0.055em", margin: "30px 0 26px", fontWeight: 800 })}>
          One address.
          <br />
          <span style={{ color: COLORS.cyan }}>Your roof in view.</span>
        </h2>
        <p style={brandStyle({ color: COLORS.muted, fontSize: 25, lineHeight: 1.4, margin: 0 })}>
          Type your home address, then let the roof model do the first look.
        </p>
        <StepRail active={0} />
      </div>
      <div style={{ position: "absolute", right: 100, top: 148, width: 920, height: 650, transform: `translateY(${rise(frame, 24)}px)`, opacity: contentOpacity }}>
        <ScreenCard src="assets/homepage.png" style={{ width: "100%", height: "100%" }} />
        <div style={{ position: "absolute", left: 54, right: 54, bottom: 38, padding: "18px 22px", borderRadius: 16, background: "rgba(5,9,20,0.86)", border: `1px solid ${COLORS.line}` }}>
          <div style={brandStyle({ fontFamily: mono, color: COLORS.muted, fontSize: 14, letterSpacing: "0.12em" })}>PROPERTY ADDRESS</div>
          <div style={brandStyle({ marginTop: 8, color: COLORS.cream, fontSize: 24 })}>{ADDRESS}</div>
        </div>
      </div>
    </Frame>
  );
}

function RoofScene() {
  const frame = useCurrentFrame();
  const opacity = fade(frame, 18);
  return (
    <Frame>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 18% 65%, rgba(100,230,248,0.12), transparent 30%)" }} />
      <div style={{ position: "absolute", left: 92, top: 70 }}><Brand /></div>
      <div style={{ position: "absolute", left: 88, top: 158, width: 990, height: 820, opacity }}>
        <ScreenCard src="assets/roof-analysis.png" style={{ width: "100%", height: "100%" }} />
        <div style={{ position: "absolute", left: 28, top: 28 }}><Pill accent>Solar API roof model</Pill></div>
        <div style={{ position: "absolute", left: 28, bottom: 28 }}><Pill>Panels · roof planes · sunlight</Pill></div>
      </div>
      <div style={{ position: "absolute", right: 105, top: 240, width: 600, opacity, transform: `translateY(${rise(frame, 20)}px)` }}>
        <Kicker>STEP 02 / SEE THE PROPERTY</Kicker>
        <h2 style={brandStyle({ fontSize: 69, lineHeight: 1.03, letterSpacing: "-0.055em", margin: "28px 0 24px", fontWeight: 800 })}>
          See the roof
          <br />
          <span style={{ color: COLORS.cyan }}>you actually own.</span>
        </h2>
        <p style={brandStyle({ color: COLORS.muted, fontSize: 23, lineHeight: 1.45, margin: "0 0 25px" })}>
          Satellite imagery turns your address into a focused rooftop view with a preliminary panel layout.
        </p>
        <FeatureRow label="Roof planes" value="Detected" />
        <FeatureRow label="Panel layout" value="Preliminary fit" />
        <FeatureRow label="Sunlight quality" value="Modeled" />
        <div style={{ marginTop: 30 }}><Pill>Final design · installer verified</Pill></div>
      </div>
    </Frame>
  );
}

function ThreeDScene() {
  const frame = useCurrentFrame();
  const opacity = fade(frame, 18);
  return (
    <Frame>
      <div style={{ position: "absolute", left: 92, top: 70 }}><Brand /></div>
      <div style={{ position: "absolute", left: 72, top: 178, width: 1080, height: 808, opacity }}>
        <ScreenCard src="assets/roof-3d.png" style={{ width: "100%", height: "100%" }} />
      </div>
      <div style={{ position: "absolute", right: 76, top: 242, width: 548, opacity, transform: `translateY(${rise(frame, 20)}px)` }}>
        <Kicker>STEP 03 / EXPLORE IN 3D</Kicker>
        <h2 style={brandStyle({ fontSize: 70, lineHeight: 1.04, letterSpacing: "-0.055em", margin: "28px 0 25px", fontWeight: 800 })}>
          See every plane.
          <br />
          <span style={{ color: COLORS.cyan }}>Every module.</span>
        </h2>
        <p style={brandStyle({ color: COLORS.muted, fontSize: 23, lineHeight: 1.45, margin: "0 0 25px" })}>
          Switch to 3D to understand the roof shape, placement logic, and where shade may matter.
        </p>
        <FeatureRow label="3D roof model" value="Explore" />
        <FeatureRow label="Panel orientation" value="Aligned" />
        <FeatureRow label="Obstructions" value="Visible" />
        <div style={{ marginTop: 30 }}><Pill>Drag · orbit · zoom</Pill></div>
      </div>
    </Frame>
  );
}

function ReportScene() {
  const frame = useCurrentFrame();
  const opacity = fade(frame, 18);
  const modelOpacity = interpolate(frame, [0, 36, 64, 78], [1, 1, 0.12, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  const reportOpacity = interpolate(frame, [40, 78], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  return (
    <Frame>
      <div style={{ position: "absolute", left: 92, top: 66 }}><Brand /></div>
      <div style={{ position: "absolute", left: 92, top: 196, width: 1120, height: 700, opacity: opacity * modelOpacity, transform: `translateY(${rise(frame, 22)}px)` }}>
        <ScreenCard src="assets/roof-3d.png" style={{ width: "100%", height: "100%" }} />
        <div style={{ position: "absolute", left: 28, top: 28 }}><Pill accent>3D roof model</Pill></div>
      </div>
      <div style={{ position: "absolute", left: 92, top: 196, width: 1120, height: 700, opacity: opacity * reportOpacity, transform: `translateY(${rise(frame, 22)}px)` }}>
        <ScreenCard src="assets/dashboard.png" style={{ width: "100%", height: "100%" }} objectPosition="center" />
      </div>
      <div style={{ position: "absolute", right: 102, top: 252, width: 535, opacity }}>
        <Kicker>STEP 04 / EXPLORE THE REPORT</Kicker>
        <h2 style={brandStyle({ fontSize: 62, lineHeight: 1.05, letterSpacing: "-0.055em", margin: "28px 0 22px", fontWeight: 800 })}>
          Adjust the bill.
          <br />
          <span style={{ color: COLORS.cyan }}>Understand the options.</span>
        </h2>
        <p style={brandStyle({ color: COLORS.muted, fontSize: 22, lineHeight: 1.42, margin: "0 0 22px" })}>
          Explore modeled savings, system size, panel count, payback, and your Solar Readiness Report in one place.
        </p>
        <FeatureRow label="Annual savings" value="Modeled" />
        <FeatureRow label="System size" value="Selected" />
        <FeatureRow label="Full report" value="Ready to share" />
      </div>
      <div style={{ position: "absolute", left: 110, bottom: 75, opacity: fade(frame, 18, 18) }}><Pill>Preliminary estimate · installer verification required</Pill></div>
    </Frame>
  );
}

function CtaScene() {
  const frame = useCurrentFrame();
  const opacity = fade(frame, 18);
  return (
    <Frame background={COLORS.cyanSoft}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 80% 15%, rgba(255,255,255,0.52), transparent 32%)" }} />
      <div style={{ position: "absolute", left: 106, top: 86, opacity }}><Brand light /></div>
      <div style={{ position: "absolute", left: 106, top: 300, width: 1060, opacity, transform: `translateY(${rise(frame, 22)}px)` }}>
        <div style={brandStyle({ color: COLORS.ink, fontFamily: mono, fontSize: 20, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase" })}>
          LOOK FIRST. DECIDE WITH BETTER INFORMATION.
        </div>
        <h2 style={brandStyle({ color: COLORS.ink, fontSize: 92, lineHeight: 0.98, letterSpacing: "-0.06em", margin: "30px 0 20px", fontWeight: 800 })}>
          Your roof is
          <br />
          the first step.
        </h2>
        <p style={brandStyle({ color: "rgba(5,9,20,0.70)", fontSize: 28, lineHeight: 1.35, margin: 0, maxWidth: 840 })}>
          Get a free Solar Readiness Report in about 60 seconds.
        </p>
      </div>
      <div style={{ position: "absolute", right: 112, top: 364, width: 430, opacity: fade(frame, 18, 14), transform: `scale(${interpolate(frame, [14, 34], [0.92, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) })})` }}>
        <div style={{ padding: "22px 28px", background: COLORS.ink, borderRadius: 999, color: COLORS.cream, fontSize: 25, fontWeight: 800, textAlign: "center", boxShadow: "0 20px 45px rgba(5,9,20,0.22)" }}>
          Analyze My Roof →
        </div>
        <div style={{ textAlign: "center", marginTop: 24, color: "rgba(5,9,20,0.62)", fontFamily: mono, fontSize: 16, letterSpacing: "0.1em" }}>SOLARTELLIGENCE.COM</div>
      </div>
      <div style={{ position: "absolute", left: 106, bottom: 70, display: "flex", gap: 14, alignItems: "center", opacity: fade(frame, 18, 28) }}>
        <span style={brandStyle({ color: "rgba(5,9,20,0.66)", fontSize: 19 })}>Free to explore</span>
        <span style={{ color: "rgba(5,9,20,0.35)" }}>•</span>
        <span style={brandStyle({ color: "rgba(5,9,20,0.66)", fontSize: 19 })}>No obligation</span>
        <span style={{ color: "rgba(5,9,20,0.35)" }}>•</span>
        <span style={brandStyle({ color: "rgba(5,9,20,0.66)", fontSize: 19 })}>Final design requires installer verification</span>
      </div>
    </Frame>
  );
}

export const SolartelligenceFacebookAd = () => (
  <AbsoluteFill style={{ background: COLORS.ink, fontFamily: font }}>
    <Sequence from={SCENES[0].start} durationInFrames={SCENES[0].duration}><HookScene /></Sequence>
    <Sequence from={SCENES[1].start} durationInFrames={SCENES[1].duration}><AddressScene /></Sequence>
    <Sequence from={SCENES[2].start} durationInFrames={SCENES[2].duration}><RoofScene /></Sequence>
    <Sequence from={SCENES[3].start} durationInFrames={SCENES[3].duration}><ThreeDScene /></Sequence>
    <Sequence from={SCENES[4].start} durationInFrames={SCENES[4].duration}><ReportScene /></Sequence>
    <Sequence from={SCENES[5].start} durationInFrames={SCENES[5].duration}><CtaScene /></Sequence>
    <Audio src={staticFile("assets/music.wav")} volume={0.12} loop />
    <Audio src={staticFile("assets/narration-tight.wav")} volume={1} />
  </AbsoluteFill>
);
