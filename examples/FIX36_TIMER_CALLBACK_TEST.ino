#include <Arduino.h>
#include <flprogSystemHardwareTimer.h>

// Демонстрационный тест: один владелец аппаратного таймера.
// Требует установленную библиотеку Flprog_HardwareTimer.
// ВАЖНО: ISR работает вне общего loop FLProg.
volatile uint32_t hwTicks = 0; // variable
uint32_t TickCount = 0; // out
bool Enable = true; // in

void IRAM_ATTR onHardwareTick() {
  hwTicks++;
}

void setup() {
  setFlprogSystemTimerTickPeriod(1000000UL);
  initFlprogSystemTimer(onHardwareTick);
}

void loop() {
  // Только один блок в схеме должен владеть этим аппаратным таймером.
  if (Enable) {
    // Aligned 32-bit read on ESP32; no temporary nested declaration.
    TickCount = hwTicks;
  }
}
