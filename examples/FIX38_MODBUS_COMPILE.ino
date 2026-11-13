#include <Arduino.h>
#include <flprogModbusRTU.h>
// ТОЛЬКО компиляция API: nullptr НЕ годится для реального обмена.
// Не вызывайте begin(), pool(), setSpeedUart() без UART executor.
ModbusMasterRTU master(0, 1, nullptr);
bool Enable = false; // in
bool Ready = false; // out
void setup() {
  master.setEnable(false);
}
void loop() {
  Ready = master.getEnable();
}
