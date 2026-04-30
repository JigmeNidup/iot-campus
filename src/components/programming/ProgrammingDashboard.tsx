"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import type { FirmwareBuild, IotDevice } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { MqttClient } from "mqtt";
import { connectMqttClient, disconnectMqttClient, subscribeToTopic } from "@/lib/mqtt-client";

interface ProgrammingDashboardProps {
  maps: { id: string; name: string }[];
}

type BoardTarget = "esp32" | "esp01";
type ProgrammingTab = "code" | "base" | "firmware" | "ota" | "webserial";
type BaseCodeType = "light" | "water_valve" | "temp_humidity";
type DeviceTypeFilter = "all" | "light" | "water_valve" | "temp_humidity";
type BaudRate = 9600 | 115200 | 230400 | 460800;

export function ProgrammingDashboard({ maps }: ProgrammingDashboardProps) {
  const [selectedMapId, setSelectedMapId] = useState(maps[0]?.id ?? "");
  const [devices, setDevices] = useState<IotDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [wifiSsid, setWifiSsid] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [board, setBoard] = useState<BoardTarget>("esp32");
  const [tab, setTab] = useState<ProgrammingTab>("code");
  const [baseCodeType, setBaseCodeType] = useState<BaseCodeType>("light");
  const [baseCodeContent, setBaseCodeContent] = useState("");
  const [baseCodePath, setBaseCodePath] = useState("");
  const [baseCodeLoading, setBaseCodeLoading] = useState(false);
  const [builds, setBuilds] = useState<FirmwareBuild[]>([]);
  const [selectedBuildId, setSelectedBuildId] = useState<string>("");
  const [version, setVersion] = useState("v1.0.0");
  const [changelog, setChangelog] = useState("");
  const [uploading, setUploading] = useState(false);
  const [deletingBuildId, setDeletingBuildId] = useState<string | null>(null);
  const [firmwareFilterType, setFirmwareFilterType] = useState<DeviceTypeFilter>("all");
  const [pushing, setPushing] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [otaDiagnostics, setOtaDiagnostics] = useState<{
    broker: string;
    topic: string;
    origin: string;
    compatibility: {
      deviceTypeMatchesBuild: boolean;
      boardTargetMatchesBuild: boolean;
    };
    payload: {
      action: string;
      url: string;
      version: string;
      buildId: string;
      checksum: string;
      downloadUrl: string;
    };
  } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const mqttRef = useRef<MqttClient | null>(null);
  const [serialSupported, setSerialSupported] = useState(false);
  const [serialConnected, setSerialConnected] = useState(false);
  const [serialBusy, setSerialBusy] = useState(false);
  const [baudRate, setBaudRate] = useState<BaudRate>(115200);
  const [serialLog, setSerialLog] = useState("");
  const [serialInput, setSerialInput] = useState("");
  const [flashFile, setFlashFile] = useState<File | null>(null);
  const [flashAddress, setFlashAddress] = useState("0x1000");
  const [webToolsReady, setWebToolsReady] = useState(false);
  const [flashManifestUrl, setFlashManifestUrl] = useState<string | null>(null);
  const [flashHint, setFlashHint] = useState("");
  const [flashWarning, setFlashWarning] = useState("");
  const [webserialBuilds, setWebserialBuilds] = useState<FirmwareBuild[]>([]);
  const [selectedWebserialBuildId, setSelectedWebserialBuildId] = useState("");
  const [selectedWebserialBuildUrl, setSelectedWebserialBuildUrl] = useState("");
  const [loadingWebserialBuilds, setLoadingWebserialBuilds] = useState(false);
  const installButtonHostRef = useRef<HTMLDivElement | null>(null);
  const serialPortRef = useRef<{
    port: {
      open: (options: { baudRate: number }) => Promise<void>;
      close: () => Promise<void>;
      writable?: WritableStream<Uint8Array>;
      readable?: ReadableStream<Uint8Array>;
    };
    reader?: ReadableStreamDefaultReader<Uint8Array>;
    keepReading: boolean;
  } | null>(null);

  useEffect(() => {
    if (!selectedMapId) return;
    async function loadDevices() {
      setLoading(true);
      try {
        const res = await fetch(`/api/maps/${selectedMapId}/devices`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load devices");
        const rows = (data.devices ?? []) as IotDevice[];
        setDevices(rows);
        setSelectedDeviceId((prev) =>
          prev && rows.some((d) => d.id === prev) ? prev : rows[0]?.id ?? null,
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load devices");
      } finally {
        setLoading(false);
      }
    }
    void loadDevices();
  }, [selectedMapId]);

  const selectedDevice = useMemo(
    () => devices.find((d) => d.id === selectedDeviceId) ?? null,
    [devices, selectedDeviceId],
  );
  const selectedWebserialBuild = useMemo(
    () => webserialBuilds.find((b) => b.id === selectedWebserialBuildId) ?? null,
    [webserialBuilds, selectedWebserialBuildId],
  );

  const generatedCode = useMemo(() => {
    if (!selectedDevice) return "";
    return generateCode(selectedDevice, board, wifiSsid, wifiPassword);
  }, [selectedDevice, board, wifiSsid, wifiPassword]);

  useEffect(() => {
    if (tab !== "base") return;
    setBaseCodeLoading(true);
    async function loadBaseCode() {
      try {
        const params = new URLSearchParams({
          deviceType: baseCodeType,
          board,
        });
        const res = await fetch(`/api/programming/base-code?${params.toString()}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load base code");
        setBaseCodeContent((data.content as string) ?? "");
        setBaseCodePath((data.path as string) ?? "");
      } catch (err) {
        setBaseCodeContent("");
        setBaseCodePath("");
        toast.error(err instanceof Error ? err.message : "Failed to load base code");
      } finally {
        setBaseCodeLoading(false);
      }
    }
    void loadBaseCode();
  }, [tab, baseCodeType, board]);

  useEffect(() => {
    if (!selectedDevice) return;
    const selectedDeviceType = selectedDevice.type;
    setBuilds([]);
    setSelectedBuildId("");
    async function loadBuilds() {
      try {
        const params = new URLSearchParams({
          deviceType: selectedDeviceType,
          boardTarget: board,
        });
        const res = await fetch(`/api/ota/firmware?${params.toString()}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load firmware builds");
        const rows = (data.builds ?? []) as FirmwareBuild[];
        setBuilds(rows);
        if (rows.length > 0) setSelectedBuildId(rows[0].id);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load firmware builds");
      }
    }
    void loadBuilds();
  }, [selectedDevice?.id, selectedDevice?.type, board]);

  useEffect(() => {
    if (tab !== "firmware") return;
    async function loadBuildsForManager() {
      try {
        const params = new URLSearchParams({
          boardTarget: board,
        });
        if (firmwareFilterType !== "all") {
          params.set("deviceType", firmwareFilterType);
        }
        const res = await fetch(`/api/ota/firmware?${params.toString()}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load firmware builds");
        setBuilds((data.builds ?? []) as FirmwareBuild[]);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load firmware builds");
      }
    }
    void loadBuildsForManager();
  }, [tab, board, firmwareFilterType]);

  useEffect(() => {
    setSerialSupported(
      typeof navigator !== "undefined" &&
        "serial" in (navigator as Navigator & { serial?: unknown }),
    );
  }, []);

  useEffect(() => {
    if (tab !== "ota" || !selectedMapId) return;
    const timer = setInterval(() => {
      void (async () => {
        const res = await fetch(`/api/maps/${selectedMapId}/devices`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        setDevices(data.devices ?? []);
      })();
    }, 5000);
    return () => clearInterval(timer);
  }, [tab, selectedMapId]);

  useEffect(() => {
    if (tab !== "webserial") return;
    if ((window as Window & { customElements?: CustomElementRegistry }).customElements?.get("esp-web-install-button")) {
      setWebToolsReady(true);
      return;
    }
    const script = document.createElement("script");
    script.type = "module";
    script.src = "https://unpkg.com/esp-web-tools@10.2.1/dist/web/install-button.js";
    script.onload = () => setWebToolsReady(true);
    script.onerror = () =>
      toast.error("Failed to load ESP Web Tools script");
    document.head.appendChild(script);
    return () => {
      script.remove();
    };
  }, [tab]);

  useEffect(() => {
    if (tab !== "webserial") return;
    setLoadingWebserialBuilds(true);
    async function loadWebserialBuilds() {
      try {
        const params = new URLSearchParams({ boardTarget: board });
        if (selectedDevice?.type) params.set("deviceType", selectedDevice.type);
        const res = await fetch(`/api/ota/firmware?${params.toString()}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load firmware builds");
        const rows = (data.builds ?? []) as FirmwareBuild[];
        setWebserialBuilds(rows);
        setSelectedWebserialBuildId(rows[0]?.id ?? "");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load firmware builds");
      } finally {
        setLoadingWebserialBuilds(false);
      }
    }
    void loadWebserialBuilds();
  }, [tab, board, selectedDevice?.type]);

  useEffect(() => {
    if (!selectedWebserialBuildId || tab !== "webserial") {
      setSelectedWebserialBuildUrl("");
      return;
    }
    async function loadBuildUrl() {
      try {
        const res = await fetch(
          `/api/ota/firmware/${selectedWebserialBuildId}/webserial-url`,
          { cache: "no-store" },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to prepare firmware URL");
        setSelectedWebserialBuildUrl(data.url ?? "");
      } catch (err) {
        setSelectedWebserialBuildUrl("");
        toast.error(err instanceof Error ? err.message : "Failed to prepare firmware URL");
      }
    }
    void loadBuildUrl();
  }, [selectedWebserialBuildId, tab]);

  useEffect(() => {
    if (!flashFile && !selectedWebserialBuildUrl) {
      setFlashManifestUrl(null);
      setFlashHint("");
      setFlashWarning("");
      return;
    }
    const sourceName = flashFile?.name || selectedWebserialBuild?.filePath || "selected-build.bin";
    const name = sourceName.toLowerCase();
    const isMerged = name.endsWith(".merged.bin");
    const isInoBin = name.endsWith(".ino.bin");

    if (board === "esp32") {
      if (isMerged) {
        setFlashAddress("0x0");
        setFlashHint("Detected merged ESP32 firmware. Recommended flash address: 0x0");
        setFlashWarning("");
      } else if (isInoBin) {
        setFlashAddress("0x10000");
        setFlashHint("Detected app-only ESP32 firmware. Recommended flash address: 0x10000");
        setFlashWarning("");
      } else {
        setFlashHint("Unknown ESP32 binary type. Verify offset manually.");
      }
    } else {
      if (isMerged) {
        setFlashAddress("0x0");
        setFlashHint("Detected merged ESP8266 firmware. Recommended flash address: 0x0");
        setFlashWarning("");
      } else if (isInoBin) {
        setFlashAddress("0x0");
        setFlashHint("ESP8266 app binaries are typically flashed from 0x0.");
        setFlashWarning("");
      } else {
        setFlashHint("Unknown ESP8266 binary type. Verify offset manually.");
      }
    }

    const binUrl = selectedWebserialBuildUrl || URL.createObjectURL(flashFile as File);
    const parsedOffset = parseInt(flashAddress, 16);
    const offset = Number.isFinite(parsedOffset) ? parsedOffset : 0x1000;
    const manifest = {
      name: selectedDevice?.name
        ? `${selectedDevice.name} Firmware`
        : "ESP Firmware",
      version: version || "v1.0.0",
      builds: [
        {
          chipFamily: board === "esp32" ? "ESP32" : "ESP8266",
          parts: [{ path: binUrl, offset }],
        },
      ],
    };
    const manifestBlob = new Blob([JSON.stringify(manifest, null, 2)], {
      type: "application/json",
    });
    const manifestUrl = URL.createObjectURL(manifestBlob);
    setFlashManifestUrl(manifestUrl);
    return () => {
      if (!selectedWebserialBuildUrl) URL.revokeObjectURL(binUrl);
      URL.revokeObjectURL(manifestUrl);
    };
  }, [
    flashFile,
    selectedWebserialBuildUrl,
    flashAddress,
    board,
    selectedDevice?.name,
    selectedWebserialBuild?.filePath,
    version,
  ]);

  useEffect(() => {
    if (!flashFile && !selectedWebserialBuildUrl) return;
    const name = (flashFile?.name || selectedWebserialBuild?.filePath || "selected-build.bin").toLowerCase();
    const isMerged = name.endsWith(".merged.bin");
    const addr = flashAddress.toLowerCase();

    if (board === "esp32" && isMerged && addr !== "0x0") {
      setFlashWarning("Merged ESP32 firmware should be flashed at 0x0.");
      return;
    }
    if (board === "esp32" && !isMerged && name.endsWith(".ino.bin") && addr !== "0x10000") {
      setFlashWarning("App-only ESP32 .ino.bin should usually be flashed at 0x10000.");
      return;
    }
    if (board === "esp32" && addr === "0x1000" && !isMerged) {
      setFlashWarning("0x1000 is typically bootloader region, not app firmware.");
      return;
    }
    setFlashWarning("");
  }, [flashAddress, flashFile, selectedWebserialBuild?.filePath, selectedWebserialBuildUrl, board]);

  useEffect(() => {
    const host = installButtonHostRef.current;
    if (!host) return;
    host.innerHTML = "";
    if (!webToolsReady || !flashManifestUrl) return;
    const el = document.createElement("esp-web-install-button");
    el.setAttribute("manifest", flashManifestUrl);
    el.setAttribute("erase-first", "");
    host.appendChild(el);
  }, [webToolsReady, flashManifestUrl]);

  useEffect(() => {
    if (tab !== "ota" || !selectedMapId) return;
    const client = connectMqttClient("wss://broker.hivemq.com:8884/mqtt");
    mqttRef.current = client;
    const ackTopic = `campus/${selectedMapId}/device/+/ota/ack`;
    const onMessage = (topic: string, payload: Uint8Array) => {
      if (!topic.endsWith("/ota/ack")) return;
      const parts = topic.split("/");
      const deviceId = parts[3];
      if (!deviceId) return;
      try {
        const parsed = JSON.parse(payload.toString()) as { status?: string };
        if (!parsed.status) return;
        void fetch("/api/iot/ota/ack", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mapId: selectedMapId,
            deviceId,
            status: parsed.status,
          }),
        });
        setDevices((prev) =>
          prev.map((d) =>
            d.id === deviceId
              ? { ...d, otaStatus: parsed.status, lastSeenAt: new Date().toISOString() }
              : d,
          ),
        );
      } catch {
        // ignore malformed payload
      }
    };
    client.on("message", onMessage);
    void subscribeToTopic(client, ackTopic);
    return () => {
      client.removeListener("message", onMessage);
      client.unsubscribe(ackTopic);
      disconnectMqttClient();
    };
  }, [tab, selectedMapId]);

  async function copyCode(code: string) {
    try {
      if (navigator.clipboard && (window.isSecureContext || location.hostname === "localhost")) {
        await navigator.clipboard.writeText(code);
        toast.success("Code copied");
        return;
      }
    } catch {
      // fallback below
    }

    try {
      const textArea = document.createElement("textarea");
      textArea.value = code;
      textArea.setAttribute("readonly", "");
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      textArea.style.left = "-9999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      textArea.setSelectionRange(0, textArea.value.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(textArea);
      if (ok) {
        toast.success("Code copied");
      } else {
        toast.error("Copy blocked by browser. Use HTTPS for reliable copy.");
      }
    } catch {
      toast.error("Failed to copy code");
    }
  }

  function appendSerialLog(text: string) {
    setSerialLog((prev) => {
      const next = prev + text;
      return next.length > 12000 ? next.slice(next.length - 12000) : next;
    });
  }

  async function connectWebSerial() {
    try {
      setSerialBusy(true);
      const nav = navigator as Navigator & {
        serial: {
          requestPort: () => Promise<{
            open: (options: { baudRate: number }) => Promise<void>;
            close: () => Promise<void>;
            writable?: WritableStream<Uint8Array>;
            readable?: ReadableStream<Uint8Array>;
          }>;
        };
      };
      const port = await nav.serial.requestPort();
      await port.open({ baudRate });
      serialPortRef.current = { port, keepReading: true };
      setSerialConnected(true);
      appendSerialLog(`\n[system] Connected at ${baudRate} baud\n`);

      if (port.readable) {
        const reader = port.readable.getReader();
        serialPortRef.current.reader = reader;
        void (async () => {
          try {
            while (serialPortRef.current?.keepReading) {
              const { value, done } = await reader.read();
              if (done) break;
              if (value) {
                const chunk = new TextDecoder().decode(value);
                appendSerialLog(chunk);
              }
            }
          } catch {
            // Ignore transient read errors during disconnect/reset.
          }
        })();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to connect WebSerial");
    } finally {
      setSerialBusy(false);
    }
  }

  async function disconnectWebSerial() {
    const ref = serialPortRef.current;
    if (!ref) return;
    try {
      setSerialBusy(true);
      ref.keepReading = false;
      await ref.reader?.cancel().catch(() => undefined);
      ref.reader?.releaseLock();
      await ref.port.close();
      serialPortRef.current = null;
      setSerialConnected(false);
      appendSerialLog("\n[system] Disconnected\n");
    } catch {
      toast.error("Failed to disconnect serial port");
    } finally {
      setSerialBusy(false);
    }
  }

  async function sendSerialLine() {
    const ref = serialPortRef.current;
    if (!ref?.port.writable || !serialInput.trim()) return;
    try {
      const writer = ref.port.writable.getWriter();
      const payload = new TextEncoder().encode(serialInput + "\r\n");
      await writer.write(payload);
      writer.releaseLock();
      appendSerialLog(`\n> ${serialInput}\n`);
      setSerialInput("");
    } catch {
      toast.error("Failed to send serial command");
    }
  }

  async function uploadFirmwareFile(file: File) {
    if (!selectedDevice) return;
    setUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
      }
      const binaryBase64 = btoa(binary);
      const res = await fetch("/api/ota/firmware", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceType: selectedDevice.type,
          boardTarget: board,
          version,
          changelog: changelog || null,
          originalFileName: file.name,
          binaryBase64,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Firmware upload failed");
      setBuilds((prev) => [data.build as FirmwareBuild, ...prev]);
      setSelectedBuildId(data.build.id as string);
      toast.success("Firmware build uploaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Firmware upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function deleteFirmwareBuild(buildId: string) {
    const ok = window.confirm("Delete this firmware from storage? This cannot be undone.");
    if (!ok) return;
    setDeletingBuildId(buildId);
    try {
      const res = await fetch(`/api/ota/firmware/${buildId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete firmware build");
      setBuilds((prev) => prev.filter((b) => b.id !== buildId));
      if (selectedBuildId === buildId) {
        setSelectedBuildId("");
      }
      if (selectedWebserialBuildId === buildId) {
        setSelectedWebserialBuildId("");
      }
      toast.success("Firmware deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete firmware build");
    } finally {
      setDeletingBuildId(null);
    }
  }

  function firmwareKindLabel(filePath: string) {
    const name = filePath.toLowerCase();
    if (name.endsWith(".merged.bin")) return "merged";
    if (name.endsWith(".ino.bin")) return "app-only";
    return "bin";
  }

  async function pushOta(deviceId: string) {
    if (!selectedMapId || !selectedBuildId) {
      toast.error("Select map and firmware build first");
      return;
    }
    setPushing(true);
    try {
      const res = await fetch("/api/ota/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mapId: selectedMapId,
          deviceIds: [deviceId],
          firmwareBuildId: selectedBuildId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to push OTA update");
      const failed = (data.outcomes ?? []).filter((o: { ok: boolean }) => !o.ok);
      if (failed.length > 0) {
        const first = failed[0] as { topic?: string; error?: string };
        toast.error(
          `OTA publish failed (${failed.length}). ${first?.error || "Unknown error"}${first?.topic ? ` | topic: ${first.topic}` : ""}`,
        );
      } else {
        toast.success("OTA push queued");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to push OTA update");
    } finally {
      setPushing(false);
    }
  }

  async function runOtaDiagnostics() {
    if (!selectedMapId || !selectedBuildId || !selectedDevice) {
      toast.error("Select map, device and firmware build first");
      return;
    }
    setDiagnosing(true);
    try {
      const res = await fetch("/api/ota/diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mapId: selectedMapId,
          deviceId: selectedDevice.id,
          firmwareBuildId: selectedBuildId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to run OTA diagnostics");
      setOtaDiagnostics(data.diagnostics ?? null);
      toast.success("OTA diagnostics generated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to run OTA diagnostics");
    } finally {
      setDiagnosing(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b bg-background px-4 py-2">
        <Select value={selectedMapId} onValueChange={setSelectedMapId}>
          <SelectTrigger className="w-[280px]">
            <SelectValue placeholder="Select map" />
          </SelectTrigger>
          <SelectContent>
            {maps.map((map) => (
              <SelectItem key={map.id} value={map.id}>
                {map.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="w-[220px]"
          placeholder="WiFi SSID"
          value={wifiSsid}
          onChange={(e) => setWifiSsid(e.target.value)}
        />
        <Input
          className="w-[220px]"
          placeholder="WiFi Password"
          value={wifiPassword}
          onChange={(e) => setWifiPassword(e.target.value)}
        />
        <Select value={board} onValueChange={(v) => setBoard(v as BoardTarget)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="esp32">ESP32</SelectItem>
            <SelectItem value="esp01">ESP-01</SelectItem>
          </SelectContent>
        </Select>
        <Tabs value={tab} onValueChange={(v) => setTab(v as ProgrammingTab)}>
          <TabsList>
            <TabsTrigger value="code">Code Generation</TabsTrigger>
            <TabsTrigger value="base">Base-code</TabsTrigger>
            <TabsTrigger value="firmware">Firmware Manager</TabsTrigger>
            <TabsTrigger value="ota">Over-the-Air Update</TabsTrigger>
            <TabsTrigger value="webserial">WebSerial</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-h-0 min-w-0 flex-1 overflow-auto bg-muted/20 p-4">
          {!selectedDevice ? (
            <div className="rounded-lg border border-dashed bg-background p-6 text-sm text-muted-foreground">
              Select a device to generate `.ino` firmware.
            </div>
          ) : tab === "code" ? (
            <div className="rounded-lg border bg-background">
              <div className="flex items-center justify-between border-b px-4 py-2">
                <div className="text-sm font-medium">
                  {selectedDevice.name} - {board.toUpperCase()} firmware
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void copyCode(generatedCode)}
                >
                  <Copy className="size-4" />
                  Copy code
                </Button>
              </div>
              <pre className="overflow-auto p-4 text-xs leading-5">
                <code>{generatedCode}</code>
              </pre>
            </div>
          ) : tab === "base" ? (
            <div className="rounded-lg border bg-background">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Base firmware</span>
                  <Select
                    value={baseCodeType}
                    onValueChange={(v) => setBaseCodeType(v as BaseCodeType)}
                  >
                    <SelectTrigger className="h-8 w-[190px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="light">Light</SelectItem>
                      <SelectItem value="water_valve">Water Valve</SelectItem>
                      <SelectItem value="temp_humidity">Temp/Humidity</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void copyCode(baseCodeContent)}
                  disabled={!baseCodeContent}
                >
                  <Copy className="size-4" />
                  Copy base code
                </Button>
              </div>
              {baseCodePath ? (
                <div className="border-b px-4 py-1 text-xs text-muted-foreground">
                  Source: {baseCodePath}
                </div>
              ) : null}
              <pre className="overflow-auto p-4 text-xs leading-5">
                <code>
                  {baseCodeLoading
                    ? "// Loading base firmware..."
                    : baseCodeContent || "// Base firmware not available."}
                </code>
              </pre>
            </div>
          ) : tab === "firmware" ? (
            <div className="space-y-4">
              <div className="rounded-lg border bg-background p-4">
                <div className="mb-3 text-sm font-medium">Upload firmware to storage</div>
                <div className="grid gap-3 md:grid-cols-4">
                  <Input
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    placeholder="Version (e.g. v1.0.2)"
                  />
                  <Input
                    value={changelog}
                    onChange={(e) => setChangelog(e.target.value)}
                    placeholder="Changelog (optional)"
                  />
                  <Select
                    value={selectedDevice?.type ?? "light"}
                    onValueChange={(nextType) => {
                      if (!selectedDevice) return;
                      const next = devices.find((d) => d.type === nextType);
                      if (next) setSelectedDeviceId(next.id);
                    }}
                    disabled={devices.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Device type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="light">Light</SelectItem>
                      <SelectItem value="water_valve">Water Valve</SelectItem>
                      <SelectItem value="temp_humidity">Temp/Humidity</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    disabled={uploading || !selectedDevice}
                    onClick={() => fileRef.current?.click()}
                  >
                    <Upload className="size-4" />
                    {uploading ? "Uploading..." : "Upload .bin"}
                  </Button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".bin"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadFirmwareFile(f);
                      e.currentTarget.value = "";
                    }}
                  />
                </div>
              </div>

              <div className="rounded-lg border bg-background p-4">
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <div className="text-sm font-medium">Stored firmware builds</div>
                  <Select
                    value={firmwareFilterType}
                    onValueChange={(v) => setFirmwareFilterType(v as DeviceTypeFilter)}
                  >
                    <SelectTrigger className="w-[200px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All device types</SelectItem>
                      <SelectItem value="light">Light</SelectItem>
                      <SelectItem value="water_valve">Water Valve</SelectItem>
                      <SelectItem value="temp_humidity">Temp/Humidity</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {builds.length === 0 ? (
                  <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                    No firmware builds found for current filters.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {builds.map((build) => (
                      <div
                        key={build.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                      >
                        <div className="text-sm">
                          <div className="font-medium">
                            {build.version} - {build.deviceType} - {build.boardTarget} - {firmwareKindLabel(build.filePath)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {build.sizeBytes} bytes
                            {build.changelog ? ` - ${build.changelog}` : ""}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={deletingBuildId === build.id}
                          onClick={() => void deleteFirmwareBuild(build.id)}
                        >
                          <Trash2 className="size-4" />
                          {deletingBuildId === build.id ? "Deleting..." : "Delete"}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : tab === "webserial" ? (
            <div className="space-y-4">
              <div className="rounded-lg border bg-background p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Select
                    value={String(baudRate)}
                    onValueChange={(v) => setBaudRate(Number(v) as BaudRate)}
                  >
                    <SelectTrigger className="w-[160px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="9600">9600</SelectItem>
                      <SelectItem value="115200">115200</SelectItem>
                      <SelectItem value="230400">230400</SelectItem>
                      <SelectItem value="460800">460800</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    disabled={!serialSupported || serialConnected || serialBusy}
                    onClick={() => void connectWebSerial()}
                  >
                    Connect
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!serialConnected}
                    onClick={() => void disconnectWebSerial()}
                  >
                    Disconnect
                  </Button>
                  <Badge variant={serialConnected ? "default" : "outline"}>
                    {serialConnected ? "Connected" : "Not connected"}
                  </Badge>
                </div>
                {!serialSupported ? (
                  <p className="text-xs text-destructive">
                    WebSerial is not supported in this browser. Use Chrome/Edge over HTTPS or localhost.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Use this tab as a live serial monitor and command console for ESP devices over USB.
                  </p>
                )}
              </div>

              <div className="rounded-lg border bg-background">
                <div className="flex items-center justify-between border-b px-4 py-2">
                  <div className="text-sm font-medium">Serial monitor</div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSerialLog("")}
                  >
                    Clear
                  </Button>
                </div>
                <pre className="h-[360px] overflow-auto bg-black p-4 text-xs leading-5 text-green-300">
                  <code>{serialLog || "[No serial output yet]"}</code>
                </pre>
                <div className="flex gap-2 border-t p-3">
                  <Input
                    placeholder="Type serial command and press Send"
                    value={serialInput}
                    onChange={(e) => setSerialInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void sendSerialLine();
                      }
                    }}
                    disabled={!serialConnected}
                  />
                  <Button
                    onClick={() => void sendSerialLine()}
                    disabled={!serialConnected || !serialInput.trim()}
                  >
                    Send
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border bg-background p-4">
                <div className="mb-3 text-sm font-medium">Browser flashing (.bin)</div>
                <div className="grid gap-3 md:grid-cols-3">
                  <Select
                    value={selectedWebserialBuildId}
                    onValueChange={(v) => {
                      setSelectedWebserialBuildId(v);
                      setFlashFile(null);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          loadingWebserialBuilds
                            ? "Loading saved builds..."
                            : "Select saved build from uploads"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {webserialBuilds.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.version} - {b.boardTarget} - {b.deviceType} - {firmwareKindLabel(b.filePath)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="file"
                    accept=".bin,application/octet-stream"
                    onChange={(e) => {
                      setFlashFile(e.target.files?.[0] ?? null);
                      setSelectedWebserialBuildId("");
                    }}
                  />
                  <Input
                    value={flashAddress}
                    onChange={(e) => setFlashAddress(e.target.value)}
                    placeholder="Flash address (hex), e.g. 0x1000"
                  />
                  <div className="flex items-center">
                    <Badge variant={flashFile || selectedWebserialBuild ? "default" : "outline"}>
                      {flashFile?.name || selectedWebserialBuild?.filePath || "No firmware selected"}
                    </Badge>
                  </div>
                </div>
                <div className="mt-3 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                  Recommended: use `.merged.bin` for first/full flash. Connect ESP via USB and use install button below.
                  You can choose a saved build from uploads or manually pick a local `.bin`.
                </div>
                {flashHint ? (
                  <div className="mt-2 text-xs text-muted-foreground">{flashHint}</div>
                ) : null}
                {flashWarning ? (
                  <div className="mt-2 rounded-md border border-destructive/50 bg-destructive/10 px-2 py-1 text-xs text-destructive">
                    {flashWarning}
                  </div>
                ) : null}
                <div className="mt-3" ref={installButtonHostRef} />
                {!webToolsReady ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Loading ESP Web Tools...
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border bg-background p-4">
                <div className="mb-3 text-sm font-medium">Firmware package</div>
                <div className="grid gap-3 md:grid-cols-3">
                  <Input
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    placeholder="Version (e.g. v1.0.2)"
                  />
                  <Input
                    value={changelog}
                    onChange={(e) => setChangelog(e.target.value)}
                    placeholder="Changelog (optional)"
                  />
                  <Button
                    variant="outline"
                    disabled={uploading || !selectedDevice}
                    onClick={() => fileRef.current?.click()}
                  >
                    <Upload className="size-4" />
                    {uploading ? "Uploading..." : "Upload .bin"}
                  </Button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".bin"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadFirmwareFile(f);
                      e.currentTarget.value = "";
                    }}
                  />
                </div>
              </div>

              <div className="rounded-lg border bg-background p-4">
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <Select
                    value={selectedBuildId}
                    onValueChange={setSelectedBuildId}
                  >
                    <SelectTrigger className="w-[320px]">
                      <SelectValue placeholder="Select firmware build" />
                    </SelectTrigger>
                    <SelectContent>
                      {builds.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.version} - {b.boardTarget} - {b.deviceType} - {firmwareKindLabel(b.filePath)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    disabled={pushing || !selectedBuildId || !selectedDevice}
                    onClick={() =>
                      selectedDevice ? void pushOta(selectedDevice.id) : undefined
                    }
                  >
                    Push Update To Selected Device
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground">
                  Base lifecycle: initial base firmware flash {"->"} AP registration {"->"} OTA update via MQTT trigger + HTTP firmware download.
                </div>
              </div>

              <div className="rounded-lg border bg-background p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-sm font-medium">OTA diagnostics</div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={diagnosing || !selectedDevice || !selectedBuildId}
                    onClick={() => void runOtaDiagnostics()}
                  >
                    {diagnosing ? "Running..." : "Run diagnostics"}
                  </Button>
                </div>
                {!otaDiagnostics ? (
                  <div className="text-xs text-muted-foreground">
                    Run diagnostics to inspect broker/topic/payload and download URL used for OTA.
                  </div>
                ) : (
                  <div className="space-y-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Broker:</span> {otaDiagnostics.broker}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Topic:</span> {otaDiagnostics.topic}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Origin:</span> {otaDiagnostics.origin}
                    </div>
                    <div className="flex gap-2">
                      <Badge
                        variant={
                          otaDiagnostics.compatibility.deviceTypeMatchesBuild
                            ? "default"
                            : "destructive"
                        }
                      >
                        Type match:{" "}
                        {otaDiagnostics.compatibility.deviceTypeMatchesBuild
                          ? "OK"
                          : "Mismatch"}
                      </Badge>
                      <Badge
                        variant={
                          otaDiagnostics.compatibility.boardTargetMatchesBuild
                            ? "default"
                            : "destructive"
                        }
                      >
                        Board match:{" "}
                        {otaDiagnostics.compatibility.boardTargetMatchesBuild
                          ? "OK"
                          : "Mismatch"}
                      </Badge>
                    </div>
                    <div className="rounded-md border bg-muted/30 p-2">
                      <div className="mb-1 text-muted-foreground">MQTT payload preview</div>
                      <pre className="overflow-auto whitespace-pre-wrap break-all">
                        {JSON.stringify(otaDiagnostics.payload, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <aside className="hidden w-[380px] shrink-0 overflow-y-auto border-l bg-background lg:block">
          <div className="space-y-3 p-4">
            <h3 className="text-sm font-medium">IoT Devices ({devices.length})</h3>
            {loading ? (
              <>
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </>
            ) : devices.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No devices found for this map.
              </div>
            ) : (
              devices.map((device) => {
                const codeForCard = generateCode(device, board, wifiSsid, wifiPassword);
                return (
                  <div
                    key={device.id}
                    className={cn(
                      "rounded-lg border bg-card p-3 transition-colors",
                      selectedDeviceId === device.id
                        ? "border-primary/60 bg-primary/10 ring-1 ring-primary/30"
                        : "",
                    )}
                    onPointerDown={() => setSelectedDeviceId(device.id)}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{device.name}</p>
                      <Badge variant={device.state ? "default" : "outline"}>
                        {device.state ? "ON" : "OFF"}
                      </Badge>
                    </div>
                    <div className="mb-2 text-xs text-muted-foreground">
                      {device.type === "light"
                        ? "Light"
                        : device.type === "water_valve"
                          ? "Water Valve"
                          : "Temp/Humidity"}
                    </div>
                    <div className="mb-2 text-xs">
                      <span className="text-muted-foreground">FW:</span>{" "}
                      {device.firmwareVersion ?? "--"}{" "}
                      <span className="ml-2 text-muted-foreground">OTA:</span>{" "}
                      {device.otaStatus ?? "--"}
                    </div>
                    <div className="flex items-center justify-between">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={tab !== "ota" || !selectedBuildId}
                        onClick={(e) => {
                          e.stopPropagation();
                          void pushOta(device.id);
                        }}
                      >
                        Push OTA
                      </Button>
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          void copyCode(codeForCard);
                        }}
                        aria-label="Copy generated code"
                      >
                        <Copy className="size-4" />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function esc(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function generateCode(
  device: IotDevice,
  board: BoardTarget,
  wifiSsid: string,
  wifiPassword: string,
) {
  const ssid = wifiSsid || "YOUR_WIFI_SSID";
  const password = wifiPassword || "YOUR_WIFI_PASSWORD";
  const clientId = `${board}-${device.type}-${device.id.slice(0, 8)}`;
  const commandTopic = `${device.mqttTopicPrefix}/command`;
  const statusTopic = `${device.mqttTopicPrefix}/status`;

  if (device.type === "temp_humidity") {
    return board === "esp32"
      ? tempHumiEsp32(ssid, password, clientId, commandTopic, statusTopic)
      : tempHumiEsp01(ssid, password, clientId, commandTopic, statusTopic);
  }

  return board === "esp32"
    ? actuatorEsp32(device.type, ssid, password, clientId, commandTopic, statusTopic)
    : actuatorEsp01(device.type, ssid, password, clientId, commandTopic, statusTopic);
}

function actuatorEsp32(
  type: "light" | "water_valve",
  ssid: string,
  password: string,
  clientId: string,
  commandTopic: string,
  statusTopic: string,
) {
  const pin = type === "light" ? 2 : 4;
  return [
    '#include <WiFi.h>',
    '#include <PubSubClient.h>',
    "",
    `static const char* DEVICE_TYPE = "${type}";`,
    `static const char* WIFI_SSID = "${esc(ssid)}";`,
    `static const char* WIFI_PASSWORD = "${esc(password)}";`,
    'static const char* MQTT_BROKER = "broker.hivemq.com";',
    "static const uint16_t MQTT_PORT = 1883;",
    `static const char* MQTT_CLIENT_ID = "${clientId}";`,
    `static const char* MQTT_CMD_TOPIC = "${commandTopic}";`,
    `static const char* MQTT_STATUS_TOPIC = "${statusTopic}";`,
    `static const int CONTROL_PIN = ${pin};`,
    "",
    "WiFiClient wifiClient;",
    "PubSubClient mqttClient(wifiClient);",
    "bool deviceState = false;",
    "",
    "void setDevice(bool on) {",
    "  deviceState = on;",
    "  digitalWrite(CONTROL_PIN, on ? HIGH : LOW);",
    "}",
    "",
    "void publishStatus() {",
    "  char payload[80];",
    '  snprintf(payload, sizeof(payload), "{\\"type\\":\\"%s\\",\\"state\\":%s}", DEVICE_TYPE, deviceState ? "true" : "false");',
    "  mqttClient.publish(MQTT_STATUS_TOPIC, payload, false);",
    "}",
    "",
    "void callback(char* topic, byte* payload, unsigned int length) {",
    '  String body = "";',
    "  for (unsigned int i = 0; i < length; i++) body += (char)payload[i];",
    "  if (body.indexOf(\"\\\"state\\\":true\") >= 0 || body == \"ON\") setDevice(true);",
    "  else if (body.indexOf(\"\\\"state\\\":false\") >= 0 || body == \"OFF\") setDevice(false);",
    "  publishStatus();",
    "}",
    "",
    "void connectWifi() {",
    "  WiFi.mode(WIFI_STA);",
    "  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);",
    "  while (WiFi.status() != WL_CONNECTED) delay(500);",
    "}",
    "",
    "void connectMqtt() {",
    "  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);",
    "  mqttClient.setCallback(callback);",
    "  while (!mqttClient.connected()) {",
    "    if (mqttClient.connect(MQTT_CLIENT_ID)) {",
    "      mqttClient.subscribe(MQTT_CMD_TOPIC);",
    "      publishStatus();",
    "    } else delay(2000);",
    "  }",
    "}",
    "",
    "void setup() {",
    "  pinMode(CONTROL_PIN, OUTPUT);",
    "  setDevice(false);",
    "  connectWifi();",
    "  connectMqtt();",
    "}",
    "",
    "void loop() {",
    "  if (WiFi.status() != WL_CONNECTED) connectWifi();",
    "  if (!mqttClient.connected()) connectMqtt();",
    "  mqttClient.loop();",
    "}",
    "",
  ].join("\n");
}

function actuatorEsp01(
  type: "light" | "water_valve",
  ssid: string,
  password: string,
  clientId: string,
  commandTopic: string,
  statusTopic: string,
) {
  const pin = 2;
  return actuatorEsp32(type, ssid, password, clientId, commandTopic, statusTopic)
    .replace("#include <WiFi.h>", "#include <ESP8266WiFi.h>")
    .replace(`static const int CONTROL_PIN = ${type === "light" ? 2 : 4};`, `static const int CONTROL_PIN = ${pin};`);
}

function tempHumiEsp32(
  ssid: string,
  password: string,
  clientId: string,
  commandTopic: string,
  statusTopic: string,
) {
  return [
    '#include <WiFi.h>',
    '#include <PubSubClient.h>',
    '#include <DHT.h>',
    "",
    'static const char* DEVICE_TYPE = "temp_humidity";',
    `static const char* WIFI_SSID = "${esc(ssid)}";`,
    `static const char* WIFI_PASSWORD = "${esc(password)}";`,
    'static const char* MQTT_BROKER = "broker.hivemq.com";',
    "static const uint16_t MQTT_PORT = 1883;",
    `static const char* MQTT_CLIENT_ID = "${clientId}";`,
    `static const char* MQTT_CMD_TOPIC = "${commandTopic}";`,
    `static const char* MQTT_STATUS_TOPIC = "${statusTopic}";`,
    "static const int DHT_PIN = 25;",
    "static const int DHT_TYPE = DHT11;",
    "",
    "WiFiClient wifiClient;",
    "PubSubClient mqttClient(wifiClient);",
    "DHT dht(DHT_PIN, DHT_TYPE);",
    "unsigned long lastPublishMs = 0;",
    "",
    "void publishStatus(float temperature, float humidity) {",
    "  char payload[128];",
    '  snprintf(payload, sizeof(payload), "{\\"type\\":\\"%s\\",\\"state\\":true,\\"temperature\\":%.2f,\\"humidity\\":%.2f}", DEVICE_TYPE, temperature, humidity);',
    "  mqttClient.publish(MQTT_STATUS_TOPIC, payload, false);",
    "}",
    "",
    "void callback(char* topic, byte* payload, unsigned int length) {}",
    "",
    "void connectWifi() {",
    "  WiFi.mode(WIFI_STA);",
    "  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);",
    "  while (WiFi.status() != WL_CONNECTED) delay(500);",
    "}",
    "",
    "void connectMqtt() {",
    "  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);",
    "  mqttClient.setCallback(callback);",
    "  while (!mqttClient.connected()) {",
    "    if (mqttClient.connect(MQTT_CLIENT_ID)) mqttClient.subscribe(MQTT_CMD_TOPIC);",
    "    else delay(2000);",
    "  }",
    "}",
    "",
    "void setup() {",
    "  dht.begin();",
    "  connectWifi();",
    "  connectMqtt();",
    "}",
    "",
    "void loop() {",
    "  if (WiFi.status() != WL_CONNECTED) connectWifi();",
    "  if (!mqttClient.connected()) connectMqtt();",
    "  mqttClient.loop();",
    "  if (millis() - lastPublishMs >= 5000) {",
    "    lastPublishMs = millis();",
    "    float h = dht.readHumidity();",
    "    float t = dht.readTemperature();",
    "    if (!isnan(h) && !isnan(t)) publishStatus(t, h);",
    "  }",
    "}",
    "",
  ].join("\n");
}

function tempHumiEsp01(
  ssid: string,
  password: string,
  clientId: string,
  commandTopic: string,
  statusTopic: string,
) {
  return tempHumiEsp32(ssid, password, clientId, commandTopic, statusTopic)
    .replace("#include <WiFi.h>", "#include <ESP8266WiFi.h>")
    .replace("static const int DHT_PIN = 25;", "static const int DHT_PIN = 2;");
}
