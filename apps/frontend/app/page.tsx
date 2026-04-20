import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { NowPlayingPreview } from "@/components/landing/NowPlayingPreview";
import { Ambience } from "@/components/landing/Ambience";
import { Menu } from "@/components/landing/Menu";
import { Matches } from "@/components/landing/Matches";
import { Footer } from "@/components/landing/Footer";

export default function Home() {
  return (
    <main className="relative flex w-full flex-1 flex-col bg-crown-midnight text-crown-cream">
      <Hero />
      <HowItWorks />
      <NowPlayingPreview />
      <Ambience />
      <Menu />
      <Matches />
      <Footer />
    </main>
  );
}
