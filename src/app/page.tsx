import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Cpu, Layers, PencilRuler, Share2 } from "lucide-react";

import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Smart Campus",
  description:
    "Smart Campus: build interactive maps of your campus, manage IoT devices on the map, and use programming tools for ESP32 and ESP-01 firmware and OTA updates.",
};

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b">
        <div className="flex h-14 w-full items-center px-4 sm:px-6">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2 text-left text-sm font-semibold tracking-tight"
          >
            <Image
              src="/logo.png"
              alt="Smart Campus logo"
              width={28}
              height={28}
              className="size-7 rounded-md object-contain"
              priority
            />
            <span>Smart Campus</span>
          </Link>
          <div className="ml-auto flex shrink-0 items-center justify-end">
            <Button asChild size="sm" variant="ghost">
              <Link href="/login">Sign in</Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="container mx-auto flex flex-1 flex-col items-center justify-center px-6 py-20 text-center">
        <span className="rounded-full border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
          Maps, buildings, and connected devices
        </span>

        <h1 className="mt-6 max-w-3xl text-balance text-4xl font-semibold tracking-tight md:text-5xl">
          One place for your campus map and smart building overlays.
        </h1>

        <p className="mt-5 max-w-2xl text-balance text-base leading-relaxed text-muted-foreground md:text-lg">
          Draw and publish building polygons on your map, place IoT devices with live MQTT
          status, and use the programming workspace for firmware builds and over-the-air updates.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/login">
              Sign in
              <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/dashboard">Open dashboard</Link>
          </Button>
        </div>

        <ul className="mt-16 grid w-full max-w-4xl grid-cols-1 gap-6 text-left sm:grid-cols-2 lg:grid-cols-4">
          <Feature
            icon={<PencilRuler className="size-4" />}
            title="Map editor"
            body="Upload a base image, draw polygons and rectangles, edit vertices, and attach building metadata."
          />
          <Feature
            icon={<Layers className="size-4" />}
            title="Search & publish"
            body="Categories, filters, and search on the public view. Publish when you are ready and share read-only links."
          />
          <Feature
            icon={<Cpu className="size-4" />}
            title="IoT on the map"
            body="Place lights, valves, and a per-map temp/humidity sensor; see live status on the map and public IoT view."
          />
          <Feature
            icon={<Share2 className="size-4" />}
            title="Programming & OTA"
            body="Generate device code, upload firmware builds, and push OTA updates from the programming dashboard."
          />
        </ul>
      </section>

    </main>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <li className="space-y-1.5">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className="flex size-7 items-center justify-center rounded-md border bg-muted/40 text-muted-foreground">
          {icon}
        </span>
        {title}
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
    </li>
  );
}
