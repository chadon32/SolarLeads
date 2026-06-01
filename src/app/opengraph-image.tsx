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
          background:
            "radial-gradient(circle at 20% 15%, rgba(34,211,238,0.28), transparent 28%), linear-gradient(135deg, #020617 0%, #0f172a 48%, #111827 100%)",
          color: "#ffffff",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          justifyContent: "center",
          padding: "64px",
          width: "100%",
        }}
      >
        <div
          style={{
            alignItems: "center",
            display: "flex",
            gap: "26px",
          }}
        >
          <div
            style={{
              alignItems: "center",
              background: "#fbbf24",
              borderRadius: "999px",
              boxShadow: "0 0 80px rgba(251,191,36,0.45)",
              display: "flex",
              height: "112px",
              justifyContent: "center",
              width: "112px",
            }}
          >
            <div
              style={{
                background: "#020617",
                borderRadius: "999px",
                height: "42px",
                opacity: 0.18,
                width: "42px",
              }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                color: "#67e8f9",
                fontSize: 30,
                fontWeight: 800,
                letterSpacing: "0.28em",
                textTransform: "uppercase",
              }}
            >
              Arizona Solar AI
            </div>
            <div
              style={{
                fontSize: 76,
                fontWeight: 800,
                letterSpacing: "-0.055em",
                lineHeight: 0.95,
                marginTop: 20,
                maxWidth: 860,
              }}
            >
              See your roof with solar.
            </div>
          </div>
        </div>
        <div
          style={{
            color: "#cbd5e1",
            fontSize: 34,
            marginTop: 40,
          }}
        >
          Free Arizona rooftop analysis and savings estimate
        </div>
        <div
          style={{
            border: "1px solid rgba(103,232,249,0.28)",
            borderRadius: "999px",
            color: "#67e8f9",
            fontSize: 24,
            fontWeight: 700,
            marginTop: 34,
            padding: "14px 28px",
          }}
        >
          solar-leads-psi.vercel.app
        </div>
      </div>
    ),
    size
  );
}
