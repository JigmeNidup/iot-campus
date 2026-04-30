#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <HTTPClient.h>
#include <Update.h>
#include <PubSubClient.h>

static const char* DEVICE_TYPE = "light";
static const char* MQTT_BROKER = "broker.hivemq.com";
static const uint16_t MQTT_PORT = 1883;
static const char* BASE_REGISTRATION_TOKEN = "campus-reg-token-dev";
static const char* REG_COMPLETE_URL = "http://localhost:3004/api/iot/register/complete";
static const char* STATUS_LOG_URL = "http://localhost:3004/api/iot/status";
static const int LIGHT_PIN = 2;

Preferences prefs;
WebServer portal(80);
WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

String wifiSsid;
String wifiPassword;
String mapId;
String deviceId;
String topicPrefix;
String firmwareVersion = "v1.0.0";
bool configured = false;
bool lightState = false;
bool bootStatusSent = false;
unsigned long lastStatusPublishMs = 0;
unsigned long lastOtaCheckMs = 0;

void setLight(bool on) {
  lightState = on;
  digitalWrite(LIGHT_PIN, on ? HIGH : LOW);
  Serial.printf("[light] setLight -> %s\n", on ? "ON" : "OFF");
}

String commandTopic() { return topicPrefix + "/command"; }
String statusTopic() { return topicPrefix + "/status"; }
String otaTopic() { return topicPrefix + "/ota/update"; }

bool parseTopicPrefix(const String& prefix, String& outMapId, String& outDeviceId) {
  int first = prefix.indexOf('/');
  int second = prefix.indexOf('/', first + 1);
  int third = prefix.indexOf('/', second + 1);
  if (first < 0 || second < 0 || third < 0) return false;
  if (prefix.substring(0, first) != "campus") return false;
  if (prefix.substring(second + 1, third) != "device") return false;
  outMapId = prefix.substring(first + 1, second);
  int fourth = prefix.indexOf('/', third + 1);
  outDeviceId = fourth < 0
    ? prefix.substring(third + 1)
    : prefix.substring(third + 1, fourth);
  if (outMapId.length() == 0 || outDeviceId.length() == 0) return false;
  return true;
}

void saveConfig(const String& ssid, const String& pass, const String& prefix) {
  prefs.begin("cfg", false);
  prefs.putString("ssid", ssid);
  prefs.putString("pass", pass);
  prefs.putString("prefix", prefix);
  prefs.end();
}

void loadConfig() {
  prefs.begin("cfg", true);
  wifiSsid = prefs.getString("ssid", "");
  wifiPassword = prefs.getString("pass", "");
  topicPrefix = prefs.getString("prefix", "");
  prefs.end();
  configured = wifiSsid.length() > 0 && topicPrefix.length() > 0 && parseTopicPrefix(topicPrefix, mapId, deviceId);
}

bool completeRegistration() {
  if (WiFi.status() != WL_CONNECTED) return false;
  Serial.println("[reg] Sending registration complete...");
  HTTPClient http;
  http.begin(REG_COMPLETE_URL);
  http.addHeader("Content-Type", "application/json");
  String body = "{\"mapId\":\"" + mapId + "\",\"deviceId\":\"" + deviceId + "\",\"registrationToken\":\"" + String(BASE_REGISTRATION_TOKEN) +
    "\",\"boardTarget\":\"esp32\",\"wifiSsid\":\"" + wifiSsid + "\",\"mqttTopicPrefix\":\"" + topicPrefix +
    "\",\"firmwareVersion\":\"" + firmwareVersion + "\"}";
  int code = http.POST(body);
  http.end();
  Serial.printf("[reg] registration complete status: %d\n", code);
  return code >= 200 && code < 300;
}

bool sendBootStatusLog() {
  if (WiFi.status() != WL_CONNECTED) return false;
  Serial.println("[boot-log] Sending boot status log...");
  HTTPClient http;
  http.begin(STATUS_LOG_URL);
  http.addHeader("Content-Type", "application/json");
  String body = "{\"mapId\":\"" + mapId +
    "\",\"deviceId\":\"" + deviceId +
    "\",\"state\":" + String(lightState ? "true" : "false") +
    ",\"firmwareVersion\":\"" + firmwareVersion +
    "\",\"wifiSsid\":\"" + wifiSsid +
    "\",\"mqttTopicPrefix\":\"" + topicPrefix +
    "\",\"boardTarget\":\"esp32\"}";
  int code = http.POST(body);
  http.end();
  Serial.printf("[boot-log] status code: %d\n", code);
  return code >= 200 && code < 300;
}

void startProvisionPortal() {
  WiFi.mode(WIFI_AP);
  WiFi.softAP("CampusLightSetup");
  portal.on("/", HTTP_GET, []() {
    portal.send(200, "text/html",
      "<html><body><h3>Light Provisioning</h3><form method='POST' action='/save'>"
      "SSID:<input name='ssid'/><br/>Password:<input name='pass'/><br/>Topic Prefix:<input name='prefix'/><br/>"
      "<button type='submit'>Save</button></form></body></html>");
  });
  portal.on("/save", HTTP_POST, []() {
    String ssid = portal.arg("ssid");
    String pass = portal.arg("pass");
    String prefix = portal.arg("prefix");
    String parsedMapId = "";
    String parsedDeviceId = "";
    if (ssid.length() == 0 || prefix.length() == 0 || !parseTopicPrefix(prefix, parsedMapId, parsedDeviceId)) {
      portal.send(400, "text/plain", "Missing required fields");
      return;
    }
    saveConfig(ssid, pass, prefix);
    portal.send(200, "text/plain", "Saved. Rebooting...");
    delay(500);
    ESP.restart();
  });
  portal.begin();
}

void publishStatus() {
  char payload[192];
  snprintf(payload, sizeof(payload), "{\"type\":\"%s\",\"state\":%s,\"firmwareVersion\":\"%s\"}", DEVICE_TYPE, lightState ? "true" : "false", firmwareVersion.c_str());
  mqttClient.publish(statusTopic().c_str(), payload, false);
  Serial.printf("[mqtt] publish status topic=%s payload=%s\n", statusTopic().c_str(), payload);
}

bool applyOtaFromUrl(const String& url) {
  Serial.printf("[ota] Downloading firmware from: %s\n", url.c_str());
  HTTPClient http;
  http.begin(url);
  int code = http.GET();
  Serial.printf("[ota] HTTP GET code: %d\n", code);
  if (code != 200) { http.end(); return false; }
  int len = http.getSize();
  Serial.printf("[ota] Content-Length: %d\n", len);
  WiFiClient* stream = http.getStreamPtr();
  if (!Update.begin(len > 0 ? (size_t)len : UPDATE_SIZE_UNKNOWN)) {
    Serial.println("[ota] Update.begin failed");
    http.end();
    return false;
  }
  size_t written = Update.writeStream(*stream);
  Serial.printf("[ota] Bytes written: %u\n", (unsigned int)written);
  bool ok = written > 0 && Update.end();
  Serial.printf("[ota] Update.end result: %s\n", ok ? "OK" : "FAILED");
  http.end();
  if (ok && Update.isFinished()) {
    Serial.println("[ota] Firmware update complete, rebooting...");
    mqttClient.publish((topicPrefix + "/ota/ack").c_str(), "{\"status\":\"success\"}", false);
    delay(300);
    ESP.restart();
  }
  return ok;
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String t = String(topic);
  String body = "";
  for (unsigned int i = 0; i < length; i++) body += (char)payload[i];

  if (t == commandTopic()) {
    Serial.printf("[mqtt] command message on %s: %s\n", t.c_str(), body.c_str());
    if (body.indexOf("\"state\":true") >= 0 || body == "ON") setLight(true);
    else if (body.indexOf("\"state\":false") >= 0 || body == "OFF") setLight(false);
    publishStatus();
    return;
  }

  if (t == otaTopic()) {
    Serial.printf("[mqtt] ota message on %s: %s\n", t.c_str(), body.c_str());
    int idx = body.indexOf("\"url\":\"");
    int start = idx + 7;
    if (idx < 0) {
      idx = body.indexOf("\"downloadUrl\":\"");
      start = idx + 15;
    }
    if (idx < 0) return;
    int end = body.indexOf("\"", start);
    if (end <= start) return;
    String url = body.substring(start, end);
    Serial.printf("[ota] Parsed firmware url: %s\n", url.c_str());
    mqttClient.publish((topicPrefix + "/ota/ack").c_str(), "{\"status\":\"downloading\"}", false);
    bool ok = applyOtaFromUrl(url);
    if (!ok) {
      Serial.println("[ota] OTA failed");
      mqttClient.publish((topicPrefix + "/ota/ack").c_str(), "{\"status\":\"failed\"}", false);
    }
  }
}

void connectWifi() {
  Serial.printf("[wifi] Connecting to SSID: %s\n", wifiSsid.c_str());
  WiFi.mode(WIFI_STA);
  WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());
  unsigned long started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 20000) delay(500);
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[wifi] Connected. IP=%s RSSI=%d\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  } else {
    Serial.println("[wifi] Connection timeout");
  }
}

void connectMqtt() {
  Serial.printf("[mqtt] Connecting broker=%s:%u\n", MQTT_BROKER, MQTT_PORT);
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  while (!mqttClient.connected()) {
    String clientId = "esp32-light-" + deviceId;
    if (mqttClient.connect(clientId.c_str())) {
      Serial.printf("[mqtt] Connected. clientId=%s\n", clientId.c_str());
      mqttClient.subscribe(commandTopic().c_str());
      mqttClient.subscribe(otaTopic().c_str());
      Serial.printf("[mqtt] Subscribed: %s and %s\n", commandTopic().c_str(), otaTopic().c_str());
      publishStatus();
    } else {
      Serial.printf("[mqtt] Connect failed rc=%d, retrying...\n", mqttClient.state());
      delay(2000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  Serial.println("\n[boot] ESP32 light firmware booting...");
  pinMode(LIGHT_PIN, OUTPUT);
  setLight(false);

  loadConfig();
  Serial.printf("[boot] configured=%s mapId=%s deviceId=%s topicPrefix=%s\n",
    configured ? "true" : "false",
    mapId.c_str(),
    deviceId.c_str(),
    topicPrefix.c_str());
  if (!configured) {
    Serial.println("[boot] Not configured, starting provisioning portal");
    startProvisionPortal();
    return;
  }
  connectWifi();
  if (WiFi.status() != WL_CONNECTED) {
    startProvisionPortal();
    return;
  }
  completeRegistration();
  connectMqtt();
  publishStatus();
  bootStatusSent = sendBootStatusLog();
  Serial.printf("[boot] bootStatusSent=%s\n", bootStatusSent ? "true" : "false");
  lastStatusPublishMs = millis();
}

void loop() {
  if (!configured) {
    portal.handleClient();
    return;
  }

  if (WiFi.status() != WL_CONNECTED) connectWifi();
  if (!mqttClient.connected()) connectMqtt();
  mqttClient.loop();
  if (!bootStatusSent && WiFi.status() == WL_CONNECTED) {
    bootStatusSent = sendBootStatusLog();
    Serial.printf("[boot-log] retry result=%s\n", bootStatusSent ? "ok" : "failed");
  }

  if (millis() - lastStatusPublishMs > 30000) {
    publishStatus();
    lastStatusPublishMs = millis();
  }
  if (millis() - lastOtaCheckMs > 300000) {
    mqttClient.publish((topicPrefix + "/ota/ack").c_str(), "{\"status\":\"idle\"}", false);
    lastOtaCheckMs = millis();
  }
}
