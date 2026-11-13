#include <Arduino.h>
#include <flprogHardwarePwm.h>
#include <flprogModbusRTU.h>

// ТОЛЬКО компиляция API. nullptr не подключает GPIO или UART.
FlprogHardwarePwmPin pwm(nullptr, 255);
ModbusMasterRTU master(0, 1, nullptr);

uint16_t Duty = 120; // par
bool Ready = false; // out

void setup() {
  pwm.pwmWrite(Duty);
  master.setEnable(false);
}

void loop() {
  pwm.tick();
  Ready = master.getEnable();
}
