import { ScanQrLanding } from "@/components/landing/ScanQrLanding";

/**
 * Public root. The customer flow now happens exclusively through the
 * physical QR each table has stuck on it (`crown490.com/mesa/:id?t=…`).
 * Visiting the bare domain shouldn't expose any UI that lets a remote
 * user open a session, so we render a static "scan the QR" page.
 */
export default function Home() {
  return <ScanQrLanding />;
}
