#include <Arduino.h>
#include <flprogHardwarePwm.h>
// Тест компиляции программного PWM; pin=nullptr исключает физический вывод.
FlprogHardwarePwmPin pwm(nullptr, 255);
uint16_t Duty = 120; // par
void setup() {
  pwm.pwmWrite(Duty);
}
void loop() {
  pwm.tick(); // для реального PWM нужен стабильный источник тактов
}
