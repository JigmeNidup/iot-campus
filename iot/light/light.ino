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
  HTTPClient http;
  http.begin(REG_COMPLETE_URL);
  http.addHeader("Content-Type", "application/json");
  String body = "{\"mapId\":\"" + mapId + "\",\"deviceId\":\"" + deviceId + "\",\"registrationToken\":\"" + String(BASE_REGISTRATION_TOKEN) +
    "\",\"boardTarget\":\"esp32\",\"wifiSsid\":\"" + wifiSsid + "\",\"mqttTopicPrefix\":\"" + topicPrefix +
    "\",\"firmwareVersion\":\"" + firmwareVersion + "\"}";
  int code = http.POST(body);
  http.end();
  return code >= 200 && code < 300;
}

bool sendBootStatusLog() {
  if (WiFi.status() != WL_CONNECTED) return false;
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
}

bool applyOtaFromUrl(const String& url) {
  HTTPClient http;
  http.begin(url);
  int code = http.GET();
  if (code != 200) { http.end(); return false; }
  int len = http.getSize();
  WiFiClient* stream = http.getStreamPtr();
  if (!Update.begin(len > 0 ? (size_t)len : UPDATE_SIZE_UNKNOWN)) { http.end(); return false; }
  size_t written = Update.writeStream(*stream);
  bool ok = written > 0 && Update.end();
  http.end();
  if (ok && Update.isFinished()) {
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
    if (body.indexOf("\"state\":true") >= 0 || body == "ON") setLight(true);
    else if (body.indexOf("\"state\":false") >= 0 || body == "OFF") setLight(false);
    publishStatus();
    return;
  }

  if (t == otaTopic()) {
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
    mqttClient.publish((topicPrefix + "/ota/ack").c_str(), "{\"status\":\"downloading\"}", false);
    bool ok = applyOtaFromUrl(url);
    if (!ok) mqttClient.publish((topicPrefix + "/ota/ack").c_str(), "{\"status\":\"failed\"}", false);
  }
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());
  unsigned long started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 20000) delay(500);
}

void connectMqtt() {
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  while (!mqttClient.connected()) {
    String clientId = "esp32-light-" + deviceId;
    if (mqttClient.connect(clientId.c_str())) {
      mqttClient.subscribe(commandTopic().c_str());
      mqttClient.subscribe(otaTopic().c_str());
      publishStatus();
    } else {
      delay(2000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LIGHT_PIN, OUTPUT);
  setLight(false);

  loadConfig();
  if (!configured) {
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
