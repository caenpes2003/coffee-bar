"use client";

const C = {
  cream: "#FDF8EC",
  parchment: "#F8F1E4",
  paper: "#FFFDF8",
  sand: "#F1E6D2",
  gold: "#B8894A",
  cacao: "#6B4E2E",
  ink: "#2B1D14",
  mute: "#A89883",
};

const FONT_HEADING =
  "var(--font-blackletter), 'UnifrakturCook', 'Old English Text MT', serif";
const FONT_DISPLAY = "var(--font-bebas), 'Bebas Neue', Impact, sans-serif";
const FONT_UI = "var(--font-manrope), system-ui, sans-serif";

/**
 * The home page used to be the public table picker. With physical QRs
 * deployed, that flow is gone: every customer reaches the app via the
 * QR sticker on their table. This screen exists only to:
 *   1. Reassure people who manually typed crown490.com that they're at
 *      the right place.
 *   2. Tell them to scan the QR.
 */
export function ScanQrLanding() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        background: `radial-gradient(ellipse at 50% 0%, ${C.parchment} 0%, ${C.cream} 60%)`,
        color: C.ink,
        fontFamily: FONT_UI,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          padding: "32px 18px 8px",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.png"
          alt="Crown Bar 4.90"
          style={{
            width: "min(60vw, 220px)",
            height: "auto",
            display: "block",
            filter:
              "drop-shadow(0 6px 16px rgba(107,78,46,0.18)) drop-shadow(0 1px 2px rgba(43,29,20,0.12))",
          }}
        />
      </header>

      <section
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px 20px 40px",
        }}
      >
        <div
          style={{
            maxWidth: 420,
            textAlign: "center",
            background: C.paper,
            border: `1px solid ${C.sand}`,
            borderRadius: 18,
            padding: "28px 24px",
            boxShadow:
              "0 1px 0 rgba(43,29,20,0.04), 0 22px 50px -32px rgba(107,78,46,0.4)",
          }}
        >
          <div
            style={{
              fontFamily: FONT_HEADING,
              fontSize: 36,
              color: C.ink,
              lineHeight: 1.05,
              marginBottom: 4,
            }}
          >
            Bienvenido
          </div>
          <p
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 14,
              color: C.gold,
              letterSpacing: 3,
              margin: "0 0 18px",
              textTransform: "uppercase",
            }}
          >
            Pub · Cafetería · Jukebox
          </p>
          <p
            style={{
              fontFamily: FONT_UI,
              fontSize: 15,
              color: C.cacao,
              lineHeight: 1.55,
              margin: "0 0 12px",
            }}
          >
            Para pedir productos y poner música, escanea el QR de tu mesa.
          </p>
          <p
            style={{
              fontFamily: FONT_UI,
              fontSize: 13,
              color: C.mute,
              lineHeight: 1.5,
              margin: 0,
            }}
          >
            Si no encuentras el QR, pídeselo al staff y te ayudamos.
          </p>
        </div>
      </section>

      <footer
        style={{
          padding: "16px 18px calc(16px + env(safe-area-inset-bottom))",
          textAlign: "center",
          fontFamily: FONT_UI,
          fontSize: 11,
          color: C.mute,
          letterSpacing: 1.4,
        }}
      >
        Crown Bar 4.90
      </footer>
    </main>
  );
}
