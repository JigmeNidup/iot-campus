#include <WiFi.h>
#include <PubSubClient.h>

// --------- Hardcoded device configuration (temporary) ----------
static const char* DEVICE_TYPE = "light";
static const char* WIFI_SSID = "YOUR_WIFI_SSID";
static const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
static const char* MQTT_BROKER = "broker.hivemq.com";
static const uint16_t MQTT_PORT = 1883;
static const char* MQTT_CLIENT_ID = "esp32-light-001";
static const char* MQTT_CMD_TOPIC = "campus/demo-map/device/demo-light-001/command";
static const char* MQTT_STATUS_TOPIC = "campus/demo-map/device/demo-light-001/status";

// --------- GPIO ----------
static const int LIGHT_PIN = 2; // Change to your relay/transistor pin

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

bool lightState = false;
unsigned long lastStatusPublishMs = 0;

void setLight(bool on) {
  lightState = on;
  digitalWrite(LIGHT_PIN, on ? HIGH : LOW);
}

void publishStatus() {
  char payload[64];
  snprintf(payload, sizeof(payload), "{\"type\":\"%s\",\"state\":%s}", DEVICE_TYPE, lightState ? "true" : "false");
  mqttClient.publish(MQTT_STATUS_TOPIC, payload, false);
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String incomingTopic = String(topic);
  String body = "";
  for (unsigned int i = 0; i < length; i++) {
    body += (char)payload[i];
  }

  Serial.print("[MQTT] Topic: ");
  Serial.print(incomingTopic);
  Serial.print(" | Payload: ");
  Serial.println(body);

  // Accept JSON payload { "state": true/false } or string ON/OFF
  bool nextState = lightState;
  bool parsed = false;

  if (body.indexOf("\"state\":true") >= 0 || body == "ON") {
    nextState = true;
    parsed = true;
  } else if (body.indexOf("\"state\":false") >= 0 || body == "OFF") {
    nextState = false;
    parsed = true;
  }

  if (!parsed) {
    Serial.println("[MQTT] Unrecognized payload, ignoring.");
    return;
  }

  setLight(nextState);
  publishStatus();
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("WiFi connected. IP: ");
  Serial.println(WiFi.localIP());
}

void connectMqtt() {
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);

  while (!mqttClient.connected()) {
    Serial.print("Connecting to MQTT broker...");
    if (mqttClient.connect(MQTT_CLIENT_ID)) {
      Serial.println("connected");
      mqttClient.subscribe(MQTT_CMD_TOPIC);
      publishStatus();
    } else {
      Serial.print("failed, rc=");
      Serial.print(mqttClient.state());
      Serial.println(" retrying in 2s");
      delay(2000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LIGHT_PIN, OUTPUT);
  setLight(false);

  connectWifi();
  connectMqtt();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
  }
  if (!mqttClient.connected()) {
    connectMqtt();
  }

  mqttClient.loop();

  // Optional heartbeat status every 30 seconds for visibility
  if (millis() - lastStatusPublishMs > 30000) {
    publishStatus();
    lastStatusPublishMs = millis();
  }
}
