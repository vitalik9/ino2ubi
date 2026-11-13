// FIX33: intentionally invalid API calls for diagnostics; do NOT compile as-is.
#include <Arduino.h>
#include <flprogHardwarePwm.h>
#include <flprogModbusRTU.h>

FlprogHardwarePwmPin pwm(nullptr, 255);
ModbusRTU bus;

void setup() {
  pwm.setDuty(120); // Expect warning: pwmWrite()
  bus.setBaudRate(9600); // Expect warning: setSpeedUart()
}
void loop() {}
