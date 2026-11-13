#include <Arduino.h>
#include <flprogSystemHardwareTimer.h>
#include <flprogHardwarePwm.h>

// Только проверка диагностики, НЕ компилировать.
void setup() {
  initFlprogSystemTimer(missingTimerCallback);
  setFlprogSystemTimerTickPeriod(4294967296ULL);
}
void loop() {}
