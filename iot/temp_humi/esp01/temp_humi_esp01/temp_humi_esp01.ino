#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266HTTPClient.h>
#include <ESP8266httpUpdate.h>
#include <EEPROM.h>
#define MQTT_MAX_PACKET_SIZE 1200
#include <PubSubClient.h>
#include <DHT.h>

static const char* DEVICE_TYPE = "temp_humidity";
static const char* MQTT_BROKER = "broker.hivemq.com";
static const uint16_t MQTT_PORT = 1883;
static const char* REG_COMPLETE_URL = "http://localhost:3004/api/iot/register/complete";
static const char* STATUS_LOG_URL = "http://localhost:3004/api/iot/status";
static const char* BASE_REGISTRATION_TOKEN = "campus-reg-token-dev";
static const int DHT_PIN = 2;
static const int DHT_TYPE = DHT11;

ESP8266WebServer portal(80);
WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);
DHT dht(DHT_PIN, DHT_TYPE);

String wifiSsid;
String wifiPassword;
String mapId;
String deviceId;
String topicPrefix;
String firmwareVersion = "v1.0.0";
bool configured = false;
bool bootStatusSent = false;
unsigned long lastPublishMs = 0;

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

void saveCfg(const String& ssid, const String& pass, const String& prefix) {
  EEPROM.begin(1024);
  String blob = ssid + "\n" + pass + "\n" + prefix + "\n";
  for (int i = 0; i < 1023; i++) EEPROM.write(i, i < blob.length() ? blob[i] : 0);
  EEPROM.commit();
  EEPROM.end();
}

void loadCfg() {
  EEPROM.begin(1024);
  String blob = "";
  for (int i = 0; i < 1023; i++) {
    char c = (char)EEPROM.read(i);
    if (c == 0) break;
    blob += c;
  }
  EEPROM.end();
  int p1 = blob.indexOf('\n');
  int p2 = blob.indexOf('\n', p1 + 1);
  int p3 = blob.indexOf('\n', p2 + 1);
  if (p1 < 0 || p2 < 0 || p3 < 0) return;
  wifiSsid = blob.substring(0, p1);
  wifiPassword = blob.substring(p1 + 1, p2);
  topicPrefix = blob.substring(p2 + 1, p3);
  configured = wifiSsid.length() > 0 && topicPrefix.length() > 0 && parseTopicPrefix(topicPrefix, mapId, deviceId);
}

void startPortal() {
  WiFi.mode(WIFI_AP);
  WiFi.softAP("ESP01TempSetup");
  portal.on("/", HTTP_GET, []() {
    portal.send(200, "text/html",
      "<html><body><h3>ESP-01 Temp/Humi Setup</h3><form method='POST' action='/save'>"
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
      portal.send(400, "text/plain", "SSID and valid topicPrefix are required");
      return;
    }
    saveCfg(ssid, pass, prefix);
    portal.send(200, "text/plain", "Saved. Rebooting...");
    delay(500);
    ESP.restart();
  });
  portal.begin();
}

void publishSensorStatus(float temperature, float humidity) {
  char payload[192];
  snprintf(payload, sizeof(payload), "{\"type\":\"%s\",\"state\":true,\"temperature\":%.2f,\"humidity\":%.2f,\"firmwareVersion\":\"%s\"}", DEVICE_TYPE, temperature, humidity, firmwareVersion.c_str());
  mqttClient.publish(statusTopic().c_str(), payload, false);
}

bool sendBootStatusLog() {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  http.begin(STATUS_LOG_URL);
  http.addHeader("Content-Type", "application/json");
  String body = "{\"mapId\":\"" + mapId +
    "\",\"deviceId\":\"" + deviceId +
    "\",\"state\":true" +
    ",\"firmwareVersion\":\"" + firmwareVersion +
    "\",\"wifiSsid\":\"" + wifiSsid +
    "\",\"mqttTopicPrefix\":\"" + topicPrefix +
    "\",\"boardTarget\":\"esp01\"}";
  int code = http.POST(body);
  http.end();
  return code >= 200 && code < 300;
}

void performOta(const String& url) {
  WiFiClient client;
  ESPhttpUpdate.rebootOnUpdate(false);
  mqttClient.publish((topicPrefix + "/ota/ack").c_str(), "{\"status\":\"flashing\"}", false);
  t_httpUpdate_return ret = ESPhttpUpdate.update(client, url);
  if (ret == HTTP_UPDATE_OK) {
    mqttClient.publish((topicPrefix + "/ota/ack").c_str(), "{\"status\":\"success\"}", false);
    delay(300);
    ESP.restart();
  } else {
    mqttClient.publish((topicPrefix + "/ota/ack").c_str(), "{\"status\":\"failed\"}", false);
  }
}

void setup() {
  Serial.begin(115200);
  dht.begin();
  loadCfg();
  if (!configured) {
    startPortal();
    return;
  }
  connectWifi();
  registerComplete();
  connectMqtt();
  bootStatusSent = sendBootStatusLog();
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

  if (millis() - lastPublishMs >= 5000) {
    lastPublishMs = millis();

    float humidity = dht.readHumidity();
    float temperature = dht.readTemperature(); // Celsius

    if (isnan(humidity) || isnan(temperature)) {
      Serial.println("[DHT11] Failed to read sensor data");
      return;
    }

    publishSensorStatus(temperature, humidity);
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
  mqttClient.setCallback([](char* topic, byte* payload, unsigned int length) {
    String t = String(topic);
    String body = "";
    for (unsigned int i = 0; i < length; i++) body += (char)payload[i];
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
      performOta(url);
    }
  });
  while (!mqttClient.connected()) {
    String clientId = "esp01-temphumi-" + deviceId;
    if (mqttClient.connect(clientId.c_str())) {
      mqttClient.subscribe(commandTopic().c_str());
      mqttClient.subscribe(otaTopic().c_str());
    } else delay(2000);
  }
}

void __attribute__((unused)) registerComplete() {
  HTTPClient http;
  http.begin(REG_COMPLETE_URL);
  http.addHeader("Content-Type", "application/json");
  String body = "{\"mapId\":\"" + mapId + "\",\"deviceId\":\"" + deviceId + "\",\"registrationToken\":\"" + String(BASE_REGISTRATION_TOKEN) +
    "\",\"boardTarget\":\"esp01\",\"wifiSsid\":\"" + wifiSsid + "\",\"mqttTopicPrefix\":\"" + topicPrefix +
    "\",\"firmwareVersion\":\"" + firmwareVersion + "\"}";
  http.POST(body);
  http.end();
}
