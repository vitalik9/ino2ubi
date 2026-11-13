// Только диагностика: НЕ компилировать!
#include <Arduino.h>
#include <flprogHardwarePwm.h>
#include <flprogModbusRTU.h>
FlprogHardwarePwmPin pwm(nullptr, 255);
ModbusRTU bus; // абстрактный тип, намеренная ошибка
void setup() {
  pwm.pwmWrite(120); // нет tick()
}
void loop() {}
