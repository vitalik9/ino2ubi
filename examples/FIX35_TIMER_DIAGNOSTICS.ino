#include <Arduino.h>
#include <flprogSystemHardwareTimer.h>

// Только проверка предупреждений; НЕ компилировать.
void setup() {
  initFlprogSystemTimer();
  initFlprogSystemTimer(nullptr);
  setFlprogSystemTimerTickPeriod(5);
}
void loop() {}
