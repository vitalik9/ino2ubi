/*
BLE_Presence — обнаружение двух BLE-устройств по MAC-адресам для ESP32.

Назначение и алгоритм:
Блок неблокирующе запускает повторяющееся активное BLE-сканирование.
Рекламные пакеты учитываются только при включённом входе inEnable,
достаточном RSSI и совпадении MAC-адреса без учёта регистра букв.
Для каждого устройства запоминается время последнего обнаружения.
Соответствующий выход остаётся включённым в течение HoldTimeMs после
последнего обнаружения. outRelay — логическое ИЛИ двух выходов.

Вход:
  inEnable (bool) — разрешение сканирования: false/true.

Выходы:
  outDevice1 (bool) — первое устройство обнаружено в интервал удержания;
  outDevice2 (bool) — второе устройство обнаружено в интервал удержания;
  outRelay (bool) — активно первое или второе устройство.

Настраиваемые параметры:
  MinRSSI (int) — минимальный RSSI, dBm; по умолчанию -100;
  MacDevice1 (String) — MAC первого BLE-устройства в виде XX:XX:XX:XX:XX:XX;
  MacDevice2 (String) — MAC второго BLE-устройства в том же формате;
  ScanDurationSeconds (int) — длительность одного сканирования, с;
    значение ограничивается кодом диапазоном 1...3600, по умолчанию 20;
  HoldTimeMs (unsigned long) — время удержания, мс;
    значение ограничивается диапазоном 0...2147483647, по умолчанию 60000.

Состояния:
На старте и при inEnable=false все выходы выключены, история обнаружений
сбрасывается и активное сканирование останавливается.
При повторном включении обнаружение начинается заново.
При ошибке запуска сканирования выходы остаются согласно времени последнего
обнаружения; запуск повторяется не чаще раза в 2 секунды.
При отсутствии устройств выходы выключаются после истечения удержания.

Требования:
ESP32 со встроенным BLE; библиотеки BLEDevice.h, BLEScan.h и
BLEAdvertisedDevice.h из пакета Arduino-ESP32.
GPIO и Serial не используются. Wi-Fi не требуется.
Для FLProg: подключить логический сигнал к inEnable, а выходы направить
на нужные логические блоки/реле через штатные выходы FLProg.
Использовать один экземпляр BLE_Presence в проекте: сканер BLE — общий
ресурс ESP32, не запускать параллельно другой независимый BLE-сканер.
Целевая базовая версия: ESP32 Arduino Core 2.0.17; для других версий
необходима проверка экспорта и компиляции в установленной FLProg.
*/

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEScan.h>
#include <BLEAdvertisedDevice.h>
#include <stdint.h>

bool inEnable = false;                // in
bool outDevice1 = false;              // out
bool outDevice2 = false;              // out
bool outRelay = false;                // out

int MinRSSI = -100;                   // par: Минимальный RSSI, dBm
String MacDevice1 = "02:00:00:00:00:01"; // par: MAC первого устройства
String MacDevice2 = "02:00:00:00:00:02"; // par: MAC второго устройства
int ScanDurationSeconds = 20;        // par: Длительность сканирования, с
unsigned long HoldTimeMs = 60000;   // par: Время удержания, мс

// Объявления состояния обязательно находятся ДО класса обработчика.
bool blePresenceScanAllowed = false; // variable
bool blePresenceScanDone = false;    // variable
bool blePresenceSeen1 = false;       // variable
bool blePresenceSeen2 = false;       // variable
uint32_t blePresenceLast1 = 0;       // variable
uint32_t blePresenceLast2 = 0;       // variable
bool blePresenceRunning = false;     // variable
bool blePresenceWasEnabled = false;  // variable
uint32_t blePresenceLastAttempt = 0; // variable
bool blePresenceHaveAttempt = false; // variable

class BLEPresenceAdvertisedCallbacks : public BLEAdvertisedDeviceCallbacks {
  void onResult(BLEAdvertisedDevice device) {
    if (blePresenceScanAllowed && device.getRSSI() >= MinRSSI) {
      // Работает и когда toString() возвращает String, и со std::string.
      String address = device.getAddress().toString().c_str();
      uint32_t now = millis();

      // equalsIgnoreCase принимает String и строковый литерал из ino2ubi.
      if (address.equalsIgnoreCase(MacDevice1)) {
        blePresenceLast1 = now;
        blePresenceSeen1 = true;
      }
      if (address.equalsIgnoreCase(MacDevice2)) {
        blePresenceLast2 = now;
        blePresenceSeen2 = true;
      }
    }
  }
};

BLEPresenceAdvertisedCallbacks blePresenceCallbacks;

void blePresenceScanComplete(BLEScanResults results) {
  (void)results;
  blePresenceScanDone = true;
}

void setup() {
  outDevice1 = false;
  outDevice2 = false;
  outRelay = false;
  blePresenceScanAllowed = false;
  blePresenceScanDone = false;
  blePresenceSeen1 = false;
  blePresenceSeen2 = false;
  blePresenceLast1 = 0;
  blePresenceLast2 = 0;
  blePresenceRunning = false;
  blePresenceWasEnabled = false;
  blePresenceLastAttempt = 0;
  blePresenceHaveAttempt = false;

  BLEDevice::init("");
  BLEScan *scanner = BLEDevice::getScan();
  if (scanner != nullptr) {
    scanner->setAdvertisedDeviceCallbacks(&blePresenceCallbacks, true);
    scanner->setActiveScan(true);
    scanner->setInterval(1349);
    scanner->setWindow(449);
  }
}

void loop() {
  BLEScan *scanner = BLEDevice::getScan();
  uint32_t now = millis();

  if (!inEnable) {
    blePresenceScanAllowed = false;
    if (blePresenceWasEnabled && scanner != nullptr) {
      scanner->stop();
      scanner->clearResults();
    }
    blePresenceRunning = false;
    blePresenceScanDone = false;
    blePresenceSeen1 = false;
    blePresenceSeen2 = false;
    blePresenceLast1 = 0;
    blePresenceLast2 = 0;
    blePresenceHaveAttempt = false;
    blePresenceWasEnabled = false;
    outDevice1 = false;
    outDevice2 = false;
    outRelay = false;
  } else {
    if (!blePresenceWasEnabled) {
      blePresenceSeen1 = false;
      blePresenceSeen2 = false;
      blePresenceScanDone = false;
      blePresenceRunning = false;
      blePresenceHaveAttempt = false;
      blePresenceScanAllowed = true;
      blePresenceWasEnabled = true;
    }

    if (blePresenceScanDone) {
      blePresenceScanDone = false;
      blePresenceRunning = false;
      if (scanner != nullptr) {
        scanner->clearResults();
      }
    }

    if (!blePresenceRunning && scanner != nullptr &&
        (!blePresenceHaveAttempt ||
         (uint32_t)(now - blePresenceLastAttempt) >= 2000UL)) {
      int seconds = ScanDurationSeconds;
      if (seconds < 1) {
        seconds = 1;
      }
      if (seconds > 3600) {
        seconds = 3600;
      }

      blePresenceLastAttempt = now;
      blePresenceHaveAttempt = true;
      blePresenceScanDone = false;
      blePresenceRunning = scanner->start((uint32_t)seconds,
                                           blePresenceScanComplete, false);
    }

    now = millis();
    unsigned long holdMs = HoldTimeMs;
    if (holdMs > 2147483647UL) {
      holdMs = 2147483647UL;
    }

    outDevice1 = blePresenceSeen1 &&
                 ((uint32_t)(now - blePresenceLast1) <= holdMs);
    outDevice2 = blePresenceSeen2 &&
                 ((uint32_t)(now - blePresenceLast2) <= holdMs);
    outRelay = outDevice1 || outDevice2;
  }
}
