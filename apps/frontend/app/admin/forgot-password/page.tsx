"use client";

import Link from "next/link";
import { useState, type SyntheticEvent } from "react";
import { authApi } from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";

const C = {
  cream: "#FDF8EC",
  paper: "#FFFDF8",
  sand: "#F1E6D2",
  gold: "#B8894A",
  olive: "#6B7E4A",
  burgundy: "#8B2635",
  burgundySoft: "#E8CDD2",
  ink: "#2B1D14",
  mute: "#A89883",
  cacao: "#6B4E2E",
  shadow:
    "0 1px 0 rgba(43,29,20,0.04), 0 12px 32px -18px rgba(107,78,46,0.28)",
};
const FONT_DISPLAY = "var(--font-bebas)";
const FONT_MONO = "var(--font-manrope)";
const FONT_UI = "var(--font-manrope)";

/**
 * Asks the server to email a reset link. The endpoint always responds
 * "ok" regardless of whether the email is registered, so the UI can't
 * be used to enumerate admin accounts. We mirror that on the client:
 * one success message either way.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!email.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await authApi.forgotPassword(email.trim());
      setDone(true);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: C.cream,
        padding: 24,
        fontFamily: FONT_UI,
      }}
    >
      <form
        onSubmit={submit}
        noValidate
        style={{
          width: "100%",
          maxWidth: 380,
          background: C.paper,
          border: `1px solid ${C.sand}`,
          borderRadius: 18,
          padding: "28px 24px",
          boxShadow: C.shadow,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 6 }}>
          <span style={eyebrowStyle}>— Recuperar acceso</span>
          <h1
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 28,
              color: C.ink,
              margin: "4px 0 0",
              letterSpacing: 1,
              lineHeight: 1.05,
            }}
          >
            Olvidé mi contraseña
          </h1>
        </div>

        {done ? (
          <div
            role="status"
            style={{
              padding: "14px 14px",
              border: `1px solid ${C.olive}55`,
              background: `${C.olive}11`,
              borderRadius: 10,
              fontFamily: FONT_UI,
              fontSize: 13,
              color: C.cacao,
              lineHeight: 1.5,
            }}
          >
            Si la cuenta existe, te enviamos un correo con un enlace para
            restablecer tu contraseña. Revisa tu bandeja (y la carpeta de
            spam). El enlace expira en 1 hora.
          </div>
        ) : (
          <>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: C.cacao,
                lineHeight: 1.5,
              }}
            >
              Escribe el correo de tu cuenta admin y te enviaremos un
              enlace para crear una nueva contraseña.
            </p>
            <label
              htmlFor="forgot-email"
              style={{ display: "flex", flexDirection: "column", gap: 5 }}
            >
              <span style={labelStyle}>Email</span>
              <input
                id="forgot-email"
                type="email"
                required
                autoComplete="username"
                spellCheck={false}
                autoCapitalize="none"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="correo admin"
                style={inputStyle}
              />
            </label>
            {error && (
              <p
                role="alert"
                style={{
                  margin: 0,
                  padding: 10,
                  borderRadius: 8,
                  background: C.burgundySoft,
                  color: C.burgundy,
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  letterSpacing: 1.5,
                  textTransform: "uppercase",
                }}
              >
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={submitting || !email.trim()}
              style={{
                padding: "14px 20px",
                border: "none",
                borderRadius: 999,
                background: submitting
                  ? C.sand
                  : `linear-gradient(135deg, ${C.gold} 0%, #C9944F 100%)`,
                color: submitting ? C.mute : C.paper,
                fontFamily: FONT_DISPLAY,
                fontSize: 15,
                letterSpacing: 3,
                textTransform: "uppercase",
                cursor: submitting ? "not-allowed" : "pointer",
              }}
            >
              {submitting ? "Enviando..." : "Enviar enlace"}
            </button>
          </>
        )}

        <Link
          href="/admin/login"
          style={{
            margin: "4px 0 0",
            textAlign: "center",
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: 1.5,
            color: C.cacao,
            textDecoration: "underline",
            textUnderlineOffset: 3,
          }}
        >
          ← Volver a iniciar sesión
        </Link>
      </form>
    </main>
  );
}

const eyebrowStyle: React.CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 10,
  letterSpacing: 3,
  color: C.mute,
  textTransform: "uppercase",
  fontWeight: 600,
};

const labelStyle: React.CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 10,
  letterSpacing: 2,
  color: C.mute,
  textTransform: "uppercase",
  fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  border: `1px solid ${C.sand}`,
  borderRadius: 10,
  background: C.cream,
  color: C.ink,
  fontFamily: FONT_UI,
  fontSize: 14,
  outline: "none",
  width: "100%",
};
