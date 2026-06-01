import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "linear-gradient(135deg, #0a0a0a 0%, #0f1f0f 100%)",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          justifyContent: "center",
          fontFamily: "sans-serif",
          padding: "60px",
          width: "100%",
        }}
      >
        <div
          style={{
            color: "#22d3ee",
            fontSize: 28,
            letterSpacing: 4,
            marginBottom: 24,
            textTransform: "uppercase",
          }}
        >
          Arizona Solar AI
        </div>
        <div
          style={{
            color: "#ffffff",
            fontSize: 64,
            fontWeight: 800,
            lineHeight: 1.1,
            marginBottom: 32,
            textAlign: "center",
          }}
        >
          See your roof with solar
        </div>
        <div
          style={{
            color: "#9ca3af",
            fontSize: 28,
            textAlign: "center",
          }}
        >
          Free estimate for Arizona homeowners
        </div>
        <div
          style={{
            background: "#22d3ee",
            borderRadius: 50,
            color: "#000000",
            fontSize: 24,
            fontWeight: 700,
            marginTop: 48,
            padding: "16px 40px",
          }}
        >
          Get My Free Estimate →
        </div>
      </div>
    ),
    size
  );
}
