"use client";

import mqtt from "mqtt";
import type { MqttClient } from "mqtt";

let sharedClient: MqttClient | null = null;
let sharedBrokerUrl: string | null = null;

export function connectMqttClient(brokerUrl: string): MqttClient {
  if (typeof window === "undefined") {
    throw new Error("MQTT client is browser-only");
  }

  if (sharedClient && sharedBrokerUrl === brokerUrl && !sharedClient.disconnected) {
    return sharedClient;
  }

  if (sharedClient) {
    sharedClient.end(true);
  }

  sharedClient = mqtt.connect(brokerUrl, {
    protocol: "wss",
    reconnectPeriod: 2000,
    connectTimeout: 10_000,
    clean: true,
  });
  sharedBrokerUrl = brokerUrl;
  return sharedClient;
}

export function subscribeToTopic(client: MqttClient, topic: string): Promise<void> {
  return new Promise((resolve, reject) => {
    client.subscribe(topic, (err?: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function publishCommand(
  client: MqttClient,
  topic: string,
  message: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    client.publish(topic, message, (err?: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function disconnectMqttClient() {
  if (!sharedClient) return;
  sharedClient.end(true);
  sharedClient = null;
  sharedBrokerUrl = null;
}
